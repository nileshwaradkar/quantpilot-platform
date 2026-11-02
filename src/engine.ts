import { randomUUID } from 'node:crypto';
import { audit, one, type Database } from './db.js';
import { day, minute, levels, quantityFor, roundTick, type Setup, type Trade, type Contract } from './domain.js';
import { closedCandles, evaluate, previousRange } from './strategy.js';
import { InstrumentCatalog, nearestContracts, selectAtm, underlyingSymbol } from './instruments.js';
import { Fyers, type Broker } from './broker.js';
import { Vault } from './security.js';
import { Executor } from './execution.js';
import type { Config } from './config.js';
export class Engine{
 private executor:Executor;
 private cache=new Map<string,{expires:number;data:any}>();
 constructor(private db:Database,private cfg:Config,private vault:Vault,private catalog=new InstrumentCatalog(),private brokerFactory?:(user:string)=>Promise<Broker>,private canEnter:()=>boolean=()=>true){this.executor=new Executor(db);}
 async broker(user:string):Promise<Broker>{
  if(this.brokerFactory)return this.brokerFactory(user);
  const row=await one(this.db,'SELECT * FROM broker_accounts WHERE user_id=$1 AND expires_at>now()',[user]);
  if(!row)throw new Error('FYERS authorization expired or missing; reconnect your account');
  return new Fyers(this.cfg.FYERS_APP_ID,this.vault.open(user,row.token_cipher));
 }
 async note(setup:Setup,message:string){
  if(setup.snapshot?.message===message)return;
  await this.db.query('UPDATE setups SET snapshot=$2 WHERE id=$1',[setup.id,JSON.stringify({message})]);
 }
 marketOpen(s:Setup,now:number){
  const date=day(now),weekday=new Date(date+'T12:00:00Z').getUTCDay(),time=minute(now),mcx=s.market==='CRUDEOIL';
  const holidays=(mcx?this.cfg.MCX_HOLIDAYS:this.cfg.NSE_HOLIDAYS).split(',');
  return weekday>0&&weekday<6&&!holidays.includes(date)&&time>=(mcx?'09:00':'09:15')&&time<(mcx?this.cfg.MCX_SQUARE_OFF:'15:15');
 }
 async history(user:string,b:Broker,symbol:string,resolution:'5'|'D',now:number){
  const key=user+symbol+resolution,previous=this.cache.get(key);
  if(previous&&previous.expires>now)return previous.data;
  const data=await b.history(symbol,resolution,now);this.cache.set(key,{data,expires:now+(resolution==='D'?600000:12000)});
  if(this.cache.size>2000)this.cache.clear();
  return data;
 }
 async tick(now=Date.now()){
  const users=(await this.db.query<{user_id:string}>("SELECT DISTINCT user_id FROM setups WHERE status='running' UNION SELECT DISTINCT user_id FROM trades WHERE status NOT IN ('closed','rejected')")).rows;
  const tickStart=Date.now();
  for(const {user_id} of users){
   try{await this.account(user_id,now+Date.now()-tickStart);}
   catch(e){
    const message=e instanceof Error?e.message:'Trading service unavailable';
    await this.db.query("UPDATE setups SET status='attention',snapshot=$2 WHERE user_id=$1 AND status='running'",[user_id,JSON.stringify({message})]);
    // Errors may contain upstream credentials; keep audit details generic.
    await audit(this.db,user_id,'Trading paused: data or broker unavailable');
   }
  }
 }
 async account(user:string,now:number){
  const b=await this.broker(user);
  const setups=(await this.db.query<Setup>('SELECT * FROM setups WHERE user_id=$1',[user])).rows;
  let active=(await this.db.query<Trade>("SELECT * FROM trades WHERE user_id=$1 AND status NOT IN ('closed','rejected') ORDER BY created_at",[user])).rows;
  let monitoringHealthy=true;
  const modePnl:Record<string,number>={};
  for(const t of active){
   const setup=setups.find(s=>s.id===t.setup_id)!;
   const cutoff=setup.market==='CRUDEOIL'?this.cfg.MCX_SQUARE_OFF:'15:15';
   if(minute(now)>=cutoff||day(new Date(t.created_at).getTime())!==day(now))await this.db.query('UPDATE trades SET exit_requested=true WHERE id=$1',[t.id]);
   try{if(t.mode==='paper')await this.executor.paper(t,b);else await this.executor.reconcile(t,b,now);}
   catch{monitoringHealthy=false;await this.executor.attention(t,'Position monitoring interrupted; check FYERS and reconnect');}
  }
  // Apply a sticky daily lock using the strictest configured limit per mode.
  for(const mode of ['paper','live'] as const){
   const relevant=setups.filter(s=>s.mode===mode);if(!relevant.length)continue;
   const limit=Math.min(...relevant.map(s=>s.config.dailyLoss));
   let pnl:number;
   if(mode==='paper'){
    const result=await one(this.db,"SELECT COALESCE(SUM(CASE WHEN status='closed' THEN pnl ELSE (COALESCE(last_price,entry)-entry)*side*filled_qty*multiplier END),0)::float8 AS pnl FROM trades WHERE user_id=$1 AND mode=$2 AND trading_day=$3",[user,mode,day(now)]);
    pnl=result.pnl;
   }else{
    if(!active.some(t=>t.mode==='live')&&!relevant.some(s=>s.status==='running'))continue;
    const positions=await b.positions();
    if(positions.some(p=>p.pl===undefined))throw new Error('Broker account P&L is unavailable');
    pnl=positions.reduce((total,p)=>total+(p.pl??0),0);
   }
   modePnl[mode]=pnl;
   if(pnl<=-limit){
    await this.db.transaction(async tx=>{
     await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user]);
     await tx.query("INSERT INTO daily_halts(user_id,mode,day,reason) VALUES($1,$2,$3,'Daily loss limit reached') ON CONFLICT DO NOTHING",[user,mode,day(now)]);
     await tx.query("UPDATE setups SET status='paused' WHERE user_id=$1 AND mode=$2",[user,mode]);
     await tx.query("UPDATE trades SET exit_requested=true WHERE user_id=$1 AND mode=$2 AND status NOT IN ('closed','rejected')",[user,mode]);
    });
   }
  }
  if(!monitoringHealthy)return;
  for(const s of setups.filter(s=>s.status==='running')){
   try{await this.scan(s,b,now,modePnl[s.mode]||0);}catch{await this.note(s,'Market data or contract metadata unavailable; no entry sent');}
  }
 }
 async scan(s:Setup,b:Broker,now:number,accountPnl=0){
  const scanStarted=Date.now();
  if(!this.canEnter())return;
  if(await one(this.db,"SELECT 1 FROM trades t JOIN setups s ON s.id=t.setup_id WHERE t.user_id=$1 AND t.mode=$2 AND t.status NOT IN ('closed','rejected') AND s.status='attention'",[s.user_id,s.mode]))return;
  if(!this.marketOpen(s,now)){await this.note(s,'Outside entry session; monitoring existing positions');return;}
  if(s.mode==='live'&&this.cfg.LIVE_TRADING_ENABLED!=='true'){await this.note(s,'Live execution is disabled by the operator');return;}
  if(await one(this.db,"SELECT id FROM trades WHERE user_id=$1 AND mode=$2 AND (setup_id=$3 OR status IN ('unknown','submitting','exit_pending')) AND status NOT IN ('closed','rejected')",[s.user_id,s.mode,s.id]))return;
  const segment=s.instrument==='equity'?'NSE_CM':s.market==='CRUDEOIL'?'MCX_COM':'NSE_FO';
  const all=await this.catalog.get(segment,now);
  const contracts=s.instrument==='option'?nearestContracts(all,s.market,now):[];
  const underlying=s.instrument==='option'?underlyingSymbol(all,contracts,s.market):s.market;
  const raw=await this.history(s.user_id,b,underlying,'5',now);
  const candles=closedCandles(raw,now),last=candles.at(-1);
  if(!last||now-(last.time*1000+300000)>90000){await this.note(s,'Waiting for fresh underlying candles');return;}
  const range=previousRange(await this.history(s.user_id,b,underlying,'D',now),now);
  const type=last.close>range.high?'CE':last.close<range.low?'PE':undefined;
  if(!type){await this.db.query('UPDATE setups SET snapshot=$2 WHERE id=$1',[s.id,JSON.stringify({message:"Waiting for underlying previous-day breakout",checks:{breakout:false},values:{previousHigh:range.high,previousLow:range.low,underlying:last.close},candleTime:last.time})]);return;}
  const contract:Contract|undefined=s.instrument==='option'?selectAtm(contracts,last.close,type):all.find(c=>c.symbol===s.market&&c.type==='EQ');
  if(!contract)throw new Error('Contract not found');
  const premium=s.instrument==='option'?await this.history(s.user_id,b,contract.symbol,'5',now):raw;
  const snapshot=evaluate(raw,premium,range,now,s.instrument);
  const enriched={...snapshot,contract:contract.symbol,expiry:contract.expiry,lot:contract.lot,multiplier:contract.multiplier,underlyingSymbol:underlying,previousSession:range.date};
  await this.db.query('UPDATE setups SET snapshot=$2 WHERE id=$1',[s.id,JSON.stringify(enriched)]);
  if(!snapshot.signal||snapshot.candleTime===Number(s.last_candle))return;
  const quote=await b.quote(contract.symbol,now+Date.now()-scanStarted),entry=roundTick(quote.price,contract.tick);
  if(Math.abs(entry-snapshot.signal.reference)>snapshot.signal.stopDistance/2){await this.note(s,'Price moved too far from the signal; entry skipped');return;}
  const distance=s.instrument==='option'?10:(entry-snapshot.signal.stop)*snapshot.signal.side;
  const budgetQty=quantityFor(s.config,entry,distance,contract.lot,contract.multiplier),qty=contract.freeze?Math.min(budgetQty,Math.floor(contract.freeze/contract.lot)*contract.lot):budgetQty,prices=levels(s.instrument,snapshot.signal.side,entry,distance,contract.tick);
  if(qty<contract.lot||prices.stop<=0){await this.note(s,'Risk or capital budget is below one lot; entry skipped');return;}
  if(s.mode==='live'){
   const positions=await b.positions(),orders=await b.orders();
   if(positions.some(p=>p.symbol===contract.symbol&&p.netQty!==0)||orders.some(o=>o.symbol===contract.symbol&&![1,2,5,7].includes(o.status))){await this.note(s,'Existing broker exposure in this symbol; entry skipped');return;}
  }
  const trade=await this.db.transaction(async tx=>{
   await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[s.user_id]);
   const fresh=await one<Setup>(tx,'SELECT * FROM setups WHERE id=$1',[s.id]);
   if(!this.canEnter()||!this.marketOpen(s,now+Date.now()-scanStarted)||now+Date.now()-scanStarted-(snapshot.candleTime!*1000+300000)>90000||!fresh||fresh.status!=='running'||Number(fresh.last_candle)===snapshot.candleTime||qty*distance*contract.multiplier>fresh.config.riskPerTrade)return;
   if(await one(tx,'SELECT 1 FROM daily_halts WHERE user_id=$1 AND mode=$2 AND day=$3',[s.user_id,s.mode,day(now)]))return;
   if(await one(tx,"SELECT 1 FROM trades WHERE user_id=$1 AND mode=$2 AND status NOT IN ('closed','rejected') AND (setup_id=$3 OR symbol=$4 OR status IN ('unknown','submitting','exit_pending'))",[s.user_id,s.mode,s.id,contract.symbol]))return;
   const count=await one(tx,'SELECT COUNT(*)::int AS n FROM trades WHERE setup_id=$1 AND trading_day=$2',[s.id,day(now)]);
   if(count.n>=fresh.config.maxTrades)return;
   const reserved=await one(tx,"SELECT COALESCE(SUM(abs(entry-stop)*quantity*multiplier),0)::float8 AS risk, COALESCE(SUM(entry*quantity*multiplier),0)::float8 AS capital FROM trades WHERE user_id=$1 AND mode=$2 AND status NOT IN ('closed','rejected')",[s.user_id,s.mode]);
   const realized=await one(tx,"SELECT COALESCE(SUM(pnl),0)::float8 AS pnl FROM trades WHERE user_id=$1 AND mode=$2 AND trading_day=$3 AND status='closed'",[s.user_id,s.mode,day(now)]);
   const limits=await one(tx,"SELECT MIN((config->>'dailyLoss')::float8) AS loss FROM setups WHERE user_id=$1 AND mode=$2",[s.user_id,s.mode]);
   if(reserved.risk+qty*distance*contract.multiplier>limits.loss+Math.min(0,s.mode==='live'?accountPnl:realized.pnl)||reserved.capital+qty*entry*contract.multiplier>fresh.config.capital)return;
   const id=randomUUID(),tag='QP'+id.replaceAll('-','').slice(0,24);
   const result=await one<Trade>(tx,"INSERT INTO trades(id,user_id,setup_id,mode,symbol,instrument,side,multiplier,quantity,filled_qty,entry,stop,target,tick,signal_time,trading_day,status,entry_tag,last_price,last_quote_at) VALUES($1,$2,$3,$4,$5,$6,$7,$19,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$10,$18) RETURNING *",[id,s.user_id,s.id,s.mode,contract.symbol,s.instrument,snapshot.signal!.side,qty,s.mode==='paper'?qty:0,entry,prices.stop,prices.target,contract.tick,snapshot.candleTime,day(now),s.mode==='paper'?'open':'submitting',tag,new Date(quote.time),contract.multiplier]);
   await tx.query('UPDATE setups SET last_candle=$2 WHERE id=$1',[s.id,snapshot.candleTime]);
   await audit(tx,s.user_id,s.mode==='paper'?'Paper entry filled':'Live entry intent saved',{trade:id,symbol:contract.symbol,quantity:qty,candle:snapshot.candleTime});
   return result;
  });
  if(trade&&s.mode==='live'){if(!this.canEnter()){await this.db.query("UPDATE trades SET status='rejected',reason='Worker shutting down before submission',closed_at=now() WHERE id=$1",[trade.id]);return;}await this.executor.submit(trade,b);const latest=await one<Trade>(this.db,'SELECT * FROM trades WHERE id=$1',[trade.id]);if(latest&&latest.status!=='rejected')await this.executor.reconcile(latest,b);}
 }
}


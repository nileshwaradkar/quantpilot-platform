import { beforeAll,beforeEach,afterAll,describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase,cfg } from './helpers.js';
import { one,type Database } from '../src/db.js';
import { BrokerError,Fyers,type Broker } from '../src/broker.js';
import { Executor } from '../src/execution.js';
import { Engine } from '../src/engine.js';
import { signalFixture,now as signalNow } from './fixtures.js';
import type { InstrumentCatalog } from '../src/instruments.js';
import { Vault } from '../src/security.js';
import { day,type Trade,type Setup } from '../src/domain.js';
let db:Database;
beforeAll(async()=>{db=await testDatabase();});
beforeEach(async()=>{await db.query('TRUNCATE users CASCADE');});
afterAll(async()=>{await db.close();});
async function fixture(mode:'paper'|'live'='live',status='pending'){
 const uid=randomUUID(),sid=randomUUID(),id=randomUUID();
 await db.query("INSERT INTO users(id,email,name,password_hash,verified) VALUES($1,$2,'Trader','hash',true)",[uid,uid+'@example.com']);
 await db.query("INSERT INTO setups(id,user_id,mode,instrument,market,config,status) VALUES($1,$2,$3,'option','NIFTY',$4,'running')",[sid,uid,mode,JSON.stringify({riskPerTrade:1000,dailyLoss:1000,capital:50000,maxTrades:3})]);
 await db.query("INSERT INTO trades(id,user_id,setup_id,mode,symbol,instrument,side,quantity,filled_qty,entry,stop,target,tick,signal_time,trading_day,status,entry_tag,broker_order_id,last_price) VALUES($1,$2,$3,$4,'NSE:TESTCE','option',1,10,$5,150,140,170,.05,123,$6,$7,$8,'order-1',150)",[id,uid,sid,mode,mode==='paper'?10:0,day(),status,'QP'+id.replaceAll('-','').slice(0,24)]);
 return (await one<Trade>(db,'SELECT * FROM trades WHERE id=$1',[id]))!;
}
function broker(t:Trade):Broker & Record<string,any>{
 return {history:vi.fn().mockResolvedValue([]),quote:vi.fn().mockResolvedValue({price:155,time:Date.now()}),orders:vi.fn().mockResolvedValue([{id:'order-1',symbol:t.symbol,qty:10,filledQty:10,tradedPrice:153.5,side:1,status:2,orderTag:t.entry_tag}]),positions:vi.fn().mockResolvedValue([{id:t.symbol+'-INTRADAY',symbol:t.symbol,productType:'INTRADAY',netQty:10,pl:0}]),place:vi.fn().mockResolvedValue('order-1'),cancel:vi.fn(),protect:vi.fn(),exit:vi.fn()};
}
describe('durable execution and recovery',()=>{
 it('uses actual broker fill for premium exits and installs protection',async()=>{
  const t=await fixture(),b=broker(t);await new Executor(db).reconcile(t,b);
  const updated=await one(db,'SELECT * FROM trades WHERE id=$1',[t.id]);
  expect(updated.entry).toBe(153.5);expect(updated.stop).toBe(143.5);expect(updated.target).toBe(173.5);expect(updated.protection_set).toBe(true);
  expect(b.protect).toHaveBeenCalledWith(t.symbol+'-INTRADAY',10,10);
 });
 it('never resubmits an uncertain entry',async()=>{
  const t=await fixture('live','submitting'),b=broker(t),ex=new Executor(db);
  b.place.mockRejectedValue(new BrokerError('timeout',true));
  await ex.submit(t,b);const unknown=await one<Trade>(db,'SELECT * FROM trades WHERE id=$1',[t.id]);
  expect(unknown!.status).toBe('unknown');await ex.submit(unknown!,b);expect(b.place).toHaveBeenCalledTimes(1);
  b.orders.mockResolvedValue([]);await ex.reconcile(unknown!,b);expect(b.place).toHaveBeenCalledTimes(1);
  expect((await one(db,'SELECT status FROM trades WHERE id=$1',[t.id])).status).toBe('unknown');
 });
 it('recovers a broker order by tag after a lost acknowledgement',async()=>{
  const t=await fixture('live','unknown');t.broker_order_id=null;
  const b=broker(t);b.orders.mockResolvedValue([{id:'found-order',symbol:t.symbol,qty:10,filledQty:10,tradedPrice:151,side:1,status:2,orderTag:'1:'+t.entry_tag}]);
  await new Executor(db).reconcile(t,b);expect((await one(db,'SELECT broker_order_id FROM trades WHERE id=$1',[t.id])).broker_order_id).toBe('found-order');expect(b.place).not.toHaveBeenCalled();
 });
 it('cancels a partial remainder, protects the fill, and waits for terminal entry before exit',async()=>{
  const t=await fixture(),b=broker(t),ex=new Executor(db);
  const partial={id:'order-1',symbol:t.symbol,qty:10,filledQty:4,tradedPrice:152,side:1,status:6};
  b.orders.mockResolvedValue([partial]);b.positions.mockResolvedValue([{id:'position-1',symbol:t.symbol,productType:'INTRADAY',netQty:4}]);
  await ex.reconcile(t,b);expect(b.cancel).toHaveBeenCalledWith('order-1');expect(b.protect).toHaveBeenCalledWith('position-1',4,10);expect(b.exit).not.toHaveBeenCalled();
  b.orders.mockResolvedValue([{...partial,status:1}]);await ex.reconcile((await one<Trade>(db,'SELECT * FROM trades WHERE id=$1',[t.id]))!,b);
  expect(b.exit).toHaveBeenCalledWith('position-1');expect((await one(db,'SELECT exit_requested FROM trades WHERE id=$1',[t.id])).exit_requested).toBe(true);
 });
 it('keeps an uncertain exit pending without a second exit submission',async()=>{
  const t=await fixture();await db.query('UPDATE trades SET exit_requested=true WHERE id=$1',[t.id]);const b=broker(t),ex=new Executor(db);b.exit.mockRejectedValue(new BrokerError('timeout',true));
  await ex.reconcile(t,b);const pending=(await one<Trade>(db,'SELECT * FROM trades WHERE id=$1',[t.id]))!;expect(pending.exit_sent_at).not.toBeNull();
  await ex.reconcile(pending,b);expect(b.exit).toHaveBeenCalledTimes(1);
  b.positions.mockResolvedValue([]);await ex.reconcile((await one<Trade>(db,'SELECT * FROM trades WHERE id=$1',[t.id]))!,b);
  await ex.reconcile((await one<Trade>(db,'SELECT * FROM trades WHERE id=$1',[t.id]))!,b,Date.now()+2000);
  expect((await one(db,'SELECT status,pnl FROM trades WHERE id=$1',[t.id]))).toMatchObject({status:'closed',pnl:null});
 });
 it('refuses to exit a position whose quantity differs from its own fill',async()=>{
  const t=await fixture(),b=broker(t);b.positions.mockResolvedValue([{id:'position-1',symbol:t.symbol,productType:'INTRADAY',netQty:20}]);await db.query('UPDATE trades SET exit_requested=true WHERE id=$1',[t.id]);
  await new Executor(db).reconcile(t,b);expect(b.exit).not.toHaveBeenCalled();expect(b.protect).not.toHaveBeenCalled();expect((await one(db,'SELECT status FROM setups WHERE id=$1',[t.setup_id])).status).toBe('attention');
 });
 it('requests an exit when protective orders cannot be confirmed',async()=>{
  const t=await fixture(),b=broker(t);b.protect.mockRejectedValue(new BrokerError('protection rejected'));
  await new Executor(db).reconcile(t,b);expect(b.exit).toHaveBeenCalledTimes(1);
 });
 it('honours stop-before-submit without a broker request',async()=>{
  const t=await fixture('live','submitting');await db.query('UPDATE trades SET exit_requested=true WHERE id=$1',[t.id]);
  const b=broker(t);await new Executor(db).submit(t,b);expect(b.place).not.toHaveBeenCalled();expect((await one(db,'SELECT status FROM trades WHERE id=$1',[t.id])).status).toBe('rejected');
 });
 it('paper fills a gapped stop at the observed quote, never the ideal stop',async()=>{
  const t=await fixture('paper','open'),b=broker(t);b.quote.mockResolvedValue({price:135,time:Date.now()});
  await new Executor(db).paper(t,b);const row=await one(db,'SELECT * FROM trades WHERE id=$1',[t.id]);expect(row.exit).toBe(135);expect(row.pnl).toBe(-150);expect(b.place).not.toHaveBeenCalled();expect(b.exit).not.toHaveBeenCalled();
 });
 it('enforces one active symbol and a single signal intent through database constraints',async()=>{
  const t=await fixture();
  await expect(db.query("INSERT INTO trades SELECT $1,user_id,setup_id,mode,symbol,instrument,side,multiplier,quantity,filled_qty,entry,stop,target,tick,signal_time+1,trading_day,status,broker_order_id,broker_position_id,$2,exit_requested,exit_sent_at,protection_set,position_seen,flat_since,last_price,last_quote_at,exit,pnl,reason,created_at,closed_at FROM trades WHERE id=$3",[randomUUID(),'new-tag',t.id])).rejects.toThrow();
 });
 it('locks entries for the day after a realised paper loss',async()=>{
  const t=await fixture('paper','open'),b=broker(t);await db.query("UPDATE trades SET status='closed',pnl=-1100,closed_at=now() WHERE id=$1",[t.id]);
  const engine=new Engine(db,cfg,new Vault(cfg.ENCRYPTION_KEY),undefined,async()=>b);
  await engine.account(t.user_id,Date.now());
  expect((await one(db,'SELECT reason FROM daily_halts WHERE user_id=$1',[t.user_id])).reason).toContain('loss');
  expect((await one(db,'SELECT status FROM setups WHERE id=$1',[t.setup_id])).status).toBe('paused');
 });
});
describe('broker boundary',()=>{
 it('does not retry a timed-out order and marks the result uncertain',async()=>{
  const transport=vi.fn().mockRejectedValue(new Error('network')),b=new Fyers('app','secret',transport);
  await expect(b.place({symbol:'NSE:TESTCE',quantity:10,side:1,entry:150,entry_tag:'QPtest'} as Trade)).rejects.toMatchObject({uncertain:true});
  expect(transport).toHaveBeenCalledTimes(1);
 });
 it('rejects stale quotes rather than placing trades on old prices',async()=>{
  const transport=vi.fn().mockResolvedValue(new Response(JSON.stringify({s:'ok',d:[{n:'NSE:TESTCE',s:'ok',v:{lp:150,tt:1}}]})));
  await expect(new Fyers('app','secret',transport).quote('NSE:TESTCE')).rejects.toThrow('Fresh');
 });
});


describe('end-to-end signal to persisted paper entry',()=>{
 it('creates exactly one durable trade for a passing closed-candle signal',async()=>{
  const t=await fixture('paper','open');
  await db.query('DELETE FROM trades WHERE id=$1',[t.id]);
  const {rows,underlying}=signalFixture(),b=broker(t);
  b.history.mockImplementation(async(symbol:string,resolution:string)=>resolution==='D'?[{time:Date.parse('2026-10-29T00:00:00+05:30')/1000,open:190,high:200,low:180,close:195,volume:100}]:symbol==='NSE:NIFTY50-INDEX'?underlying:rows);
  b.quote.mockResolvedValue({price:rows.at(-1)!.close,time:signalNow});
  const catalog={get:vi.fn().mockResolvedValue([{symbol:'NSE:TESTCE',token:'1',underlyingToken:'2',underlying:'NIFTY',expiry:'2026-10-30',type:'CE',strike:200,lot:10,tick:.05,multiplier:1,session:''}])} as unknown as InstrumentCatalog;
  const engine=new Engine(db,cfg,new Vault(cfg.ENCRYPTION_KEY),catalog,async()=>b);
  const setup=(await one<Setup>(db,'SELECT * FROM setups WHERE id=$1',[t.setup_id]))!;
  await engine.scan(setup,b,signalNow);await engine.scan(setup,b,signalNow);
  const trades=(await db.query('SELECT * FROM trades')).rows;
  expect(trades).toHaveLength(1);expect(trades[0].status).toBe('open');expect(trades[0].entry-trades[0].stop).toBeCloseTo(10);expect(trades[0].target-trades[0].entry).toBeCloseTo(20);
  expect(b.place).not.toHaveBeenCalled();
 });
 it('keeps a newly filled order active while broker position data is lagging',async()=>{
  const t=await fixture(),b=broker(t);b.positions.mockResolvedValue([]);
  await new Executor(db).reconcile(t,b);
  const row=await one(db,'SELECT * FROM trades WHERE id=$1',[t.id]);
  expect(row.status).toBe('pending');expect(row.closed_at).toBeNull();expect(row.filled_qty).toBe(10);
 });
 it('applies the commodity multiplier to paper P&L',async()=>{
  const t=await fixture('paper','open');await db.query('UPDATE trades SET multiplier=100,quantity=1,filled_qty=1 WHERE id=$1',[t.id]);
  const b=broker(t);b.quote.mockResolvedValue({price:170,time:Date.now()});
  await new Executor(db).paper((await one<Trade>(db,'SELECT * FROM trades WHERE id=$1',[t.id]))!,b);
  expect((await one(db,'SELECT pnl FROM trades WHERE id=$1',[t.id])).pnl).toBe(2000);
 });
});

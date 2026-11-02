import { parse } from 'csv-parse/sync';
import { day, MARKET_SYMBOLS, type Contract } from './domain.js';
export function parseMaster(csv:string):Contract[]{
  const rows=parse(csv,{relax_column_count:true,skip_empty_lines:true}) as string[][];
  const result:Contract[]=[];
  for(const r of rows){
    if(r.length<18||!r[9]?.includes(':'))continue;
    const type=r[16]==='CE'||r[16]==='PE'?r[16]:r[9].endsWith('FUT')?'FUT':r[9].endsWith('-EQ')?'EQ':null;
    if(!type)continue;
    const lot=Number(r[3]),tick=Number(r[4]),epoch=Number(r[8]),strike=Number(r[15]);
    if(!Number.isInteger(lot)||lot<1||!Number.isFinite(tick)||tick<=0)throw new Error('Symbol master has invalid contract sizing');
    if(type!=='EQ'&&(!Number.isFinite(epoch)||epoch<1000000000))throw new Error('Symbol master has invalid expiry');
    result.push({symbol:r[9],token:r[0],underlyingToken:r[17],underlying:r[13],expiry:type==='EQ'?'':day(epoch*1000),type,strike,lot,tick,session:r[6],multiplier:1,exchangeToken:r[12],underlyingCode:r[14]});
  }
  if(!result.length)throw new Error('Empty or incompatible symbol master');
  return result;
}
export function family(c:Contract,market:string){
  // Match only the requested standard contract, never CRUDEOILM or a different index.
  return c.underlying===market || (market==='NIFTY'&&c.underlying==='NIFTY50') || (market==='BANKNIFTY'&&c.underlying==='NIFTYBANK') || (market==='FINNIFTY'&&c.underlying==='FINNIFTY');
}
export function nearestContracts(all:Contract[],market:string,now:number) {
  const eligible=all.filter(c=>['CE','PE'].includes(c.type)&&family(c,market)&&c.expiry>=day(now));
  const expiry=eligible.map(c=>c.expiry).sort()[0];
  if(!expiry)throw new Error('No unexpired contracts available for '+market);
  return eligible.filter(c=>c.expiry===expiry);
}
export function underlyingSymbol(all:Contract[],contracts:Contract[],market:string){
  if(market in MARKET_SYMBOLS)return MARKET_SYMBOLS[market as keyof typeof MARKET_SYMBOLS];
  const tokens=new Set(contracts.map(c=>c.underlyingToken));
  if(tokens.size!==1)throw new Error('Commodity underlying mapping is ambiguous');
  const codes=new Set(contracts.map(c=>c.underlyingCode).filter(Boolean));
  const futures=all.filter(c=>c.type==='FUT'&&family(c,market)&&(tokens.has(c.token)||(c.exchangeToken&&codes.has(c.exchangeToken))));
  const future=futures.length===1?futures[0]:undefined;
  if(!future)throw new Error('Associated crude oil future unavailable; cannot use a guessed spot symbol');
  return future.symbol;
}
export function selectAtm(contracts:Contract[],price:number,type:'CE'|'PE') {
  const selected=contracts.filter(c=>c.type===type&&c.strike>0).sort((a,b)=>Math.abs(a.strike-price)-Math.abs(b.strike-price)||a.strike-b.strike)[0];
  if(!selected)throw new Error('ATM contract is unavailable');
  return selected;
}
export function parseJsonMaster(master:Record<string,any>,segment:string):Contract[]{
  const result:Contract[]=[];
  for(const [symbol,r] of Object.entries(master)){
    if(r.tradeStatus!==1)continue;
    const type=r.optType==='CE'||r.optType==='PE'?r.optType:symbol.endsWith('FUT')?'FUT':symbol.endsWith('-EQ')?'EQ':null;
    if(!type)continue;
    const underlying=String(r.underSym||r.exSymbol||'');
    if(segment==='NSE_FO'&&!['NIFTY','NIFTY50','BANKNIFTY','NIFTYBANK','FINNIFTY'].includes(underlying))continue;
    if(segment==='MCX_COM'&&underlying!=='CRUDEOIL')continue;
    const lot=Number(r.minLotSize),tick=Number(r.tickSize),multiplier=Number(r.qtyMultiplier),epoch=Number(r.expiryDate);
    if(!Number.isInteger(lot)||lot<1||!Number.isFinite(tick)||tick<=0||!Number.isFinite(multiplier)||multiplier<=0)throw new Error('Instrument sizing metadata is missing or invalid');
    if(type!=='EQ'&&(!Number.isFinite(epoch)||epoch<1000000000))throw new Error('Invalid instrument expiry');
    const underToken=String(r.underFyTok||''),prefix=String(r.exchange)+String(r.segment);
    // Commodity underlying tokens use a zero-padded exchange token, whereas
    // dated futures fyTokens embed the expiry. Resolve their exchange codes.
    const underlyingCode=underToken.startsWith(prefix)&&/^0+[0-9]+$/.test(underToken.slice(prefix.length))?underToken.slice(prefix.length).replace(/^0+/,''):undefined;
    result.push({symbol,token:String(r.fyToken),underlyingToken:underToken,underlying,expiry:type==='EQ'?'':day(epoch*1000),type,strike:Number(r.strikePrice),lot,tick,multiplier,session:String(r.tradingSession),exchangeToken:String(r.exToken),underlyingCode,freeze:Number(r.qtyFreeze)||undefined});
  }
  if(!result.length)throw new Error('No supported active instruments in symbol master');
  return result;
}
export class InstrumentCatalog{
  private cache=new Map<string,{day:string;rows:Contract[]}>();
  constructor(private transport:typeof fetch=fetch){}
  async get(segment:'NSE_FO'|'MCX_COM'|'NSE_CM',now=Date.now()){
    const cached=this.cache.get(segment);if(cached?.day===day(now))return cached.rows;
    const response=await this.transport('https://public.fyers.in/sym_details/'+segment+'_sym_master.json',{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('Instrument master download failed');
    const rows=parseJsonMaster(await response.json() as Record<string,any>,segment);this.cache.set(segment,{day:day(now),rows});return rows;
  }
}

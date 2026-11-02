import { z } from 'zod';
export const MARKET_SYMBOLS = { NIFTY:'NSE:NIFTY50-INDEX', BANKNIFTY:'NSE:NIFTYBANK-INDEX', FINNIFTY:'NSE:FINNIFTY-INDEX' } as const;
export const RULES = Object.freeze({version:'intraday-v2',timeframe:5,ma:20,rsiFast:14,rsiSlow:20,macd:[12,26,9],volumeLookback:5,stopPoints:10,targetPoints:20,expiry:'nearest',greenRequired:true});
export const riskSchema = z.object({
  riskPerTrade:z.number().min(10).max(100000), dailyLoss:z.number().min(10).max(1000000),
  capital:z.number().min(100).max(10000000), maxTrades:z.number().int().min(1).max(20),
}).strict().refine(x=>x.riskPerTrade<=x.dailyLoss,{message:'Risk per trade must not exceed the daily loss limit'});
export const setupSchema = z.object({
  mode:z.enum(['paper','live']), instrument:z.enum(['option','equity']), market:z.string().max(80), risk:riskSchema
}).strict().superRefine((x,ctx)=>{
  if(x.instrument==='option'&&!['NIFTY','BANKNIFTY','FINNIFTY','CRUDEOIL'].includes(x.market)) ctx.addIssue({code:'custom',message:'Select a supported options market'});
  if(x.instrument==='equity'&&!/^NSE:[A-Z0-9&_-]{2,40}-EQ$/.test(x.market)) ctx.addIssue({code:'custom',message:'Use an NSE equity symbol, for example NSE:RELIANCE-EQ'});
});
export type Risk = z.infer<typeof riskSchema>;
export type Setup = {id:string; user_id:string;mode:'paper'|'live';instrument:'option'|'equity';market:string;config:Risk;status:string;last_candle:number|null;snapshot:any};
export type Candle = {time:number;open:number;high:number;low:number;close:number;volume:number};
export type Contract = {symbol:string;token:string;underlyingToken:string;underlying:string;expiry:string;type:'CE'|'PE'|'FUT'|'EQ';strike:number;lot:number;tick:number;session:string;multiplier:number;exchangeToken?:string;underlyingCode?:string;freeze?:number};
export type Signal = {side:1|-1;stopDistance:number;stop:number;target:number;reference:number};
export type Evaluation = {candleTime?:number;checks:Record<string,boolean>;message:string;signal:Signal|null;values?:Record<string,number>;optionType?:'CE'|'PE'};
export type Trade = {id:string;user_id:string;setup_id:string;mode:'paper'|'live';symbol:string;instrument:string;side:1|-1;quantity:number;multiplier:number;filled_qty:number;entry:number;stop:number;target:number;tick:number;signal_time:number;trading_day:string;status:string;broker_order_id:string|null;broker_position_id:string|null;entry_tag:string;exit_requested:boolean;exit_sent_at:Date|null;protection_set:boolean;position_seen:boolean;flat_since:Date|null;last_price:number|null;last_quote_at:Date|null;created_at:Date;reason:string|null};
export function ist(now=Date.now()) {return new Date(now+19800000).toISOString();}
export function day(now=Date.now()) {return ist(now).slice(0,10);}
export function minute(now=Date.now()) {return ist(now).slice(11,16);}
export function roundTick(value:number,tick:number) {return Math.round(Math.round(value/tick)*tick*10000)/10000;}
export function quantityFor(risk:Risk,price:number,distance:number,lot:number,multiplier=1) {
  if (![price,distance,lot,multiplier].every(v=>Number.isFinite(v)&&v>0)) return 0;
  return Math.floor(Math.min(risk.riskPerTrade/(distance*multiplier),risk.capital/(price*multiplier))/lot)*lot;
}
export function levels(instrument:string,side:1|-1,fill:number,distance:number,tick:number) {
  const d=instrument==='option'?10:distance;
  return {stop:roundTick(fill-side*d,tick),target:roundTick(fill+side*d*2,tick)};
}


import { describe,it,expect } from 'vitest';
import { evaluate,rsi,closedCandles,previousRange } from '../src/strategy.js';
import { levels,quantityFor,setupSchema,type Candle,type Contract } from '../src/domain.js';
import { nearestContracts,selectAtm,underlyingSymbol,parseMaster,parseJsonMaster } from '../src/instruments.js';
import {now,signalFixture} from './fixtures.js';
describe('agreed options strategy',()=>{
 it('requires all conditions on completed option candles, using underlying breakout',()=>{
  const {rows,underlying,result}=signalFixture();expect(result.signal?.side).toBe(1);expect(Object.values(result.checks).every(Boolean)).toBe(true);expect(result.optionType).toBe('CE');
  expect(result.signal!.reference-result.signal!.stop).toBe(10);expect(result.signal!.target-result.signal!.reference).toBe(20);
  const pe=underlying.map(c=>({...c,open:170,close:171,high:172,low:169}));
  const put=evaluate(pe,rows,{high:200,low:180},now);expect(put.optionType).toBe('PE');expect(put.signal?.side).toBe(1);
 });
 it('does not require the candle to touch SMA20',()=>{const {rows,underlying,result}=signalFixture();rows.at(-1)!.low=(rows.at(-1)!.open+result.values!.sma)/2;expect(rows.at(-1)!.low).toBeGreaterThan(result.values!.sma);expect(evaluate(underlying,rows,{high:200,low:180},now).signal).not.toBeNull();});
 it('blocks a red candle even when both open and close exceed SMA20',()=>{const {rows,underlying}=signalFixture();rows.at(-1)!.open=rows.at(-1)!.close+0.1;const e=evaluate(underlying,rows,{high:200,low:180},now);expect(e.checks.candle).toBe(false);expect(e.signal).toBeNull();});
 it('excludes the signal candle from the previous-five volume average',()=>{const {rows,underlying}=signalFixture();rows.at(-1)!.volume=101;const e=evaluate(underlying,rows,{high:200,low:180},now);expect(e.values!.averageVolume).toBe(100);expect(e.checks.volume).toBe(true);rows.at(-1)!.volume=100;expect(evaluate(underlying,rows,{high:200,low:180},now).signal).toBeNull();});
 it('requires current breakout; an option premium breakout alone is insufficient',()=>{const {rows,underlying}=signalFixture();const u=underlying.map(c=>({...c,open:190,close:191,high:192,low:189}));expect(evaluate(u,rows,{high:200,low:180},now).signal).toBeNull();});
 it('rejects stale, unsynchronised and missing candles',()=>{const {rows,underlying}=signalFixture();expect(evaluate(underlying,rows,{high:200,low:180},now+120000).signal).toBeNull();expect(evaluate(underlying.slice(0,-1),rows,{high:200,low:180},now).signal).toBeNull();rows.splice(-3,1);expect(evaluate(underlying,rows,{high:200,low:180},now).message).toContain('gap');});
 it('excludes unfinished candles and validates OHLCV',()=>{const {rows}=signalFixture();const future={...rows.at(-1)!,time:Math.floor(now/1000),close:999,high:1000};expect(closedCandles([...rows,future],now)).toHaveLength(120);expect(()=>closedCandles([{...rows[0],low:-1}],now)).toThrow();});
 it('handles flat RSI and takes the previous trading session, not calendar day',()=>{expect(rsi(Array(100).fill(100),14).at(-1)).toBe(50);const monday=Date.parse('2026-11-02T10:00:00+05:30');const friday={time:Date.parse('2026-10-30T00:00:00+05:30')/1000,open:100,high:120,low:90,close:110,volume:100};expect(previousRange([friday,{...friday,time:monday/1000}],monday).date).toBe('2026-10-30');});
});
describe('sizing and fixed configuration',()=>{
 it('anchors stops and targets to actual fill, for both purchased CE and PE',()=>{expect(levels('option',1,153.5,99,.05)).toEqual({stop:143.5,target:173.5});});
 it('rounds quantities to broker lots and refuses insufficient budget',()=>{const risk={riskPerTrade:1000,dailyLoss:3000,capital:50000,maxTrades:3};expect(quantityFor(risk,150,10,75)).toBe(75);expect(quantityFor({...risk,riskPerTrade:500},150,10,75)).toBe(0);expect(quantityFor(risk,150,10,0)).toBe(0);});
 it('rejects attempts to override the strategy from the API',()=>{expect(setupSchema.safeParse({mode:'paper',instrument:'option',market:'NIFTY',timeframe:1,risk:{riskPerTrade:500,dailyLoss:1000,capital:10000,maxTrades:3}}).success).toBe(false);});
});
describe('contract selection',()=>{
 const contract=(expiry:string,strike:number,type:'CE'|'PE'='CE'):Contract=>({symbol:'NSE:NIFTY'+expiry+strike+type,token:'123',underlyingToken:'99',underlying:'NIFTY',expiry,type,strike,lot:75,tick:.05,session:'',multiplier:1});
 it('uses same-day expiry and nearest strike with deterministic lower tie',()=>{const all=[contract('2026-10-29',100),contract('2026-10-30',100),contract('2026-10-30',150),contract('2026-11-06',120)];const nearest=nearestContracts(all,'NIFTY',now);expect(nearest).toHaveLength(2);expect(selectAtm(nearest,125,'CE').strike).toBe(100);expect(selectAtm(nearest,140,'CE').strike).toBe(150);});
 it('never mixes CE history with PE selection or a different index',()=>{const all=[contract('2026-10-30',100),{...contract('2026-10-30',100,'PE'),underlying:'BANKNIFTY'}];expect(()=>selectAtm(nearestContracts(all,'NIFTY',now),100,'PE')).toThrow();});
 it('requires the exact commodity futures mapping, excluding mini contracts',()=>{const ce={...contract('2026-10-30',6000),underlying:'CRUDEOIL',underlyingToken:'future'};const f={...ce,type:'FUT' as const,token:'future',symbol:'MCX:CRUDEOIL26NOVFUT'};expect(underlyingSymbol([ce,f],[ce],'CRUDEOIL')).toBe(f.symbol);expect(()=>underlyingSymbol([ce],[ce],'CRUDEOIL')).toThrow();expect(()=>nearestContracts([{...ce,underlying:'CRUDEOILM'}],'CRUDEOIL',now)).toThrow();});
 it('parses current symbol-master columns instead of hardcoding lot sizes',()=>{const row=['token','name','14','75','.05','isin','0915-1530','date',String(now/1000),'NSE:NIFTYTESTCE','10','11','123','NIFTY','999','25000','CE','99','','',''];const c=parseMaster(row.join(','))[0];expect(c.lot).toBe(75);expect(c.tick).toBe(.05);expect(c.underlyingToken).toBe('99');});
});



describe('commodity risk metadata',()=>{
 it('sizes a crude oil lot using its 100-unit price multiplier',()=>{
  const risk={riskPerTrade:1000,dailyLoss:3000,capital:50000,maxTrades:3};
  expect(quantityFor(risk,150,10,1,100)).toBe(1);
  expect(quantityFor({...risk,riskPerTrade:999},150,10,1,100)).toBe(0);
 });
 it('maps zero-padded underlying tokens to dated futures using exchange tokens',()=>{
  const base={tradeStatus:1,underSym:'CRUDEOIL',exSymbol:'CRUDEOIL',minLotSize:1,tickSize:.1,qtyMultiplier:100,expiryDate:String(now/1000),exchange:11,segment:20,tradingSession:'0900-2355'};
  const rows=parseJsonMaster({
   'MCX:CRUDEOIL26NOV7900CE':{...base,optType:'CE',strikePrice:7900,fyToken:'1120261117582829',exToken:582829,underFyTok:'1120000000573422'},
   'MCX:CRUDEOIL26NOVFUT':{...base,optType:'XX',strikePrice:-1,fyToken:'1120261119573422',exToken:573422,underFyTok:'1120000000294'},
   'MCX:INACTIVECE':{...base,tradeStatus:0,optType:'CE'}
  },'MCX_COM');
  expect(rows).toHaveLength(2);expect(rows[0].multiplier).toBe(100);
  expect(underlyingSymbol(rows,[rows[0]],'CRUDEOIL')).toBe('MCX:CRUDEOIL26NOVFUT');
  expect(()=>parseJsonMaster({'MCX:TESTCE':{...base,optType:'CE',qtyMultiplier:undefined}},'MCX_COM')).toThrow('sizing');
 });
});

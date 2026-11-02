import { day, type Candle, type Evaluation } from './domain.js';
export function ema(values:number[],length:number) {let current=values[0];return values.map(v=>current+=(v-current)*2/(length+1));}
export function rsi(values:number[],length:number): (number|null)[] {
  const out:(number|null)[]=values.map(()=>null); if(values.length<=length)return out;
  let gain=0,loss=0;
  for(let i=1;i<=length;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d)/length;loss+=Math.max(0,-d)/length;}
  for(let i=length;i<values.length;i++){
    if(i>length){const d=values[i]-values[i-1];gain=(gain*(length-1)+Math.max(d,0))/length;loss=(loss*(length-1)+Math.max(-d,0))/length;}
    out[i]=gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
  } return out;
}
export function closedCandles(rows:Candle[],now:number):Candle[]{
  const unique=new Map<number,Candle>();
  for(const c of rows){
    if(!Object.values(c).every(Number.isFinite)||!Number.isInteger(c.time)||c.low<=0||c.volume<0||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||c.high<c.low)throw new Error('Invalid OHLCV data');
    if(c.time*1000+300000<=now)unique.set(c.time,c);
  }
  return [...unique.values()].sort((a,b)=>a.time-b.time);
}
export function previousRange(daily:Candle[],now:number) {
  const prior=daily.filter(c=>day(c.time*1000)<day(now)).sort((a,b)=>b.time-a.time)[0];
  if(!prior||now-prior.time*1000>10*86400000||prior.high<=prior.low||prior.low<=0)throw new Error('Previous trading session unavailable');
  return {high:prior.high,low:prior.low,date:day(prior.time*1000)};
}
export function evaluate(underlying:Candle[],premium:Candle[],range:{high:number;low:number},now:number,instrument:'option'|'equity'='option'):Evaluation{
  const u=closedCandles(underlying,now),p=closedCandles(premium,now),c=p.at(-1),spot=u.at(-1);
  const wait=(message:string):Evaluation=>({signal:null,checks:{},message,candleTime:c?.time});
  if(p.length<100||!c||!spot)return wait('Warming up: 100 completed candles on the selected contract are required');
  if(day(c.time*1000)!==day(now)||now-(c.time*1000+300000)>90000)return wait('Waiting for fresh completed candles');
  if(c.time!==spot.time||p.at(-2)!.time!==c.time-300)return wait('Underlying and option candles must be synchronized and consecutive');
  // Intraday gaps in the recent indicator window are rejected. Overnight/session
  // gaps are expected; do not stitch different option contracts when ATM changes.
  for(let i=p.length-20;i<p.length;i++)if(i>0&&day(p[i].time*1000)===day(p[i-1].time*1000)&&p[i].time-p[i-1].time!==300)return wait('Recent candle history has a gap');
  const values=p.map(x=>x.close),sma=values.slice(-20).reduce((a,b)=>a+b,0)/20;
  const r14=rsi(values,14),r20=rsi(values,20),fast=ema(values,12),slow=ema(values,26),macd=fast.map((v,i)=>v-slow[i]),signal=ema(macd,9);
  const avg=p.slice(-6,-1).reduce((a,b)=>a+b.volume,0)/5;
  const direction=spot.close>range.high?1:spot.close<range.low?-1:0;
  const side:1|-1=instrument==='option'?1:direction===-1?-1:1;
  const body=Math.abs(c.close-c.open);
  const ma=instrument==='option'?c.open>sma&&c.close>sma:body>0&&(side===1?c.low<=sma&&c.close>=sma&&(c.close-Math.max(c.open,sma))/body>=0.6:c.high>=sma&&c.close<=sma&&(Math.min(c.open,sma)-c.close)/body>=0.6);
  const checks={
    breakout:direction!==0,
    candle:side===1?c.close>c.open:c.close<c.open,
    ma,
    rsi:side===1?r14.at(-2)!<=r20.at(-2)!&&r14.at(-1)!>r20.at(-1)!:r14.at(-2)!>=r20.at(-2)!&&r14.at(-1)!<r20.at(-1)!,
    macd:side===1?macd.at(-1)!>signal.at(-1)!:macd.at(-1)!<signal.at(-1)!,
    volume:c.volume>avg&&avg>0,
  };
  const distance=instrument==='option'?10:side===1?c.close-Math.min(...p.slice(-3,-1).map(x=>x.low)):Math.max(...p.slice(-3,-1).map(x=>x.high))-c.close;
  const all=Object.values(checks).every(Boolean)&&distance>0&&c.close-distance>0;
  return {candleTime:c.time,checks,optionType:direction===1?'CE':direction===-1?'PE':undefined,
    values:{underlying:spot.close,previousHigh:range.high,previousLow:range.low,sma,rsi14:r14.at(-1)!,rsi20:r20.at(-1)!,macd:macd.at(-1)!,macdSignal:signal.at(-1)!,volume:c.volume,averageVolume:avg,premium:c.close},
    signal:all?{side,reference:c.close,stopDistance:distance,stop:c.close-side*distance,target:c.close+side*distance*2}:null,
    message:all?'All entry conditions passed':'Waiting for all entry conditions'};
}


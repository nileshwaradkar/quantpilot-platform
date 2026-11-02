import { evaluate } from '../src/strategy.js';
import type { Candle } from '../src/domain.js';
export const now=Date.parse('2026-10-30T11:30:10+05:30');
export function signalFixture(){
 const last=Math.floor(now/1000)-310;let seed=123456;
 for(let attempt=0;attempt<2000;attempt++){
  let close=100;
  const rows:Candle[]=Array.from({length:120},(_,i)=>{
   seed=(seed*1664525+1013904223)>>>0;close+=((seed/4294967296)-0.45)*2;
   return {time:last-(119-i)*300,open:close-0.2,high:close+1,low:close-1,close,volume:i===119?300:100};
  });
  const underlying=rows.map(c=>({...c,open:201,close:202,high:203,low:200}));
  const result=evaluate(underlying,rows,{high:200,low:180},now);
  if(result.signal)return {rows,underlying,result};
 }
 throw new Error('Fixture generation failed');
}

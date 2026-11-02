import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Candle, Trade } from './domain.js';
export class BrokerError extends Error {constructor(message:string,public uncertain=false){super(message);}}
const candleSchema=z.tuple([z.number(),z.number(),z.number(),z.number(),z.number(),z.number()]);
export const orderSchema=z.object({id:z.coerce.string(),symbol:z.string(),status:z.number(),filledQty:z.number(),qty:z.number(),tradedPrice:z.number(),side:z.number(),orderTag:z.string().optional(),remainingQuantity:z.number().optional()});
export const positionSchema=z.object({id:z.string(),symbol:z.string(),netQty:z.number(),productType:z.string(),pl:z.number().optional(),netAvg:z.number().optional()});
export type Order=z.infer<typeof orderSchema>;
export type Position=z.infer<typeof positionSchema>;
export interface Broker {
 history(symbol:string,resolution:'5'|'D',now?:number):Promise<Candle[]>;
 quote(symbol:string,now?:number):Promise<{price:number;time:number}>;
 orders():Promise<Order[]>; positions():Promise<Position[]>;
 place(trade:Trade):Promise<string>;cancel(id:string):Promise<void>;
 protect(positionId:string,qty:number,stopDistance:number):Promise<void>;exit(id:string):Promise<void>;
}
export class Fyers implements Broker{
 private last=0;
 constructor(private appId:string,private token:string,private transport:typeof fetch=fetch){}
 async request(method:string,path:string,body?:unknown,params?:Record<string,string>,auth=true):Promise<any>{
  // A worker uses one adapter sequentially per account. No automatic mutation retries.
  const delay=220-(Date.now()-this.last);if(delay>0)await new Promise(r=>setTimeout(r,delay));this.last=Date.now();
  const url=new URL(path,'https://api-t1.fyers.in');if(params)url.search=new URLSearchParams(params).toString();
  let response:Response,data:any;
  try{
   response=await this.transport(url,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:this.appId+':'+this.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
   data=await response.json();
  }catch{throw new BrokerError('FYERS connection failed; pending orders require reconciliation',method!=='GET');}
  if(response.status>=500||data.code===201)throw new BrokerError('FYERS has not confirmed this request',method!=='GET');
  if(!response.ok||data.s!=='ok')throw new BrokerError('FYERS rejected the request. Check authorization, permissions and broker status.');
  return data;
 }
 async history(symbol:string,resolution:'5'|'D',now=Date.now()){
  const data=await this.request('GET','/data/history',undefined,{symbol,resolution,date_format:'0',range_from:String(Math.floor(now/1000)-20*86400),range_to:String(Math.floor(now/1000)),cont_flag:'0'});
  return z.array(candleSchema).parse(data.candles).map(([time,open,high,low,close,volume])=>({time,open,high,low,close,volume}));
 }
 async quote(symbol:string,now=Date.now()){
  const data=await this.request('GET','/data/quotes',undefined,{symbols:symbol});
  const row=data.d?.find((x:any)=>x.n===symbol&&x.s==='ok'),price=Number(row?.v?.lp),time=Number(row?.v?.tt)*1000;
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(time)||now-time>30000||time>now+5000)throw new BrokerError('Fresh market quote unavailable');
  return {price,time};
 }
 async orders(){return z.array(orderSchema).parse((await this.request('GET','/api/v3/orders')).orderBook);}
 async positions(){return z.array(positionSchema).parse((await this.request('GET','/api/v3/positions')).netPositions);}
 async place(t:Trade){
  const data=await this.request('POST','/api/v3/orders/sync',{symbol:t.symbol,qty:t.quantity,type:1,side:t.side,productType:'INTRADAY',limitPrice:t.entry,stopPrice:0,validity:'DAY',disclosedQty:0,offlineOrder:false,stopLoss:0,takeProfit:0,orderTag:t.entry_tag,isSliceOrder:false});
  if(!data.id)throw new BrokerError('Missing broker order ID; reconcile before any new order',true);
  return String(data.id);
 }
 async cancel(id:string){await this.request('DELETE','/api/v3/orders/sync',{id});}
 async protect(positionId:string,qty:number,distance:number){await this.request('PATCH','/api/v3/positions',{positionId,qty,stopLoss:distance,takeProfit:distance*2,legType:1});}
 async exit(id:string){await this.request('DELETE','/api/v3/positions',{id});}
 async profile(){const d=await this.request('GET','/api/v3/profile');return z.object({fy_id:z.string().min(3)}).parse(d.data);}
 async exchange(secret:string,code:string){const d=await this.request('POST','/api/v3/validate-authcode',{grant_type:'authorization_code',appIdHash:createHash('sha256').update(this.appId+':'+secret).digest('hex'),code},undefined,false);return z.string().min(10).parse(d.access_token);}
}
export function authUrl(appId:string,origin:string,state:string){return 'https://api-t1.fyers.in/api/v3/generate-authcode?'+new URLSearchParams({client_id:appId,redirect_uri:origin+'/api/broker/callback',response_type:'code',state});}


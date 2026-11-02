import { audit, one, type Database } from './db.js';
import { BrokerError, type Broker } from './broker.js';
import { levels, type Trade } from './domain.js';
export function matchesTag(actual:string|undefined,expected:string){return actual===expected||actual?.split(':').at(-1)===expected;}
export class Executor{
 constructor(private db:Database){}
 async submit(trade:Trade,broker:Broker){
  const fresh=await one<Trade>(this.db,'SELECT * FROM trades WHERE id=$1',[trade.id]);
  if(!fresh||fresh.status!=='submitting')return;
  if(fresh.exit_requested){await this.db.query("UPDATE trades SET status='rejected',reason='Stopped before submission',closed_at=now() WHERE id=$1",[trade.id]);return;}
  try{
   const id=await broker.place(fresh);
   await this.db.query("UPDATE trades SET broker_order_id=$2,status='pending' WHERE id=$1",[trade.id,id]);
   await audit(this.db,trade.user_id,'Order acknowledged',{trade:trade.id});
  }catch(e){
   const status=e instanceof BrokerError&&!e.uncertain?'rejected':'unknown';
   await this.db.query('UPDATE trades SET status=$2,reason=$3 WHERE id=$1',[trade.id,status,status==='unknown'?'Submission outcome uncertain; no automatic resubmission':'Broker rejected entry']);
   await this.attention(trade,'Order requires review');
  }
 }
 async attention(t:Trade,reason:string){
  const previous=await one(this.db,'SELECT status,snapshot FROM setups WHERE id=$1',[t.setup_id]);
  if(previous?.status==='attention'&&previous.snapshot?.message===reason)return;
  await this.db.query("UPDATE setups SET status='attention',snapshot=jsonb_build_object('message',$2::text) WHERE id=$1",[t.setup_id,reason]);
  await audit(this.db,t.user_id,reason,{trade:t.id});
 }
 async reconcile(t:Trade,b:Broker,now=Date.now()){
  const orders=await b.orders(),positions=await b.positions();
  const matches=orders.filter(o=>t.broker_order_id?o.id===t.broker_order_id:matchesTag(o.orderTag,t.entry_tag));
  if(matches.length>1){await this.attention(t,'Multiple broker orders match one intent');return;}
  const order=matches[0];
  // A crash after persisting an intent can precede or follow the network send.
  // Absence in the order book is not proof that it is safe to resubmit.
  if(!order){await this.db.query("UPDATE trades SET status='unknown' WHERE id=$1",[t.id]);await this.attention(t,'Order not found; verify directly in FYERS');return;}
  if(order.symbol!==t.symbol||order.side!==t.side||order.qty!==t.quantity){await this.attention(t,'Broker order does not match persisted intent');return;}
  const terminal=[1,2,5,7].includes(order.status);
  const pos=positions.find(p=>p.symbol===t.symbol&&p.productType==='INTRADAY'&&p.netQty!==0);
  const filled=order.filledQty;
  if(filled<0||filled>t.quantity||!Number.isInteger(filled)){await this.attention(t,'Invalid fill quantity');return;}
  if(filled===0&&terminal){
   await this.db.query("UPDATE trades SET status='rejected',broker_order_id=$2,reason='Entry ended without a fill',closed_at=now() WHERE id=$1",[t.id,order.id]);return;
  }
  if(filled===0){
   await this.db.query("UPDATE trades SET status='pending',broker_order_id=$2 WHERE id=$1",[t.id,order.id]);
   if(t.exit_requested||now-new Date(t.created_at).getTime()>60000){await b.cancel(order.id);await this.db.query('UPDATE trades SET exit_requested=true WHERE id=$1',[t.id]);}
   return;
  }
  if(!Number.isFinite(order.tradedPrice)||order.tradedPrice<=0){await this.attention(t,'Fill price unavailable');return;}
  const distance=t.instrument==='option'?10:Math.abs(t.entry-t.stop);
  const prices=levels(t.instrument,t.side,order.tradedPrice,distance,t.tick);
  if(!pos){
   if(!terminal){await b.cancel(order.id);await this.db.query('UPDATE trades SET exit_requested=true WHERE id=$1',[t.id]);return;}
   if(!t.position_seen){
    await this.db.query("UPDATE trades SET status='pending',filled_qty=$2,broker_order_id=$3,reason='Waiting for broker position visibility' WHERE id=$1",[t.id,filled,order.id]);
    await this.attention(t,'Filled order has no visible position yet; reconcile in FYERS');
    return;
   }
   if(!t.flat_since){await this.db.query('UPDATE trades SET flat_since=now() WHERE id=$1',[t.id]);return;}
   if(now-new Date(t.flat_since).getTime()<1000)return;
   await this.db.query("UPDATE trades SET status='closed',filled_qty=$2,broker_order_id=$3,closed_at=now(),reason='Broker position confirmed flat; verify fills in FYERS' WHERE id=$1",[t.id,filled,order.id]);
   // Do not invent a trade P&L from an account-wide position aggregate.
   await audit(this.db,t.user_id,'Broker position confirmed flat',{trade:t.id});return;
  }
  if(pos.netQty!==filled*t.side){await this.attention(t,'Position quantity differs from this trade; reconcile in FYERS');return;}
  await this.db.query("UPDATE trades SET filled_qty=$2,entry=$3,stop=$4,target=$5,broker_order_id=$6,broker_position_id=$7,status=$8,position_seen=true,flat_since=NULL WHERE id=$1",[t.id,filled,order.tradedPrice,prices.stop,prices.target,order.id,pos.id,t.exit_sent_at?'exit_pending':'open']);
  if(!terminal){
   // Cancel the unfilled remainder before exiting; a late fill must not reopen it.
   await this.db.query('UPDATE trades SET exit_requested=true WHERE id=$1',[t.id]);
   try{await b.cancel(order.id);}catch{await this.attention(t,'Partial fill cancellation not confirmed; protecting filled quantity');}
  }
  if(!t.protection_set||filled!==t.filled_qty||order.tradedPrice!==t.entry){
   try{if(prices.stop<=0)throw new Error('Invalid protective price');await b.protect(pos.id,Math.abs(pos.netQty),distance);await this.db.query('UPDATE trades SET protection_set=true WHERE id=$1',[t.id]);}
   catch{
    await this.db.query('UPDATE trades SET exit_requested=true WHERE id=$1',[t.id]);
    await this.attention(t,'Protection not confirmed; exit requested');
    t.exit_requested=true;
   }
  }
  // Reload the exit flag so emergency-stop requests made during broker I/O apply.
  const requested=await one(this.db,'SELECT exit_requested,exit_sent_at FROM trades WHERE id=$1',[t.id]);
  if(requested?.exit_requested&&terminal&&!requested.exit_sent_at){
   // Persist before sending. An uncertain exit is reconciled, never blindly repeated.
   await this.db.query("UPDATE trades SET status='exit_pending',exit_sent_at=now() WHERE id=$1",[t.id]);
   try{await b.exit(pos.id);await audit(this.db,t.user_id,'Exit submitted; confirmation pending',{trade:t.id});}
   catch(e){
    if(e instanceof BrokerError&&!e.uncertain)await this.db.query('UPDATE trades SET exit_sent_at=NULL WHERE id=$1',[t.id]);
    await this.attention(t,'Exit not confirmed; check FYERS');
   }
  }else if(requested?.exit_sent_at&&now-new Date(requested.exit_sent_at).getTime()>60000){
   await this.attention(t,'Exit still pending; check FYERS before retrying');
  }
 }
 async paper(t:Trade,b:Broker){
  const q=await b.quote(t.symbol);
  await this.db.query('UPDATE trades SET last_price=$2,last_quote_at=$3 WHERE id=$1',[t.id,q.price,new Date(q.time)]);
  const stop=(q.price-t.stop)*t.side<=0,target=(q.price-t.target)*t.side>=0;
  const fresh=await one(this.db,'SELECT exit_requested FROM trades WHERE id=$1',[t.id]);
  if(!stop&&!target&&!fresh?.exit_requested)return;
  // Quote-based simulation: gaps can exceed the requested stop. Never invent a
  // perfect stop fill after a downtime or a market gap.
  const pnl=Math.round((q.price-t.entry)*t.side*t.filled_qty*t.multiplier*100)/100;
  await this.db.transaction(async tx=>{
   await tx.query("UPDATE trades SET status='closed',exit=$2,pnl=$3,closed_at=now(),reason=$4 WHERE id=$1 AND status='open'",[t.id,q.price,pnl,stop?'Stop-loss':target?'Profit target':'Exit requested']);
   await audit(tx,t.user_id,'Paper position closed',{trade:t.id,pnl});
  });
 }
}


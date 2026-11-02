import { config } from './config.js';
import { database } from './db.js';
import { Vault } from './security.js';
import { Engine } from './engine.js';
const c=config(),db=database(c.DATABASE_URL);
let stopping=false,healthy=false,lastCycle=Date.now(),cleanupAt=0;
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{stopping=true;});
const lease=await db.pool.connect();
lease.on('error',()=>{healthy=false;stopping=true;console.error('Worker lease lost; terminating');process.exit(1);});
// During a Render rolling deploy the new process waits for the existing owner.
// Standby workers never send orders or publish a healthy heartbeat.
while(!stopping){
 const locked=(await lease.query('SELECT pg_try_advisory_lock(7121902) AS acquired')).rows[0].acquired;
 if(locked){healthy=true;break;}
 await new Promise(r=>setTimeout(r,2000));
}
if(!healthy){lease.release();await db.close();process.exit(0);}
await db.query('SELECT version FROM schema_migrations WHERE version=2');
await db.query("UPDATE setups SET status='paused',snapshot=jsonb_build_object('message','Worker restarted. Existing positions are being reconciled; restart monitoring when ready.') WHERE status='running'");
const engine=new Engine(db,c,new Vault(c.ENCRYPTION_KEY),undefined,undefined,()=>healthy&&!stopping&&Date.now()-lastCycle<90000);
const heartbeat=setInterval(()=>{
 if(!healthy||stopping)return;
 // A responsive event loop alone does not prove the trading cycle is healthy.
 if(Date.now()-lastCycle>90000){healthy=false;stopping=true;console.error('Trading cycle exceeded 90 seconds; supervisor must restart worker');process.exit(1);}
 void lease.query("INSERT INTO worker_health(id,heartbeat) VALUES('trading',now()) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat").catch(()=>{healthy=false;stopping=true;process.exit(1);});
},10000);
try{
 while(!stopping&&healthy){
  const started=Date.now();
  try{
   await engine.tick();
   if(Date.now()-cleanupAt>3600000){
    await db.query('DELETE FROM sessions WHERE expires_at<now()');
    await db.query('DELETE FROM auth_tokens WHERE expires_at<now()');
    await db.query('DELETE FROM rate_limits WHERE expires_at<now()');
    cleanupAt=Date.now();
   }
   lastCycle=Date.now();
  }catch{console.error('Trading cycle failed; no automatic order retries');}
  if(!stopping)await new Promise(r=>setTimeout(r,Math.max(1000,5000-(Date.now()-started))));
 }
}finally{
 clearInterval(heartbeat);healthy=false;
 await lease.query("DELETE FROM worker_health WHERE id='trading'");
 await lease.query('SELECT pg_advisory_unlock(7121902)');lease.release();await db.close();
}


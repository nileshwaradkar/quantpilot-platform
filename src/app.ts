import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { serveUi } from './static.js';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { audit, one, type Database } from './db.js';
import { Vault, randomToken, digest, equal, passwordHash, passwordValid } from './security.js';
import { RULES, setupSchema, day } from './domain.js';
import { Fyers, authUrl } from './broker.js';
import { mailer, type Mailer } from './mail.js';
import type { Config } from './config.js';
class HttpError extends Error{constructor(public statusCode:number,message:string){super(message);}}
const emailSchema=z.email().max(254).transform(v=>v.toLowerCase().trim());
const credentials=z.object({email:emailSchema,password:z.string().min(12).max(128)});
const idSchema=z.uuid();
const authPublic=new Set(['/api/auth/login','/api/auth/register','/api/auth/request-reset','/api/auth/reset','/api/auth/verify','/api/auth/resend']);
export async function buildApp(db:Database,c:Config,sendMail:Mailer=mailer(c)){
 const app=Fastify({logger:{level:'info',redact:['req.headers.cookie','req.headers.authorization','req.body','res.headers.set-cookie']},disableRequestLogging:true,trustProxy:c.NODE_ENV==='production'?(_address: string, hop: number)=>hop===0:false,bodyLimit:16384});
 const vault=new Vault(c.ENCRYPTION_KEY),dummyHash=await passwordHash(randomToken());
 await app.register(cookie);
 await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],objectSrc:["'none'"],baseUri:["'none'"],frameAncestors:["'none'"],formAction:["'self'"],upgradeInsecureRequests:c.NODE_ENV==='production'?[]:null}},referrerPolicy:{policy:'no-referrer'},hsts:c.NODE_ENV==='production'?{maxAge:31536000}:false});
 async function session(req:any){const token=req.cookies.qp_session;if(!token)return;return one(db,'SELECT s.*,u.email,u.name,u.verified FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now()',[digest(token)]);}
 async function user(req:any){const s=await session(req);if(!s)throw new HttpError(401,'Please sign in');return s;}
 async function limit(key:string,max:number,seconds:number){
  const row=await one(db,"INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING count",[digest(key),seconds]);
  if(row.count>max)throw new HttpError(429,'Too many requests. Please try again later.');
 }
 app.addHook('onRequest',async(req,reply)=>{
  const path=req.url.split('?')[0];
  if(path.startsWith('/api/')){
   reply.header('Cache-Control','no-store');
   await limit('ip:'+req.ip,600,60);
   if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    if(req.headers.origin!==c.APP_ORIGIN)throw new HttpError(403,'Request origin rejected');
    if(!authPublic.has(path)){
     const s=await user(req);
     if(!equal(String(req.headers['x-csrf-token']||''),s.csrf))throw new HttpError(403,'Session validation failed. Refresh and try again.');
    }
   }
  }
 });
 app.setErrorHandler((error:any,req,reply)=>{
  if(error instanceof ZodError)return reply.code(400).send({error:error.issues.map(i=>i.message).join('; ')});
  if(error.code==='23505')return reply.code(409).send({error:'This record or broker account is already registered.'});
  if(error instanceof HttpError)return reply.code(error.statusCode).send({error:error.message});
  if(error.statusCode&&error.statusCode<500)return reply.code(error.statusCode).send({error:'Invalid request'});
  // Never serialize upstream errors, tokens, SQL parameters or OAuth query strings.
  req.log.error({event:'request_failed',method:req.method,path:req.url.split('?')[0]},'Request failed');
  return reply.code(503).send({error:'Service temporarily unavailable. Please retry or check the activity log.'});
 });
 async function newSession(reply:any,uid:string){
  const token=randomToken(),csrf=randomToken();
  await db.query("INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",[digest(token),uid,csrf]);
  reply.setCookie('qp_session',token,{path:'/',httpOnly:true,secure:c.NODE_ENV==='production',sameSite:'lax',maxAge:43200});
  return csrf;
 }
 async function sendToken(uid:string,email:string,purpose:'verify'|'reset'){
  const token=randomToken();
  await db.transaction(async tx=>{
   await tx.query('DELETE FROM auth_tokens WHERE user_id=$1 AND purpose=$2',[uid,purpose]);
   await tx.query("INSERT INTO auth_tokens(hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",[digest(token),uid,purpose]);
  });
  await sendMail(email,purpose,token);
 }
 app.get('/healthz',async()=>{await db.query('SELECT 1');return {status:'ok'};});
 app.get('/api/config',async()=>({rules:RULES,hostingProfile:c.DEPLOYMENT_PROFILE,inviteRequired:!!c.REGISTRATION_CODE,emailEnabled:!!c.SMTP_HOST,brokerConfigured:!!c.FYERS_APP_ID&&!!c.FYERS_APP_SECRET,liveEnabled:c.LIVE_TRADING_ENABLED==='true',squareOff:{index:'15:15',crudeoil:c.MCX_SQUARE_OFF}}));
 app.post('/api/auth/register',async(req,reply)=>{
  await limit('register:'+req.ip,5,3600);
  const data=credentials.extend({name:z.string().trim().min(2).max(60),invite:z.string().max(200).default('')}).strict().parse(req.body);
  if(c.REGISTRATION_CODE&&!equal(data.invite,c.REGISTRATION_CODE))throw new HttpError(403,'Invitation code is invalid');
  const id=randomUUID(),hash=await passwordHash(data.password);
  const verified=!!c.REGISTRATION_CODE||c.NODE_ENV!=='production'&&!c.SMTP_HOST;
  await db.query('INSERT INTO users(id,email,name,password_hash,verified) VALUES($1,$2,$3,$4,$5)',[id,data.email,data.name,hash,verified]);
  await audit(db,id,'Account registered');
  if(!verified)await sendToken(id,data.email,'verify');
  const csrf=await newSession(reply,id);
  return {csrf,verificationRequired:!verified};
 });
 app.post('/api/auth/login',async(req,reply)=>{
  await limit('login:'+req.ip,15,900);
  const data=credentials.parse(req.body);await limit('email:'+data.email,20,900);
  const u=await one(db,'SELECT * FROM users WHERE email=$1',[data.email]);
  const valid=await passwordValid(data.password,u?.password_hash||dummyHash);
  if(!u||!valid)throw new HttpError(401,'Email or password is incorrect');
  const old=req.cookies.qp_session;if(old)await db.query('DELETE FROM sessions WHERE id=$1',[digest(old)]);
  const csrf=await newSession(reply,u.id);await audit(db,u.id,'Signed in');return {csrf};
 });
 app.post('/api/auth/logout',async(req,reply)=>{const s=await user(req);await db.query('DELETE FROM sessions WHERE id=$1',[s.id]);reply.clearCookie('qp_session',{path:'/'});return {ok:true};});
 for(const [route,purpose] of [['request-reset','reset'],['resend','verify']] as const){
  app.post('/api/auth/'+route,async req=>{
   await limit(route+':'+req.ip,5,3600);
   const {email}=z.object({email:emailSchema}).parse(req.body);
   if(!c.SMTP_HOST)throw new HttpError(409,'Email is not configured. Contact the platform operator.');
   const u=await one(db,'SELECT id,verified FROM users WHERE email=$1',[email]);
   if(u&&(purpose==='reset'||!u.verified))await sendToken(u.id,email,purpose);
   return {message:'If the account is eligible, an email has been sent.'};
  });
 }
 app.post('/api/auth/verify',async req=>{
  const {token}=z.object({token:z.string().min(20).max(100)}).parse(req.body);
  await db.transaction(async tx=>{
   const row=await one(tx,"DELETE FROM auth_tokens WHERE hash=$1 AND purpose='verify' AND expires_at>now() RETURNING user_id",[digest(token)]);
   if(!row)throw new HttpError(400,'Verification link expired or already used');
   await tx.query('UPDATE users SET verified=true WHERE id=$1',[row.user_id]);
  });return {message:'Email verified. You can now connect FYERS.'};
 });
 app.post('/api/auth/reset',async req=>{
  await limit('reset:'+req.ip,10,3600);
  const {token,password}=z.object({token:z.string().min(20).max(100),password:z.string().min(12).max(128)}).parse(req.body);
  const hash=await passwordHash(password);
  await db.transaction(async tx=>{
   const row=await one(tx,"DELETE FROM auth_tokens WHERE hash=$1 AND purpose='reset' AND expires_at>now() RETURNING user_id",[digest(token)]);
   if(!row)throw new HttpError(400,'Reset link expired or already used');
   await tx.query('UPDATE users SET password_hash=$2,verified=true WHERE id=$1',[row.user_id,hash]);
   await tx.query('DELETE FROM sessions WHERE user_id=$1',[row.user_id]);
   await audit(tx,row.user_id,'Password reset; all sessions revoked');
  });return {message:'Password changed. Please sign in again.'};
 });
 app.get('/api/dashboard',async req=>{
  const u=await user(req);
  const [broker,setups,trades,events,health,halts]=await Promise.all([
   one(db,'SELECT account_mask,expires_at FROM broker_accounts WHERE user_id=$1',[u.user_id]),
   db.query('SELECT * FROM setups WHERE user_id=$1 ORDER BY created_at',[u.user_id]),
   db.query('SELECT * FROM trades WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200',[u.user_id]),
   db.query('SELECT id,action,detail,created_at FROM audit_events WHERE user_id=$1 ORDER BY id DESC LIMIT 100',[u.user_id]),
   one(db,"SELECT * FROM worker_health WHERE id='trading'"),
   db.query('SELECT mode,reason FROM daily_halts WHERE user_id=$1 AND day=$2',[u.user_id,day()])
  ]);
  return {user:{name:u.name,email:u.email,verified:u.verified},csrf:u.csrf,broker:broker?{...broker,connected:new Date(broker.expires_at).getTime()>Date.now()}:null,setups:setups.rows,trades:trades.rows,events:events.rows,halts:halts.rows,engine:{online:!!health&&Date.now()-new Date(health.heartbeat).getTime()<45000,lastSeen:health?.heartbeat},liveEnabled:c.LIVE_TRADING_ENABLED==='true',rules:RULES};
 });
 app.put('/api/setups',async req=>{
  const u=await user(req),data=setupSchema.parse(req.body);
  if(!u.verified)throw new HttpError(403,'Verify your email before configuring trading');
  return db.transaction(async tx=>{
   await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.user_id]);
   const existing=await one(tx,'SELECT * FROM setups WHERE user_id=$1 AND mode=$2 AND instrument=$3 AND market=$4',[u.user_id,data.mode,data.instrument,data.market]);
   if(existing&&(existing.status==='running'||await one(tx,"SELECT id FROM trades WHERE setup_id=$1 AND status NOT IN ('closed','rejected')",[existing.id])))throw new HttpError(409,'Pause and close the setup before changing risk limits');
   if(!existing&&(await one(tx,'SELECT COUNT(*)::int AS n FROM setups WHERE user_id=$1',[u.user_id])).n>=20)throw new HttpError(409,'Maximum 20 market setups per account');
   const row=await one(tx,"INSERT INTO setups(id,user_id,mode,instrument,market,config) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,mode,instrument,market) DO UPDATE SET config=excluded.config,status='paused' RETURNING id",[randomUUID(),u.user_id,data.mode,data.instrument,data.market,JSON.stringify(data.risk)]);
   await audit(tx,u.user_id,'Risk settings saved',{market:data.market,mode:data.mode});return row;
  });
 });
 app.post('/api/setups/:id/:action',async req=>{
  const u=await user(req),{id,action}=z.object({id:idSchema,action:z.enum(['start','pause'])}).parse(req.params);
  return db.transaction(async tx=>{
   await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.user_id]);
   const s=await one(tx,'SELECT * FROM setups WHERE id=$1 AND user_id=$2',[id,u.user_id]);if(!s)throw new HttpError(404,'Setup not found');
   if(action==='start'){
    if(!u.verified)throw new HttpError(403,'Verify your email first');
    if(s.mode==='live'&&c.LIVE_TRADING_ENABLED!=='true')throw new HttpError(409,'Live execution is locked pending broker acceptance testing');
    if(!await one(tx,'SELECT 1 FROM broker_accounts WHERE user_id=$1 AND expires_at>now()',[u.user_id]))throw new HttpError(409,'Connect or renew your FYERS account first');
    if(!await one(tx,"SELECT 1 FROM worker_health WHERE id='trading' AND heartbeat>now()-interval '45 seconds'"))throw new HttpError(409,'Trading worker is offline');
    if(await one(tx,'SELECT 1 FROM daily_halts WHERE user_id=$1 AND mode=$2 AND day=$3',[u.user_id,s.mode,day()]))throw new HttpError(409,'Daily loss limit reached. Entries are locked for today.');
    if(await one(tx,"SELECT 1 FROM trades WHERE user_id=$1 AND mode=$2 AND status IN ('unknown','submitting','exit_pending')",[u.user_id,s.mode]))throw new HttpError(409,'Resolve outstanding order uncertainty in FYERS first');
   }
   await tx.query('UPDATE setups SET status=$2 WHERE id=$1',[id,action==='start'?'running':'paused']);
   await audit(tx,u.user_id,action==='start'?'Monitoring started':'New entries paused',{market:s.market,mode:s.mode});
   return {message:action==='pause'?'New entries paused. Existing positions remain monitored.':'Monitoring enabled. Orders require all strategy conditions.'};
  });
 });
 app.post('/api/emergency-stop',async req=>{
  const u=await user(req);
  await db.transaction(async tx=>{
   await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.user_id]);
   await tx.query("UPDATE setups SET status='paused' WHERE user_id=$1",[u.user_id]);
   await tx.query("UPDATE trades SET exit_requested=true WHERE user_id=$1 AND status NOT IN ('closed','rejected')",[u.user_id]);
   await audit(tx,u.user_id,'Emergency stop requested');
  });return {message:'New entries stopped. Exits queued for the worker. Verify live positions in FYERS.'};
 });
 app.post('/api/trades/:id/close',async req=>{
  const u=await user(req),{id}=z.object({id:idSchema}).parse(req.params);
  const row=await one(db,"UPDATE trades SET exit_requested=true WHERE id=$1 AND user_id=$2 AND status NOT IN ('closed','rejected') RETURNING id",[id,u.user_id]);
  if(!row)throw new HttpError(404,'Active trade not found');
  await audit(db,u.user_id,'Exit requested',{trade:id});return {message:'Exit queued; wait for broker confirmation.'};
 });
 app.post('/api/broker/connect',async req=>{
  const u=await user(req);if(!u.verified)throw new HttpError(403,'Verify your email first');
  if(!c.FYERS_APP_ID||!c.FYERS_APP_SECRET)throw new HttpError(409,'The operator must configure the FYERS application first');
  const token=randomToken();
  await db.transaction(async tx=>{
   await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.user_id]);
   await tx.query("DELETE FROM auth_tokens WHERE user_id=$1 AND purpose='oauth'",[u.user_id]);
   await tx.query("INSERT INTO auth_tokens(hash,user_id,purpose,session_id,expires_at) VALUES($1,$2,'oauth',$3,now()+interval '10 minutes')",[digest(token),u.user_id,u.id]);
  });return {url:authUrl(c.FYERS_APP_ID,c.APP_ORIGIN,token)};
 });
 app.get('/api/broker/callback',async(req,reply)=>{
  const u=await user(req),q=z.object({state:z.string().min(20).max(100),auth_code:z.string().min(1).max(4096)}).parse(req.query);
  const token=await one(db,"DELETE FROM auth_tokens WHERE hash=$1 AND user_id=$2 AND session_id=$3 AND purpose='oauth' AND expires_at>now() RETURNING user_id",[digest(q.state),u.user_id,u.id]);
  if(!token)throw new HttpError(400,'Broker authorization expired or invalid. Connect again.');
  const b=new Fyers(c.FYERS_APP_ID,''),access=await b.exchange(c.FYERS_APP_SECRET,q.auth_code);
  const profile=await new Fyers(c.FYERS_APP_ID,access).profile();
  const expiry=new Date(day()+'T06:30:00+05:30');if(expiry.getTime()<=Date.now())expiry.setDate(expiry.getDate()+1);
  await db.transaction(async tx=>{
   await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.user_id]);
   const exposure=await one(tx,"SELECT 1 FROM trades WHERE user_id=$1 AND status NOT IN ('closed','rejected')",[u.user_id]);
   const existing=await one(tx,'SELECT account_hash FROM broker_accounts WHERE user_id=$1',[u.user_id]);
   if(exposure&&existing?.account_hash!==digest(profile.fy_id))throw new HttpError(409,'Active exposure belongs to a different broker account. Reauthorize the same account.');
   await tx.query("INSERT INTO broker_accounts(user_id,token_cipher,account_hash,account_mask,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET token_cipher=excluded.token_cipher,account_hash=excluded.account_hash,account_mask=excluded.account_mask,expires_at=excluded.expires_at",[u.user_id,vault.seal(u.user_id,access),digest(profile.fy_id),'••••'+profile.fy_id.slice(-4),expiry]);
   await audit(tx,u.user_id,'FYERS connected');
  });return reply.redirect('/?connected=1');
 });
 app.post('/api/broker/disconnect',async req=>{
  const u=await user(req);
  await db.transaction(async tx=>{
   await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.user_id]);
   if(await one(tx,"SELECT 1 FROM trades WHERE user_id=$1 AND status NOT IN ('closed','rejected')",[u.user_id]))throw new HttpError(409,'Close or reconcile active trades before disconnecting');
   await tx.query("UPDATE setups SET status='paused' WHERE user_id=$1",[u.user_id]);
   await tx.query('DELETE FROM broker_accounts WHERE user_id=$1',[u.user_id]);
   await tx.query("DELETE FROM auth_tokens WHERE user_id=$1 AND purpose='oauth'",[u.user_id]);
   await audit(tx,u.user_id,'FYERS disconnected');
  });return {ok:true};
 });
 app.get('/api/trades.csv',async(req,reply)=>{
  const u=await user(req),rows=(await db.query('SELECT symbol,mode,side,quantity,entry,stop,target,status,exit,pnl,created_at,closed_at FROM trades WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10000',[u.user_id])).rows;
  const columns=['symbol','mode','side','quantity','entry','stop','target','status','exit','pnl','created_at','closed_at'];
  const cell=(v:any)=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  reply.header('Content-Type','text/csv').header('Content-Disposition','attachment; filename="quantpilot-trades.csv"');
  return [columns.join(','),...rows.map(r=>columns.map(k=>cell(r[k])).join(','))].join('\r\n');
 });
 await serveUi(app);
 return app;
}




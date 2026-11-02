import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { one,type Database } from '../src/db.js';
import { testDatabase,cfg,signup,origin } from './helpers.js';
import { Vault,digest,passwordValid } from '../src/security.js';
let db:Database,app:Awaited<ReturnType<typeof buildApp>>;
beforeAll(async()=>{db=await testDatabase();app=await buildApp(db,{...cfg,FYERS_APP_ID:'test-app-100',FYERS_APP_SECRET:'server-secret'});});
afterAll(async()=>{await app.close();await db.close();});
beforeEach(async()=>{await db.query('TRUNCATE users,rate_limits CASCADE');});
const setup={mode:'paper',instrument:'option',market:'NIFTY',risk:{riskPerTrade:1000,dailyLoss:3000,capital:50000,maxTrades:3}};
describe('authenticated product API',()=>{
 it('registers with a hashed password and secure session semantics',async()=>{
  const s=await signup(app),u=await one(db,'SELECT * FROM users');
  expect(u.password_hash).not.toContain('secure-example-password');expect(await passwordValid('secure-example-password-123',u.password_hash)).toBe(true);
  expect(s.data.user.name).toBe('Test Trader');expect(s.data.rules.timeframe).toBe(5);expect(s.data.rules.stopPoints).toBe(10);
  const raw=(await db.query('SELECT id FROM sessions')).rows[0].id;expect(raw).not.toBe(s.cookie.split('=')[1]);
  const r=await app.inject({method:'POST',url:'/api/auth/login',headers:origin,payload:{email:'one@example.com',password:'secure-example-password-123'}});
  expect(r.headers['set-cookie']).toContain('HttpOnly');expect(r.headers['set-cookie']).toContain('SameSite=Lax');
 });
 it('rejects missing authentication, cross-origin mutations and missing CSRF',async()=>{
  expect((await app.inject({url:'/api/dashboard'})).statusCode).toBe(401);
  const s=await signup(app);
  expect((await app.inject({method:'PUT',url:'/api/setups',headers:{...s.headers,origin:'https://evil.example'},payload:setup})).statusCode).toBe(403);
  expect((await app.inject({method:'PUT',url:'/api/setups',headers:{...origin,cookie:s.cookie},payload:setup})).statusCode).toBe(403);
 });
 it('prevents cross-account access to setups, trades and audit history',async()=>{
  const a=await signup(app),b=await signup(app,'two@example.com');
  const saved=await app.inject({method:'PUT',url:'/api/setups',headers:a.headers,payload:setup});expect(saved.statusCode).toBe(200);
  const id=saved.json().id;
  expect((await app.inject({method:'POST',url:'/api/setups/'+id+'/pause',headers:b.headers,payload:{}})).statusCode).toBe(404);
  const dashboard=await app.inject({url:'/api/dashboard',headers:{cookie:b.cookie}});
  expect(dashboard.json().setups).toHaveLength(0);expect(dashboard.json().events.some((e:any)=>e.action==='Risk settings saved')).toBe(false);
 });
 it('saves one market setup and rejects strategy overrides',async()=>{
  const s=await signup(app);
  expect((await app.inject({method:'PUT',url:'/api/setups',headers:s.headers,payload:{...setup,timeframe:1}})).statusCode).toBe(400);
  await app.inject({method:'PUT',url:'/api/setups',headers:s.headers,payload:setup});
  await app.inject({method:'PUT',url:'/api/setups',headers:s.headers,payload:{...setup,risk:{...setup.risk,riskPerTrade:900}}});
  const rows=(await db.query('SELECT * FROM setups')).rows;expect(rows).toHaveLength(1);expect(rows[0].config.riskPerTrade).toBe(900);
 });
 it('requires broker, worker health and live gate before starting',async()=>{
  const s=await signup(app);const saved=await app.inject({method:'PUT',url:'/api/setups',headers:s.headers,payload:setup});
  const start=await app.inject({method:'POST',url:'/api/setups/'+saved.json().id+'/start',headers:s.headers,payload:{}});
  expect(start.statusCode).toBe(409);expect(start.json().error).toContain('FYERS');
  const live=await app.inject({method:'PUT',url:'/api/setups',headers:s.headers,payload:{...setup,mode:'live'}});
  const locked=await app.inject({method:'POST',url:'/api/setups/'+live.json().id+'/start',headers:s.headers,payload:{}});
  expect(locked.statusCode).toBe(409);expect(locked.json().error).toContain('locked');
 });
 it('persists a sticky daily halt and rejects attempts to clear it through settings',async()=>{
  const s=await signup(app),u=await one(db,'SELECT id FROM users');
  const saved=await app.inject({method:'PUT',url:'/api/setups',headers:s.headers,payload:setup});
  await db.query("INSERT INTO broker_accounts VALUES($1,'cipher','hash','mask',now()+interval '1 hour')",[u.id]);
  await db.query("INSERT INTO worker_health VALUES('trading',now(),'{}') ON CONFLICT(id) DO UPDATE SET heartbeat=now()");
  await db.query("INSERT INTO daily_halts VALUES($1,'paper',(now() AT TIME ZONE 'Asia/Kolkata')::date,'loss')",[u.id]);
  await app.inject({method:'PUT',url:'/api/setups',headers:s.headers,payload:{...setup,risk:{...setup.risk,dailyLoss:99999}}});
  const r=await app.inject({method:'POST',url:'/api/setups/'+saved.json().id+'/start',headers:s.headers,payload:{}});expect(r.statusCode).toBe(409);expect(r.json().error).toContain('Daily loss');
 });
 it('emergency stop is owner scoped and pauses every owned setup',async()=>{
  const a=await signup(app),b=await signup(app,'two@example.com');
  await app.inject({method:'PUT',url:'/api/setups',headers:a.headers,payload:setup});await app.inject({method:'PUT',url:'/api/setups',headers:b.headers,payload:setup});
  await db.query("UPDATE setups SET status='running'");
  await app.inject({method:'POST',url:'/api/emergency-stop',headers:a.headers,payload:{}});
  const rows=(await db.query('SELECT status FROM setups ORDER BY created_at')).rows;expect(rows.map(r=>r.status)).toEqual(['paused','running']);
 });
 it('binds OAuth state to the initiating session and consumes it once',async()=>{
  const a=await signup(app),b=await signup(app,'two@example.com');
  const start=await app.inject({method:'POST',url:'/api/broker/connect',headers:a.headers,payload:{}});
  const state=new URL(start.json().url).searchParams.get('state')!;
  expect((await app.inject({url:'/api/broker/callback?state='+state+'&auth_code=abc',headers:{cookie:b.cookie}})).statusCode).toBe(400);
  const mock=vi.spyOn(globalThis,'fetch').mockImplementation(async(input:any)=>new Response(JSON.stringify(String(input).includes('validate-authcode')?{s:'ok',access_token:'test-access-token-123456'}:{s:'ok',data:{fy_id:'TEST12345'}}),{status:200}));
  try{
   const ok=await app.inject({url:'/api/broker/callback?state='+state+'&auth_code=abc',headers:{cookie:a.cookie}});expect(ok.statusCode).toBe(302);
   const account=await one(db,'SELECT * FROM broker_accounts');expect(account.token_cipher).not.toContain('test-access-token');
   expect(new Vault(cfg.ENCRYPTION_KEY).open(account.user_id,account.token_cipher)).toBe('test-access-token-123456');
   const dashboard=await app.inject({url:'/api/dashboard',headers:{cookie:a.cookie}});expect(dashboard.body).not.toContain('token_cipher');expect(dashboard.body).not.toContain('test-access-token');
   expect((await app.inject({url:'/api/broker/callback?state='+state+'&auth_code=abc',headers:{cookie:a.cookie}})).statusCode).toBe(400);
  }finally{mock.mockRestore();}
 });
 it('revokes sessions on logout',async()=>{const s=await signup(app);await app.inject({method:'POST',url:'/api/auth/logout',headers:s.headers,payload:{}});expect((await app.inject({url:'/api/dashboard',headers:{cookie:s.cookie}})).statusCode).toBe(401);});
 it('serves a restrictive CSP and only explicitly listed public assets',async()=>{const r=await app.inject({url:'/'});expect(r.statusCode).toBe(200);expect(r.headers['content-security-policy']).toContain("script-src 'self'");expect((await app.inject({url:'/../.env'})).statusCode).toBe(404);expect((await app.inject({url:'/src/app.ts'})).statusCode).toBe(404);});
 it('rate limits failed logins persistently',async()=>{for(let i=0;i<15;i++)await app.inject({method:'POST',url:'/api/auth/login',headers:origin,payload:{email:'missing@example.com',password:'wrong-password-12345'}});expect((await app.inject({method:'POST',url:'/api/auth/login',headers:origin,payload:{email:'missing@example.com',password:'wrong-password-12345'}})).statusCode).toBe(429);});
});
describe('verification and recovery',()=>{
 it('consumes email tokens once and invalidates every session after reset',async()=>{
  const sent:{purpose:string;token:string}[]=[];
  const emailApp=await buildApp(db,{...cfg,SMTP_HOST:'test-mail'},async(_email,purpose,token)=>{sent.push({purpose,token});});
  try{
   const s=await signup(emailApp);expect(s.data.user.verified).toBe(false);
   expect((await emailApp.inject({method:'PUT',url:'/api/setups',headers:s.headers,payload:setup})).statusCode).toBe(403);
   const verify=sent.find(x=>x.purpose==='verify')!.token;
   expect((await emailApp.inject({method:'POST',url:'/api/auth/verify',headers:origin,payload:{token:verify}})).statusCode).toBe(200);
   expect((await emailApp.inject({method:'POST',url:'/api/auth/verify',headers:origin,payload:{token:verify}})).statusCode).toBe(400);
   await emailApp.inject({method:'POST',url:'/api/auth/request-reset',headers:origin,payload:{email:'one@example.com'}});
   const token=sent.find(x=>x.purpose==='reset')!.token;
   expect((await one(db,"SELECT hash FROM auth_tokens WHERE purpose='reset'")).hash).toBe(digest(token));
   expect((await emailApp.inject({method:'POST',url:'/api/auth/reset',headers:origin,payload:{token,password:'new-long-password-1234'}})).statusCode).toBe(200);
   expect((await emailApp.inject({url:'/api/dashboard',headers:{cookie:s.cookie}})).statusCode).toBe(401);
   expect((await emailApp.inject({method:'POST',url:'/api/auth/reset',headers:origin,payload:{token,password:'new-long-password-1234'}})).statusCode).toBe(400);
  }finally{await emailApp.close();}
 });
 it('rejects broker token decryption under a different user',()=>{const vault=new Vault(cfg.ENCRYPTION_KEY);expect(()=>vault.open('user-b',vault.seal('user-a','secret'))).toThrow();});
});


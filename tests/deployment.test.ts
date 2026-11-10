import { describe,it,expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { config } from '../src/config.js';
import { migrate,one } from '../src/db.js';
import { testDatabase,cfg } from './helpers.js';
describe('Render deployment contract',()=>{
 it('defines paid web and worker services with one private PostgreSQL database',async()=>{
  const yaml=parse(await readFile('render-paid.yaml','utf8'));
  expect(yaml.services.map((s:any)=>s.type)).toEqual(['web','worker']);
  for(const s of yaml.services){expect(s.runtime).toBe('node');expect(s.plan).not.toBe('free');expect(s.numInstances).toBe(1);expect(s.preDeployCommand).toBe('npm run migrate');expect(s.autoDeployTrigger).toBe('off');}
  expect(yaml.databases[0].ipAllowList).toEqual([]);
  const web=yaml.services[0],worker=yaml.services[1];
  expect(web.envVars.find((v:any)=>v.key==='ENCRYPTION_KEY').generateValue).toBe(true);
  expect(worker.envVars.find((v:any)=>v.key==='ENCRYPTION_KEY').fromService.envVarKey).toBe('ENCRYPTION_KEY');
  expect(web.envVars.find((v:any)=>v.key==='LIVE_TRADING_ENABLED').value).toBe('false');
 });
 it('fails closed for insecure production and incomplete live configuration',()=>{
  expect(()=>config({...cfg,NODE_ENV:'production',REGISTRATION_CODE:'private'})).toThrow('HTTPS');
  expect(()=>config({...cfg,LIVE_TRADING_ENABLED:'true'})).toThrow('Live trading');
 });
 it('applies repeatable migrations without losing persisted rows',async()=>{
  const db=await testDatabase();
  try{
   await migrate(db);await migrate(db);
   expect((await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version)).toEqual([1,2]);
   const fields=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='trades'")).rows.map(r=>r.column_name);
   expect(fields).toContain('multiplier');expect(fields).toContain('position_seen');expect(fields).toContain('flat_since');
  }finally{await db.close();}
 });
});


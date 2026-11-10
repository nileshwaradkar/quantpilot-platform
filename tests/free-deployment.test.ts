import { describe,it,expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parse } from 'yaml';
import { config } from '../src/config.js';
import { supervise } from '../src/supervisor.js';
import { cfg } from './helpers.js';
describe('free paper deployment',()=>{
 it('provisions only a free web service and uses external durable storage',async()=>{
  const y=parse(await readFile('render-free.yaml','utf8'));
  expect(y.databases).toBeUndefined();expect(y.services).toHaveLength(1);
  const s=y.services[0];expect(s.type).toBe('web');expect(s.plan).toBe('free');
  expect(s.preDeployCommand).toBeUndefined();expect(s.disk).toBeUndefined();
  expect(s.startCommand).toBe('npm run start:cloud');
  expect(s.envVars.find((v:any)=>v.key==='DATABASE_URL').sync).toBe(false);
 });
 it('rejects live trading even with otherwise valid approval and credentials',()=>{
  expect(()=>config({...cfg,DEPLOYMENT_PROFILE:'free-paper',LIVE_TRADING_ENABLED:'true',BROKER_APP_APPROVED:'true',DEDICATED_EGRESS_CONFIRMED:'true',FYERS_APP_ID:'test',FYERS_APP_SECRET:'test'})).toThrow('paper trading only');
 });
 it('stops the surviving process when its companion exits',async()=>{
  const children=[spawn(process.execPath,['-e','process.exit(2)'],{stdio:'ignore'}),spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})];
  try{
   expect(await supervise(children)).toBe(1);
   expect(children.every(c=>c.exitCode!==null||c.signalCode!==null)).toBe(true);
  }finally{children.forEach(c=>{if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL');});}
 },15000);
});

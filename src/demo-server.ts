// Local UI/account preview only: never starts a trading engine or enables orders.
import { PGlite } from '@electric-sql/pglite';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { migrate,type Database,type Sql } from './db.js';
import { buildApp } from './app.js';
await mkdir('data',{recursive:true});
let key:string;try{key=await readFile('data/local.key','utf8');}catch{key=randomBytes(32).toString('hex');await writeFile('data/local.key',key,{mode:0o600});}
const pg=new PGlite('data/local-preview');
const wrap=(client:any):Sql=>({query:async(sql,params)=>{if(sql.includes(';')&&!params?.length){const results=await client.exec(sql);return results.at(-1)||{rows:[]};}return client.query(sql,params);}});
const db:Database={...wrap(pg),transaction:fn=>pg.transaction(tx=>fn(wrap(tx))),close:()=>pg.close()};
await migrate(db);
const c=config({NODE_ENV:'development',PORT:'3000',APP_ORIGIN:'http://127.0.0.1:3000',DATABASE_URL:'local-preview',ENCRYPTION_KEY:key});
const app=await buildApp(db,c);
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{void app.close().then(()=>db.close()).then(()=>process.exit(0));});
await app.listen({host:'127.0.0.1',port:3000});
console.log('Local product preview: http://127.0.0.1:3000 — trading worker disabled');


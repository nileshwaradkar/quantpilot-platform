import { fork } from 'node:child_process';
import { config } from './config.js';
import { database,migrate } from './db.js';
import { supervise } from './supervisor.js';
// Explicitly reject live configuration even if the operator changes a dashboard flag.
process.env.DEPLOYMENT_PROFILE='free-paper';
const c=config();
const db=database(c.DATABASE_URL);
try{
 await migrate(db);
 const live=await db.query("SELECT 1 FROM trades WHERE mode='live' AND status NOT IN ('closed','rejected') LIMIT 1");
 if(live.rows.length)throw new Error('Use a dedicated paper database; unresolved live trades cannot run on a free host');
}finally{await db.close();}
const children=['server.js','worker.js'].map(file=>fork(new URL(file,import.meta.url),[],{env:process.env,stdio:'inherit'}));
process.exitCode=await supervise(children);

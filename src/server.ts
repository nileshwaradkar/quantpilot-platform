import { config } from './config.js';
import { database } from './db.js';
import { buildApp } from './app.js';
const c=config(),db=database(c.DATABASE_URL),app=await buildApp(db,c);
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{void app.close().then(()=>db.close()).then(()=>process.exit(0));});
await app.listen({port:c.PORT,host:'0.0.0.0'});


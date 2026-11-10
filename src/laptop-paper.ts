import { config } from './config.js';
import { database,migrate } from './db.js';
process.env.DEPLOYMENT_PROFILE='free-paper';
const c=config(),db=database(c.DATABASE_URL);
try {
 await migrate(db);
 const live=await db.query("SELECT 1 FROM trades WHERE mode='live' AND status NOT IN ('closed','rejected') LIMIT 1");
 if(live.rows.length)throw new Error('Dedicated paper database required: unresolved live trades exist');
} finally {await db.close();}
await import('./worker.js');

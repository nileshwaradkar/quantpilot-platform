import { config } from './config.js';
import { database, migrate } from './db.js';
const db = database(config().DATABASE_URL);
try { await migrate(db); console.log('Database schema ready'); } finally { await db.close(); }

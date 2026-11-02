import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
export interface Sql { query<T = any>(sql: string, params?: any[]): Promise<{rows: T[]; rowCount?: number | null}> }
export interface Database extends Sql { transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>; close(): Promise<void> }
export function database(url: string): Database & {pool: pg.Pool} {
  // Render's internal connection URL uses its private network. For external TLS,
  // supply sslmode=verify-full and the provider's trusted certificate configuration.
  const pool = new pg.Pool({connectionString: url, max: 8, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000});
  pool.on('error', () => console.error('Database connection lost'));
  return { pool, query: ((s:string,p?:any[]) => pool.query(s,p)) as Sql['query'], close: () => pool.end(),
    async transaction(fn) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
      catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }
  };
}
export async function migrate(db: Database) {
  const folder=new URL('../migrations/',import.meta.url);
  const files=(await readdir(folder)).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
  await db.transaction(async tx=>{
    if('pool' in db)await tx.query('SELECT pg_advisory_xact_lock(7121901)');
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied=new Set((await tx.query<{version:number}>('SELECT version FROM schema_migrations')).rows.map(r=>r.version));
    for(const file of files){
      const version=Number(file.split('_')[0]);if(applied.has(version))continue;
      await tx.query(await readFile(new URL(file,folder),'utf8'));
      await tx.query('INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING',[version]);
    }
  });
}
export async function one<T = any>(db: Sql, sql: string, params: any[] = []): Promise<T | undefined> { return (await db.query<T>(sql,params)).rows[0]; }
export async function audit(db: Sql, user: string, action: string, detail: Record<string, unknown> = {}) {
  await db.query('INSERT INTO audit_events(user_id,action,detail) VALUES($1,$2,$3)', [user,action,JSON.stringify(detail)]);
}


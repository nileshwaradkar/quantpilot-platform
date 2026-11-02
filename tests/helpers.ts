import { PGlite } from '@electric-sql/pglite';
import { database, migrate, type Database, type Sql } from '../src/db.js';
import { config } from '../src/config.js';
export const cfg=config({NODE_ENV:'test',DATABASE_URL:'postgres://test',APP_ORIGIN:'http://localhost:3000',ENCRYPTION_KEY:'test-key-with-more-than-thirty-two-characters'});
export async function testDatabase():Promise<Database>{
 if(process.env.TEST_DATABASE_URL){const db=database(process.env.TEST_DATABASE_URL);await migrate(db);return db;}
 const pg=new PGlite();
 const wrapper=(client:any):Sql=>({query:async(sql,params)=>{if(sql.includes(';')&&!params?.length){const results=await client.exec(sql);return results.at(-1)||{rows:[]};}return client.query(sql,params);}});
 const db:Database={...wrapper(pg),transaction:fn=>pg.transaction(tx=>fn(wrapper(tx))),close:()=>pg.close()};
 await migrate(db);return db;
}
export const origin={origin:'http://localhost:3000'};
export async function signup(app:any,email='one@example.com'){
 const r=await app.inject({method:'POST',url:'/api/auth/register',headers:origin,payload:{email,name:'Test Trader',password:'secure-example-password-123'}});
 if(r.statusCode!==200)throw new Error(r.body);
 const cookie=r.headers['set-cookie'].split(';')[0],csrf=r.json().csrf;
 const dashboard=await app.inject({url:'/api/dashboard',headers:{cookie}});
 return {cookie,csrf,headers:{...origin,cookie,'x-csrf-token':csrf},data:dashboard.json()};
}


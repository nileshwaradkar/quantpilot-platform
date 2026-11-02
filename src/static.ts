import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
export async function serveUi(app:FastifyInstance){
 const assets:Record<string,[string,string]>={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/platform.css':['platform.css','text/css; charset=utf-8']};
 for(const [url,[file,type]] of Object.entries(assets)){
  const content=await readFile(new URL('../public/'+file,import.meta.url));
  app.get(url,async(_req,reply)=>reply.type(type).header('Cache-Control','no-cache').send(content));
 }
}


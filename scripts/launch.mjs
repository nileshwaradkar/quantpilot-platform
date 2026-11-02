import { spawn } from 'node:child_process';
import { mkdir,open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const cwd=fileURLToPath(new URL('..',import.meta.url));
async function ready(){try{return (await fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}}
if(!await ready()){
 await mkdir(new URL('../data',import.meta.url),{recursive:true});
 const log=await open(new URL('../data/local-server.log',import.meta.url),'a');
 const child=spawn(process.execPath,['--import','tsx','src/demo-server.ts'],{cwd,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
 child.unref();await log.close();
 for(let i=0;i<40&&!await ready();i++)await new Promise(r=>setTimeout(r,500));
}
if(!await ready()){console.error('Preview could not start. Check data/local-server.log.');process.exit(1);}
console.log('QuantPilot preview is running at http://127.0.0.1:3000');
if(!process.argv.includes('--no-browser')&&process.platform==='win32'){
 spawn('cmd.exe',['/c','start','','http://127.0.0.1:3000'],{windowsHide:true,stdio:'ignore',detached:true}).unref();
}


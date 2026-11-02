import { type ChildProcess } from 'node:child_process';
// Stop both processes if either fails; never leave a scanner running behind a dead UI.
export function supervise(children:ChildProcess[]):Promise<number>{
 return new Promise(resolve=>{
  let stopping=false,code=0,timer:NodeJS.Timeout|undefined;
  const pending=new Set(children);
  const done=()=>{if(pending.size)return;clearTimeout(timer);process.off('SIGTERM',signal);process.off('SIGINT',signal);resolve(code);};
  const stop=(exitCode:number)=>{
   if(stopping)return;stopping=true;code=exitCode;
   for(const child of pending)child.kill('SIGTERM');
   timer=setTimeout(()=>{for(const child of pending)child.kill('SIGKILL');},8000);timer.unref();done();
  };
  const signal=()=>stop(0);
  process.on('SIGTERM',signal);process.on('SIGINT',signal);
  for(const child of children){
   child.once('error',()=>stop(1));
   child.once('close',()=>{pending.delete(child);if(!stopping)stop(1);done();});
  }
 });
}

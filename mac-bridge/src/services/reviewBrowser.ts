import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/** Drive an isolated Chromium profile over inherited pipes, with no listening debugger port. */
export async function renderViewport(executable: string, profile: string, url: string, width: number, height: number) {
  const child = spawn(executable, ['--headless', '--disable-extensions', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+profile], {
    windowsHide: true, stdio: ['ignore','ignore','ignore','pipe','pipe']
  });
  const input = child.stdio[3] as Writable, output = child.stdio[4] as Readable;
  let serial = 0, buffer = '', closed = false;
  type Reply = {targetId?:string;sessionId?:string;data?:string;errorText?:string;result?:{value?:unknown}};
  const pending = new Map<number,{resolve:(result:Reply)=>void;reject:(reason:Error)=>void}>();
  const fail = (err:Error) => { closed=true; for(const task of pending.values())task.reject(err); pending.clear(); };
  child.once('error',fail);
  input.on('error',fail);
  const ended=new Promise<void>(resolve=>child.once('close',()=>{fail(Error('Capture browser closed'));resolve();}));
  const deadline=setTimeout(()=>{fail(Error('Localhost capture timed out'));child.kill('SIGKILL');},20000);
  output.setEncoding('utf8');
  output.on('data',(chunk:string)=>{
    buffer+=chunk;
    let end:number;
    while((end=buffer.indexOf('\0'))>=0) {
      const msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      const task=pending.get(msg.id);if(!task)continue;
      pending.delete(msg.id);
      if(msg.error)task.reject(Error(msg.error.message));else task.resolve(msg.result);
    }
  });
  function call(method:string,params:Record<string,unknown>={},sessionId?:string):Promise<Reply> {
    if(closed)return Promise.reject(Error('Capture browser closed'));
    return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});input.write(JSON.stringify({id,method,params,sessionId})+'\0');});
  }
  try {
    const {targetId}=await call('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    const page=(method:string,params?:Record<string,unknown>)=>call(method,params,sessionId);
    await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const nav=await page('Page.navigate',{url}); if(nav.errorText)throw Error(nav.errorText);
    await page('Runtime.evaluate',{expression:`(async()=>{if(document.readyState!=='complete')await new Promise(r=>window.addEventListener('load',r,{once:true}));await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`,awaitPromise:true});
    const {data}=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    if(!data||data.length>16*1024*1024)throw Error('Capture unavailable or exceeds 12 MB');
    return Buffer.from(data,'base64');
  }finally{clearTimeout(deadline);child.kill('SIGKILL');await ended;}
}

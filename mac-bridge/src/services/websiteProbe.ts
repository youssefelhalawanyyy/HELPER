import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

type Stage = 'DNS'|'Connection'|'TLS'|'HTTP';
interface Probe {up:boolean; status:number; failureStage?:Stage; error?:string; redirect?:string}
export async function probeWebsite(raw:string):Promise<Probe>{
  let url=new URL(raw);
  const end=Date.now()+8000;
  for(let redirects=0;redirects<=8;redirects++){
    if(!['http:','https:'].includes(url.protocol))return {up:false,status:0,failureStage:'HTTP',error:'Unsupported redirect'};
    const result=await new Promise<Probe>(resolve=>{
      let stage:Stage=net.isIP(url.hostname.replace(/^\[|\]$/g,''))?'Connection':'DNS';
      const secure=url.protocol==='https:';
      const request=(secure?https:http).request(url,{agent:false,headers:{'user-agent':'DevDeck-Monitor/1.0'}},res=>{
        const status=res.statusCode||0;
        const redirect=[301,302,303,307,308].includes(status)?res.headers.location:undefined;
        finish(status>=200&&status<400?{up:true,status,redirect}:{up:false,status,failureStage:'HTTP',error:'HTTP '+status});
        res.destroy();
      });
      const timer=setTimeout(()=>request.destroy(Error('Timed out during '+stage)),Math.max(1,end-Date.now()));
      function finish(result:Probe){clearTimeout(timer);resolve(result);}
      request.on('socket',socket=>{
        socket.once('lookup',err=>{if(!err)stage='Connection';});
        socket.once('connect',()=>{stage=secure?'TLS':'HTTP';});
        socket.once('secureConnect',()=>{stage='HTTP';});
      });
      request.once('error',err=>finish({up:false,status:0,failureStage:stage,error:err.message}));
      request.end();
    });
    if(!result.redirect)return result;
    try {url=new URL(result.redirect,url);} catch {return {up:false,status:result.status,failureStage:'HTTP',error:'Invalid redirect'};}
  }
  return {up:false,status:0,failureStage:'HTTP',error:'Too many redirects'};
}

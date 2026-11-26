export interface ChainRun {macroId:string;steps:string[];done:number;status:'running'|'failed'|'complete';error?:string}
const runs=new Map<string,ChainRun & {context:string}>();
export function chainStatus(id:string) {return runs.get(id);}
export async function runChain(id:string, steps:string[],context:string,perform:(step:string)=>Promise<void>) {
  const old=runs.get(id);
  if(old?.status==='running') throw Error('This chain is already running');
  const done=old?.status==='failed' && old.context===context && JSON.stringify(old.steps)===JSON.stringify(steps)?old.done:0;
  const run:ChainRun & {context:string}={macroId:id,steps,done,context,status:'running'};
  runs.set(id,run);
  try {while(run.done<steps.length){await perform(steps[run.done]);run.done++;}run.status='complete';}
  catch(e){run.status='failed';run.error=(e as Error).message;throw Error(steps[run.done]+' · '+run.error);}
}
export async function previewReady(url:string) {
  try {const res=await fetch(url,{signal:AbortSignal.timeout(1500),redirect:'manual'});await res.body?.cancel();return res.status>=200 && res.status<400;} catch { return false; }
}
export async function waitForPreview(url:string) {
  for(let attempt=0;attempt<12;attempt++){
    if(await previewReady(url))return;
    if(attempt<11)await new Promise(resolve=>setTimeout(resolve,750));
  }
  throw Error('Localhost has not returned a successful HTTP response');
}

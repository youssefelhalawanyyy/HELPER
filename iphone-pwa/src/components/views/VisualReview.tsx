'use client';
import {useEffect,useRef,useState} from 'react';
import {bridgeRequest} from '@/lib/bridgeRequest';
import {makeRequestId} from '@/lib/formatters';
import type {DevDeckState} from '@/hooks/useDevDeckSocket';
import {ConsoleDialog} from '../shell/ConsoleDialog';
import type {SpeechRecLike} from './AntigravityMissionView';
type Capture={image:string;file:string;width:number;height:number;url:string};
type Panel='Files'|'Diff'|'Preview';
export function VisualReview({deck,selected,select,review,reviewBusy}:{deck:DevDeckState;selected:string|null;select:(file:string)=>void;review:(action:'accept'|'revert')=>void;reviewBusy:boolean}){
  const [open,setOpen]=useState(false),[panel,setPanel]=useState<Panel>('Preview'),[size,setSize]=useState('390x844');
  const [before,setBefore]=useState<Capture>(),[after,setAfter]=useState<Capture>(),[split,setSplit]=useState(50);
  const [point,setPoint]=useState<{x:number;y:number}>(),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
  const [lang,setLang]=useState('ar-EG'),[listening,setListening]=useState(false);
  const rec=useRef<SpeechRecLike|null>(null),ctrl=useRef<AbortController|null>(null);
  const files=deck.antigravityState.diffFiles, diff=deck.antigravityDiff?.file===selected?deck.antigravityDiff:null;
  const tests=deck.antigravityState.terminalRuns?.filter(t=>/\b(test|vitest|jest|playwright|pytest|typecheck|tsc)\b/i.test(t.command))||[];
  useEffect(()=>()=>{ctrl.current?.abort();if(rec.current){rec.current.onresult=null;rec.current.stop();}},[]);
  function close(){if(rec.current){rec.current.onresult=null;rec.current.stop();}setOpen(false);}
  async function capture(which:'before'|'after'){
    const [width,height]=size.split('x').map(Number);
    const signal=new AbortController(); ctrl.current=signal;setBusy(true);setStatus('Capturing localhost…');
    try{const image=await bridgeRequest<Capture>(deck,'review/capture',{url:which==='before'?deck.previewUrl:before?.url,width,height},signal.signal);
      if(which==='before'){setBefore(image);setAfter(undefined);setPoint(undefined);setNote('');}else if(image.width===before?.width&&image.height===before.height){setAfter(image);setSplit(50);setPoint(undefined);}else throw Error('Viewport changed. Capture a new pair.');
      setStatus('');
    }catch(e){if(!signal.signal.aborted)setStatus((e as Error).message);}finally{if(!signal.signal.aborted)setBusy(false);}
  }
  function dictate(){
    if(listening){rec.current?.stop();return;}
    const w=window as unknown as {webkitSpeechRecognition?:new()=>SpeechRecLike;SpeechRecognition?:new()=>SpeechRecLike};
    const Voice=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!Voice){setStatus('Use the keyboard microphone or type your description.');return;}
    const r=new Voice();rec.current=r;r.lang=lang;r.continuous=false;r.interimResults=false;
    r.onresult=e=>setNote(old=>[old,...Array.from(e.results).map(v=>v[0].transcript)].filter(Boolean).join(' '));
    r.onerror=()=>{setStatus('Microphone unavailable. You can still type.');setListening(false);};r.onend=()=>setListening(false);
    try{r.start();setListening(true);}catch{setStatus('Microphone unavailable');}
  }
  async function send(){if(!point||!before||!note.trim())return;setBusy(true);try{
    const image=after&&point.x*100>split?after:before;
    const response=await deck.requestAction({type:'antigravity:prompt',payload:{requestId:makeRequestId(),submit:true,text:[
      'Review the marked UI at '+image.url,'Screenshot on this computer: '+image.file,
      'Viewport '+image.width+' × '+image.height+' CSS px, point ('+Math.round(point.x*image.width)+', '+Math.round(point.y*image.height)+') from top left.',note.trim()
    ].join('\n')}});
    setStatus(response.ok?'Sent to Antigravity. Capture after to verify this view.':response.message);
  }finally{setBusy(false);}}
  return <><button type="button" className="work-trigger" onClick={()=>setOpen(true)}>Visual review</button>{open&&<ConsoleDialog title="Visual review" wide onClose={close}>
    <nav className="review-tabs">{(['Files','Diff','Preview'] as const).map(p=><button aria-pressed={panel===p} key={p} onClick={()=>setPanel(p)}>{p}</button>)}</nav>
    <div className="review-grid">
      <section data-active={panel==='Files'}><h3>Changed files</h3>{files.length?files.map(f=><button className="review-file" aria-pressed={selected===f.file} key={f.file} onClick={()=>{select(f.file);setPanel('Diff');}}>{f.file} <small>+{f.added} −{f.removed}</small></button>):<small>Working tree has no reported changes.</small>}</section>
      <section data-active={panel==='Diff'}><h3>{selected||'File diff'}</h3><pre>{diff?.patch||(selected?'Waiting for the file diff…':'Select a changed file.')}</pre>
      {diff?.revision&&<div className="work-actions"><button disabled={reviewBusy} onClick={()=>review('accept')}>Accept file</button><button disabled={reviewBusy} onClick={()=>review('revert')}>Revert file</button></div>}</section>
      <section data-active={panel==='Preview'}><h3>Localhost preview</h3><div className="work-actions"><select aria-label="Capture size" value={size} disabled={busy||!!before} onChange={e=>setSize(e.target.value)}><option value="390x844">Phone · 390 × 844</option><option value="844x390">Landscape · 844 × 390</option><option value="1280x800">Desktop · 1280 × 800</option></select>
      <button disabled={busy} onClick={()=>void capture('before')}>Capture before</button>{before&&<><button disabled={busy} onClick={()=>void capture('after')}>Capture after</button><button disabled={busy} onClick={()=>{setBefore(undefined);setAfter(undefined);setPoint(undefined);}}>Reset pair</button></>}</div>
      {before&&<><div className="review-frame"><button type="button" aria-label="Mark location on screenshot" className="review-image" onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setPoint(e.detail?{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}:{x:.5,y:.5});}}>
      <img alt="Before the edit" src={before.image}/>{after&&<img alt="After the edit" src={after.image} style={{clipPath:'inset(0 0 0 '+split+'%)'}}/>}{after&&<i style={{left:split+'%'}}/>}{point&&<b style={{left:point.x*100+'%',top:point.y*100+'%'}}>⊕</b>}</button>
      {after&&<input className="review-divider" aria-label="Before and after divider" type="range" min={0} max={100} value={split} onChange={e=>setSplit(Number(e.target.value))}/>}</div>
      <small>{before.width} × {before.height} · Tap the screenshot to mark a bug.</small>
      {point&&<div className="work-card"><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Describe the marked issue"/><div className="work-actions"><select aria-label="Voice language" value={lang} onChange={e=>setLang(e.target.value)}><option value="ar-EG">مصري</option><option value="en-US">English</option></select><button onClick={dictate}>{listening?'Finish dictation':'Dictate'}</button><button disabled={!note.trim()||busy} onClick={()=>void send()}>Send to Antigravity</button></div></div>}</>}
      <output aria-live="polite">{status}</output><h3>Test results</h3>{tests.length?tests.slice(-6).map(t=><details key={t.id}><summary>{t.command} · {t.status}{t.exitCode!=null?' ('+t.exitCode+')':''}</summary><pre>{t.output||t.summary}</pre></details>):<small>No test runs reported by the IDE.</small>}</section>
    </div></ConsoleDialog>}</>;
}

'use client';
import {useEffect,useState} from 'react';
import {bridgeRequest} from '@/lib/bridgeRequest';
import type {DevDeckState} from '@/hooks/useDevDeckSocket';
import {ConsoleDialog} from '../shell/ConsoleDialog';

type Run={steps:string[];done:number;status:string;error?:string};
export function ChainProgress({deck,id,retry,onClose}:{deck:DevDeckState;id:string;retry:()=>void;onClose:()=>void}){
  const [run,setRun]=useState<Run|null>(null);
  const [error,setError]=useState('');
  const {bridgeBaseUrl,pairing}=deck;
  useEffect(()=>{
    const ctrl=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{const result=await bridgeRequest<{run:Run|null}>({bridgeBaseUrl,pairing},'chain/'+encodeURIComponent(id),undefined,ctrl.signal);
        if(!ctrl.signal.aborted){setRun(result.run);setError('');}
      } catch(e){if(!ctrl.signal.aborted)setError((e as Error).message);}
      if(!ctrl.signal.aborted)timer=setTimeout(poll,750);
    }
    void poll();return ()=>{ctrl.abort();clearTimeout(timer);};
  },[bridgeBaseUrl,pairing,id]);
  return <ConsoleDialog title="Macro progress" onClose={onClose}><ol className="work-steps">{run?.steps.map((step,i)=><li key={i}><b>{step}</b><span>{i<run.done?'Confirmed':i>run.done?'Waiting':run.status==='failed'?'Failed':'Running'}</span></li>)}</ol>
    <output>{error||run?.error||run?.status||'Waiting for the computer…'}</output>{run?.status==='failed'&&<button onClick={retry}>Retry failed step</button>}</ConsoleDialog>;
}
interface Bookmark {id:string;task:string;dir:string;branch:string;editor:string;pages:string[]}
export function WorkspaceBookmarks({deck}:{deck:DevDeckState}){
  const [open,setOpen]=useState(false), [items,setItems]=useState<Bookmark[]>([]), [task,setTask]=useState(''), [pages,setPages]=useState(''), [editor,setEditor]=useState('Antigravity'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const {bridgeBaseUrl,pairing}=deck;
  useEffect(()=>{if(!open)return;const ctrl=new AbortController();bridgeRequest<Bookmark[]>({bridgeBaseUrl,pairing},'bookmarks',undefined,ctrl.signal).then(setItems).catch(e=>{if(!ctrl.signal.aborted)setMessage(e.message);});return ()=>ctrl.abort();},[open,bridgeBaseUrl,pairing]);
  async function change(id?:string){setBusy(true);setMessage('');try{if(id){await bridgeRequest(deck,'bookmarks/restore',{id});setMessage('Workspace reopened');}else {setItems(await bridgeRequest(deck,'bookmarks',{editor,task,pages:pages.split(/\s+/).filter(Boolean)}));setTask('');setMessage('Place saved');}}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <><button type="button" className="work-trigger" onClick={()=>setOpen(true)}>Workspace bookmarks</button>{open&&<ConsoleDialog title="Workspace bookmarks" onClose={()=>setOpen(false)}><form className="work-card" onSubmit={e=>{e.preventDefault();void change();}}>
    <label>Last task<input required maxLength={240} value={task} onChange={e=>setTask(e.target.value)}/></label><label>Editor<select value={editor} onChange={e=>setEditor(e.target.value)}><option>Antigravity</option><option>Visual Studio Code</option></select></label><label>Browser pages<textarea placeholder="One URL per line" value={pages} onChange={e=>setPages(e.target.value)}/></label><button disabled={busy}>Save my place</button></form>
    <output>{message}</output>{items.map(b=><article className="work-card" key={b.id}><strong>{b.task}</strong><small>{b.dir} · {b.branch||'No branch'} · {b.editor}</small><button disabled={busy} onClick={()=>void change(b.id)}>Reopen workspace</button></article>)}</ConsoleDialog>}</>;
}

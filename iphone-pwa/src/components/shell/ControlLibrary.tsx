'use client';
import {useEffect,useState} from 'react';
import {Bot,Clock3,Grid2X2,Search} from 'lucide-react';
import {PAGES,type DeckViewId} from './LeftNavRail';
import {ConsoleDialog} from './ConsoleDialog';
import {makeRequestId} from '@/lib/formatters';
import type {DevDeckState} from '@/hooks/useDevDeckSocket';
export function ControlLibrary({deck,active,navigate,present}:{deck:DevDeckState;active:DeckViewId;navigate:(v:DeckViewId)=>void;present:()=>void}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  function launch(){setQuery('');setOpen(true);}
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){e.preventDefault();launch();}};window.addEventListener('keydown',handler);return ()=>window.removeEventListener('keydown',handler);},[]);
  const q=query.toLowerCase().trim();const match=(s:string)=>s.toLowerCase().includes(q);
  function go(view:DeckViewId){setOpen(false);navigate(view);}
  const audio=match('audio volume sound output speaker mute '+(deck.macTelemetry?.audioOutputDevice||''));
  const screens=PAGES.filter(p=>match(p.title+' '+p.label+' '+p.id));
  const macros=(deck.config?.macros||[]).filter(m=>match([m.label,m.payload,m.sublabel,m.actionType].join(' ')));
  return <><nav className="work-nav" aria-label="Quick navigation">{([{id:'preview',name:'Clock',Icon:Clock3},{id:'deck',name:'Deck',Icon:Grid2X2},{id:'antigravity',name:'IDE',Icon:Bot}] as const).map(({id,name,Icon})=><button key={id} aria-current={active===id?'page':undefined} onClick={()=>go(id)}><Icon size={17}/>{name}</button>)}<button onClick={launch}><Search size={17}/>Library</button><button className="public-shortcut" onClick={present}>Presentation</button></nav>
  {open&&<ConsoleDialog title="Control library" onClose={()=>setOpen(false)}><input autoFocus type="search" aria-label="Find a control" placeholder="Search tools, audio or macros…" value={query} onChange={e=>setQuery(e.target.value)}/>
  {audio&&<section className="work-card"><h3>Audio</h3><small>{deck.macTelemetry?.audioOutputDevice||'Output device unavailable'} · {deck.status==='connected'?deck.mediaState.volume+'%':'Disconnected'}</small><input aria-label="Computer volume" disabled={deck.status!=='connected'} type="range" min={0} max={100} value={deck.mediaState.volume} onChange={e=>deck.sendEvent({type:'hardware:dial',payload:{mode:'volume',value:Number(e.target.value),delta:0}})}/><button disabled={deck.status!=='connected'} onClick={()=>deck.sendEvent({type:'hardware:mute',payload:{requestId:makeRequestId(),muted:!deck.mediaState.muted}})}>{deck.mediaState.muted?'Unmute':'Mute'}</button></section>}
  {match('private presentation shared display')&&<button onClick={()=>{setOpen(false);present();}}>Preview private presentation</button>}
  {screens.map(p=><button className="library-row" onClick={()=>go(p.id)} key={p.id}><p.icon size={17}/>{p.title}</button>)}
  {macros.map(m=><button className="library-row" key={m.id} onClick={()=>{setOpen(false);if(m.actionType==='voice')go('deck');else deck.sendEvent({type:'macro:execute',payload:{requestId:makeRequestId(),macroId:m.id}});}}>{m.label}<small>{m.profileId} · {m.actionType}</small></button>)}
  {match('setup pair install')&&<a href="/setup">Setup guide</a>}
  {!screens.length&&!macros.length&&!audio&&!match('private presentation shared display')&&!match('setup pair install')&&<small>No matching controls.</small>}</ConsoleDialog>}</>;
}
export function PublicDisplay({deck,preview,start,close}:{deck:DevDeckState;preview:boolean;start:()=>void;close:()=>void}){
  const [time,setTime]=useState('');
  useEffect(()=>{const tick=()=>setTime(new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));tick();const timer=setInterval(tick,1000);return ()=>clearInterval(timer);},[]);
  return <main className="public-display"><div><p>Desk Clock</p><time>{time}</time><div className="public-readings"><span>CPU <b>{deck.status==='connected'&&deck.stats.ts?deck.stats.cpuPct+'%':'—'}</b></span><span>Battery <b>{deck.status==='connected'&&deck.stats.batteryPct!=null?deck.stats.batteryPct+'%':'—'}</b></span></div>
  <div className="work-actions"><button disabled={deck.status!=='connected'} onClick={()=>deck.sendEvent({type:'media:control',payload:{action:'playpause',requestId:makeRequestId()}})}>Play / pause</button></div></div><footer>{preview&&<button onClick={start}>Start presentation</button>}<button onClick={close}>{preview?'Close preview':'End presentation'}</button></footer></main>;
}

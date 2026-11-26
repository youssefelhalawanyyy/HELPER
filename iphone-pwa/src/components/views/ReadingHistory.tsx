'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Activity, ActivityWindow, Reading } from '../../../../shared/activity';
import { bridgeRequest } from '@/lib/bridgeRequest';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { ConsoleDialog } from '../shell/ConsoleDialog';

type History = ActivityWindow & {incidents: Activity[]};
export type Metric = 'heat' | 'cpu' | 'battery';
const labels = {heat: 'CPU heat', cpu: 'CPU load', battery: 'Battery'};
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
function useHistory(deck: DevDeckState, path: string) {
  const [data,setData] = useState<History>();
  const [error,setError] = useState('');
  const base = deck.bridgeBaseUrl, pairing = deck.pairing;
  useEffect(() => {
    setData(undefined); setError('');
    if (!pairing || !base) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try { const next = await bridgeRequest<History>({bridgeBaseUrl:base,pairing},path,undefined,ctrl.signal);
        if (!ctrl.signal.aborted) {setData(next); setError('');}
      } catch(e) { if (!ctrl.signal.aborted) setError((e as Error).message); }
      if (!ctrl.signal.aborted) timer = setTimeout(refresh,5500);
    }
    void refresh();
    return () => { ctrl.abort(); clearTimeout(timer); };
  },[base,pairing,path]);
  return {data,error};
}
function workloadRates(rows: Reading[]) {
  const rates = new Map<string, { minutes: number; loss: number }>();
  for(let i=1;i<rows.length;i++) {
    const a=rows[i-1], b=rows[i], dt=(b.ts-a.ts)/60000;
    if (!a.onBattery || !b.onBattery || a.workload !== b.workload || !a.workload || dt>1 || a.battery==null || b.battery==null || b.battery>a.battery) continue;
    const total=rates.get(b.workload) || {minutes:0,loss:0};
    total.minutes+=dt; total.loss+=a.battery-b.battery; rates.set(b.workload,total);
  }
  return [...rates].filter(([,v])=>v.minutes>=5 && v.loss>0);
}
export function ReadingDetail({deck,metric='heat',center,onClose,header}:{deck:DevDeckState;metric?:Metric;center?:number;onClose:()=>void;header?:React.ReactNode}) {
  const {data,error}=useHistory(deck,center?'activity?center='+center:'activity?minutes='+(metric==='battery'?60:10));
  const rows=data?.readings || [];
  const samples=rows.filter(r=>r[metric]!=null);
  const first=rows[0]?.ts ?? 0, last=rows[rows.length-1]?.ts ?? 0;
  const gaugeRef=useRef<HTMLDivElement>(null);
  const returning=useRef(false);
  function moveGauge(back:boolean) {
    const node=gaugeRef.current, source=document.querySelector('[data-clock-key="'+metric+'"]');
    if(!node||!source||!node.animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const target=node.getBoundingClientRect(), origin=source.getBoundingClientRect();
    if(!target.width||!origin.width)return;
    const transform='translate('+(origin.left-target.left)+'px,'+(origin.top-target.top)+'px) scale('+origin.width/target.width+','+origin.height/target.height+')';
    const frames=[{transform},{transform:'none'}];
    return node.animate(back?frames.reverse():frames,{duration:190,easing:'cubic-bezier(.2,.75,.22,1)',fill:back?'forwards':'none'});
  }
  useLayoutEffect(()=>{const anim=moveGauge(false);return ()=>anim?.cancel();},[metric]);
  function dismiss(){
    if(returning.current)return;
    const anim=moveGauge(true);
    if(!anim){onClose();return;}
    returning.current=true;void anim.finished.then(onClose,onClose);
  }
  return <ConsoleDialog title={center?'Thermal incident replay':labels[metric]+' history'} onClose={dismiss}>
    {header&&<div ref={gaugeRef} className="work-dial">{header}</div>}
    {center && <strong>{clock(center)} · one minute either side</strong>}
    <small>{error || (!deck.pairing?'Pair your desktop to load readings.':!data?'Loading readings…':first ? clock(first)+' – '+clock(last!) : 'Waiting for recorded samples.')}</small>
    {samples.length>0 && <svg viewBox="0 0 480 82" role="img" aria-label={labels[metric]+' trend'} style={{width:'100%',background:'#0b181e',borderRadius:10}}>
      <polyline fill="none" stroke="#88f1d1" strokeWidth="2.4" points={samples.map(r=>[4+472*(r.ts-first)/Math.max(1,last-first),78-72*Math.min(1,(r[metric]||0)/(metric==='heat'?120:100))].join(',')).join(' ')}/>
      {center && center>=first && center<=last && <line x1={4+472*(center-first)/Math.max(1,last-first)} x2={4+472*(center-first)/Math.max(1,last-first)} y1="2" y2="80" stroke="#ffc36e" strokeDasharray="4 3"/>}
    </svg>}
    {metric==='battery' && (()=>{const values=rows.filter(r=>r.onBattery && r.minutes!=null && r.minutes>0 && Date.now()-r.ts<600000).map(r=>r.minutes!);if(!values.length)return null; const low=Math.min(...values),high=Math.max(...values);return <p>Recent remaining-time estimates · {low===high?low:low+'–'+high} min</p>;})()}
    {metric==='battery' && <div><strong>Recent drain by active app</strong>{workloadRates(rows).length?workloadRates(rows).map(([name,v])=><p key={name}>{name} · {(v.loss*60/v.minutes).toFixed(1)}% / hour</p>):<p><small>Needs five minutes on battery and a measured drop with the same app.</small></p>}</div>}
    {data?.events.map(e=><p key={e.id}><small>{clock(e.ts)}</small> · {e.title}</p>)}
    {rows.length>0 && <div style={{maxHeight:'40dvh',overflow:'auto'}}><table className="work-table"><thead><tr>{['Time','CPU °C','Load','Fan RPM',metric==='battery'?'Charge':'Busiest apps'].map(l=><th key={l}>{l}</th>)}</tr></thead>
      <tbody>{rows.slice().reverse().map(r=><tr key={r.ts}><td>{clock(r.ts)}</td><td>{r.heat??'—'}</td><td>{r.cpu==null?'—':r.cpu+'%'}</td><td>{r.rpm??'—'}</td><td>{metric==='battery'?(r.battery??'—')+'%':r.apps.join(', ')||'—'}</td></tr>)}</tbody></table></div>}
  </ConsoleDialog>;
}
export function IncidentList({deck}:{deck:DevDeckState}) {
  const {data,error}=useHistory(deck,'activity?minutes=1');
  const [center,setCenter]=useState<number>();
  return <section className="work-card"><h3>Thermal incident replay</h3>{data?.incidents.length ? data.incidents.map(e=><button key={e.id} onClick={()=>setCenter(e.ts)}>{new Date(e.ts).toLocaleString()} · {e.title}</button>):<small>{error || (deck.pairing?'No recorded heat alerts.':'Pair your desktop to view incidents.')}</small>}
    {center && <ReadingDetail deck={deck} center={center} onClose={()=>setCenter(undefined)}/>}</section>;
}

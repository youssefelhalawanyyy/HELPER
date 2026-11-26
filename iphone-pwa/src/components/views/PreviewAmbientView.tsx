'use client';

import { InstrumentGauge, processorHeatScale } from '@/components/shell/InstrumentGauge';

import { useEffect, useMemo, useState } from 'react';
import { ReadingDetail, type Metric } from './ReadingHistory';
import { motion } from 'framer-motion';
import { DeskWeather } from './DeskWeather';
import styles from './DeskClock.module.css';
import {
  Cpu,
  ExternalLink,
  Globe,
  Moon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Timer,
} from 'lucide-react';
import { DECK_SPRING } from '@/components/shell/HardwarePrimitives';
import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { formatTimer, makeRequestId } from '@/lib/formatters';
import { soundEngine } from '@/lib/soundEngine';

function extractUrl(text: string): string | null {
  const match = text.trim().match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}

function formatWorldClock(date: Date, timeZone: string): string {
  try {
    return date.toLocaleTimeString([], {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--';
  }
}

export interface DeskBreakController {
  deadline: number | null;
  changeDeadline: (value: number | null) => void;
}

export function PreviewAmbientView({
  deck,
  deskBreak,
  privateMode = false,
  onPair,
}: {
  deck: DevDeckState;
  deskBreak?: DeskBreakController;
  privateMode?: boolean;
  onPair?: () => void;
}) {
  const [mode, setMode] = useState<'ambient' | 'preview'>('ambient');
  const [urlInput, setUrlInput] = useState(deck.previewUrl);
  const [tunneledPreviewUrl, setTunneledPreviewUrl] = useState('');
  const [now, setNow] = useState<Date | null>(null);
  const [oledShift, setOledShift] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showWeather, setShowWeather] = useState(true);
  const [showClipboard, setShowClipboard] = useState(true);
  const [nightModeManual, setNightModeManual] = useState(false);
  const [metric,setMetric]=useState<Metric|null>(null);
  const [meeting,setMeeting]=useState('');
  const [lastSensor,setLastSensor]=useState(0);
  useEffect(()=>setMeeting(localStorage.getItem('devdeck.nextMeeting')||''),[]);
  useEffect(()=>{setLastSensor(Number(sessionStorage.getItem("heat-seen:"+deck.bridgeBaseUrl))||0);},[deck.bridgeBaseUrl]);
  useEffect(()=>{if(deck.status==="connected"&&deck.bridgeBaseUrl&&deck.powerState.cpuTempC!=null){setLastSensor(deck.powerState.updatedAt);sessionStorage.setItem("heat-seen:"+deck.bridgeBaseUrl,String(deck.powerState.updatedAt));}},[deck.status,deck.bridgeBaseUrl,deck.powerState.cpuTempC,deck.powerState.updatedAt]);
  const nightStandActive = nightModeManual;
  useEffect(() => setUrlInput(deck.previewUrl), [deck.previewUrl]);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => {if(!document.hidden)setNow(new Date());}, 1000);
    // Subtle 2px OLED Burn-In Protection Pixel Shift every 5 minutes
    const shiftTimer = window.setInterval(() => {
      const steps = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
        { x: -2, y: 1 },
      ];
      setOledShift(steps[Math.floor(Date.now() / 300_000) % steps.length]);
    }, 60_000);
    return () => {
      clearInterval(timer);
      clearInterval(shiftTimer);
    };
  }, []);
  useEffect(() => {
    if (deck.status === 'connected' && deck.powerState.cpuTempC === null) {
      deck.sendEvent({ type: 'power:refresh', payload: { requestId: makeRequestId() } });
    }
  }, [deck.status, deck.powerState.cpuTempC, deck.sendEvent]);
  const breakSec = Math.max(
    0,
    Math.ceil(((deskBreak?.deadline || 0) - (now?.getTime() || Date.now())) / 1000),
  );
  const rawPreview = deck.previewUrl || 'http://localhost:3000';
  useEffect(() => {
    if (mode !== 'preview') return;
    if (deck.status !== 'connected' || !deck.bridgeBaseUrl || !deck.pairing?.token) {
      setTunneledPreviewUrl('');
      return;
    }
    let alive = true;
    const wantHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    void fetch(`${deck.bridgeBaseUrl}/api/devsuite/preview-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${deck.pairing.token}`,
      },
      body: JSON.stringify({ url: rawPreview, wantHttps }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; previewUrl?: string }) => {
        if (alive && d?.ok && d.previewUrl) setTunneledPreviewUrl(d.previewUrl);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, rawPreview, deck.status, deck.bridgeBaseUrl, deck.pairing?.token]);

  const resolvedUrl = useMemo(() => {
    if (tunneledPreviewUrl) return tunneledPreviewUrl;
    if (!deck.hello?.lanIp) return rawPreview;
    return rawPreview.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i, `//${deck.hello.lanIp}`);
  }, [tunneledPreviewUrl, rawPreview, deck.hello?.lanIp]);

  const timeStr = now?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) || '––:––';
  const secStr = now ? String(now.getSeconds()).padStart(2, '0') : '––';
  const dateStr =
    now?.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) || 'Local time';
  const isConnected = deck.status === 'connected';

  const until = Date.parse(meeting)-(now?.getTime()||0);
  const age=(now?.getTime()||0)-lastSensor;
  const focus=deck.agentProgress.active?deck.agentProgress.step+' · '+deck.agentProgress.percent+'%':
    deck.logStatus.running && /build|test|check/i.test(deck.logStatus.command||'')?'Running '+deck.logStatus.command:
    until>0 && until<=1800000?'Meeting in '+Math.ceil(until/60000)+' min':
    lastSensor && age>45000?'Heat sensor last seen '+new Date(lastSensor).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';
  function dial(key:Metric){
    return key==='heat'?<InstrumentGauge label="CPU heat" unit="°C" max={120} value={isConnected?deck.powerState.cpuTempC:null} heat={processorHeatScale(deck.powerState.overheatTempC)}/>:
      key==='cpu'?<InstrumentGauge mode="tach" label="CPU load" value={isConnected&&deck.stats.ts?deck.stats.cpuPct:null} accent="#7dd3fc"/>:
      <InstrumentGauge mode="battery" label="Battery" value={isConnected&&deck.powerState.hasBattery?deck.powerState.batteryPct:null} accent="#acafff"/>;
  }
  const batteryMinutes=deck.powerState.timeRemainingMin;
  if (mode === 'preview') {
    return (
      <div className="tile preview-browser flex min-h-0 flex-1 flex-col p-2.5">
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('ambient')}
            className="flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-1 text-console-caption font-bold"
          >
            <Moon className="h-3 w-3 text-[#22d3ee]" />
            Desk Clock
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              deck.sendEvent({
                type: 'preview:set',
                payload: { requestId: makeRequestId(), url: urlInput.trim() },
              });
            }}
            className="flex flex-1 gap-1.5"
          >
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="font-mono-tech flex-1 rounded-full border border-white/10 bg-black px-3 py-1 text-console-caption text-white outline-none"
            />
            <button
              type="submit"
              className="rounded-full bg-[#34d399] px-3 py-1 text-console-caption font-extrabold text-[#04130c]"
            >
              Sync
            </button>
          </form>
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noreferrer"
            className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.08] text-[#22d3ee]"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <iframe
          src={resolvedUrl}
          title="Localhost Preview"
          className="min-h-0 flex-1 rounded-xl border border-white/10 bg-white"
        />
      </div>
    );
  }

  return (
    <div
      className={styles.dashboard}
      style={{
        transform: `translate3d(${oledShift.x}px, ${oledShift.y}px, 0)`,
        transition: 'transform 1.2s ease-in-out, opacity 0.35s ease',
        opacity: nightStandActive ? 0.52 : 1,
      }}
    >
      <section className={styles.hero}>
        <header className="flex items-center justify-between gap-2">
          <span className={`${styles.eyebrow} whitespace-nowrap`}>
            Desk Clock
            {deck.focusState.active ? ` · ${formatTimer(deck.focusState.remainingSec)}` : ''}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setNightModeManual((v) => !v)}
              title="Toggle gentle OLED dim mode"
              className="whitespace-nowrap !px-2.5 !py-1 !text-[11px]"
              style={{
                opacity: nightStandActive ? 1 : 0.6,
                borderColor: nightStandActive ? '#88f1d1' : undefined,
                color: nightStandActive ? '#88f1d1' : undefined,
              }}
            >
              {nightStandActive ? 'Dim ON' : 'Dim'}
            </button>
            <button
              type="button"
              onClick={() => setShowWeather((v) => !v)}
              title="Toggle Weather Widget"
              className="whitespace-nowrap !px-2.5 !py-1 !text-[11px]"
              style={{ opacity: showWeather ? 1 : 0.45 }}
            >
              Weather
            </button>
            <button
              type="button"
              onClick={() => setShowClipboard((v) => !v)}
              title="Toggle Clipboard Widget"
              className="whitespace-nowrap !px-2.5 !py-1 !text-[11px]"
              style={{ opacity: showClipboard ? 1 : 0.45 }}
            >
              Clips
            </button>
            <button
              onClick={() => setMode('preview')}
              className="whitespace-nowrap !px-2.5 !py-1 !text-[11px]"
            >
              <Globe size={13} />
              Preview
            </button>
          </div>
        </header>
        <div className={styles.face}>
          <div>
            <p>{dateStr}</p>
            <div className={styles.time}>
              {timeStr}
              <small>{secStr}</small>
            </div>
          </div>
          <div className={styles.dial} aria-hidden="true">
            {[
              [(now?.getHours() || 0) * 30 + (now?.getMinutes() || 0) / 2, 26],
              [(now?.getMinutes() || 0) * 6, 37],
              [(now?.getSeconds() || 0) * 6, 41],
            ].map(([angle, length], i) => (
              <i key={i} style={{ height: length + '%', transform: 'rotate(' + angle + 'deg)' }} />
            ))}
          </div>
        </div>
        {focus && <div className={styles.focus}>{focus}</div>}
        <div className={styles.world}>
          {[
            ['Cairo', 'Africa/Cairo'],
            ['London', 'Europe/London'],
            ['New York', 'America/New_York'],
          ].map(([city, zone]) => (
            <div key={zone}>
              <span>{city}</span>
              <b>{now ? formatWorldClock(now, zone) : '––:––'}</b>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.instrument}>
        <header>
          <h2>
            <Cpu size={17} />
            Computer
          </h2>
          {!isConnected && <button onClick={onPair}>Pair desktop</button>}
        </header>
        <div className={styles.cluster}>
          {(['cpu','heat','battery'] as const).map(key=><button type="button" key={key} aria-label={'View '+key+' history'} onClick={()=>setMetric(key)}>
            <div data-clock-key={key}>{dial(key)}</div></button>)}
        </div>
        {isConnected && deck.powerState.hasBattery && !deck.powerState.acConnected && batteryMinutes!=null && batteryMinutes>0 &&
          <button className="work-trigger" onClick={()=>setMetric('battery')}>About {Math.floor(batteryMinutes/60)}h {Math.round(batteryMinutes%60)}m at this workload</button>}
        <dl className={styles.readings}>
          {[
            ['Memory', deck.stats.ramUsedGb, ' GB'],
            ['Disk used', deck.stats.diskPct, '%'],
            ['Power draw', deck.powerState?.powerDrawW, ' W'],
            ['Download', deck.stats.netRxKBs, ' KB/s'],
            ['Upload', deck.stats.netTxKBs, ' KB/s'],
            ['Battery health', deck.powerState?.healthPct, '%'],
          ].map(([label, value, unit]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{isConnected && value != null ? Number(Number(value).toFixed(1)) + String(unit) : '—'}</dd>
            </div>
          ))}
        </dl>
      </section>
      {metric && <ReadingDetail metric={metric} deck={deck} onClose={()=>setMetric(null)} header={dial(metric)}/>}
      {showWeather && <DeskWeather />}
      <section className={styles.instrument}>
        <header>
          <h2>
            <Timer size={17} />
            Break timer
          </h2>
          <span>{breakSec ? formatTimer(breakSec) : 'Ready'}</span>
        </header>
        <div className={styles.controls}>
          {breakSec ? (
            <button onClick={() => deskBreak?.changeDeadline(null)}>Stop timer</button>
          ) : (
            [5, 10, 15].map((m) => (
              <button key={m} onClick={() => deskBreak?.changeDeadline(Date.now() + m * 60000)}>
                {m} min
              </button>
            ))
          )}
        </div>
        <label className={styles.meeting}>Next meeting<input type="datetime-local" value={meeting} onChange={e=>{setMeeting(e.target.value);localStorage.setItem('devdeck.nextMeeting',e.target.value);}}/></label>
        {/* Mac Media Controls */}
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.07] bg-black/60 p-2">
          {deck.mediaState.artworkUrl && (
            <img className={styles.art} src={deck.mediaState.artworkUrl} alt="" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-console-body font-bold">{deck.mediaState.track}</div>
            <div className="sub truncate !text-console-micro">{deck.mediaState.artist}</div>
            {Boolean(deck.mediaState.durationSec) && (
              <progress
                aria-label="Track progress"
                className={styles.progress}
                value={deck.mediaState.positionSec || 0}
                max={deck.mediaState.durationSec}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {(['prev', 'playpause', 'next'] as const).map((action) => (
              <motion.button
                key={action}
                type="button"
                whileTap={{ scale: 0.88 }}
                transition={DECK_SPRING}
                onClick={() => {
                  soundEngine.playClick();
                  deck.sendEvent({
                    type: 'media:control',
                    payload: { requestId: makeRequestId(), action },
                  });
                }}
                aria-label={action}
                className="grid h-7 w-7 place-items-center rounded-full"
                style={{
                  background: action === 'playpause' ? '#34d399' : 'rgba(255,255,255,.08)',
                  color: action === 'playpause' ? '#04130c' : '#f2f3f7',
                }}
              >
                {action === 'prev' ? (
                  <SkipBack className="h-3 w-3" />
                ) : action === 'next' ? (
                  <SkipForward className="h-3 w-3" />
                ) : deck.mediaState.playing ? (
                  <Pause className="h-3 w-3 fill-current" />
                ) : (
                  <Play className="h-3 w-3 fill-current" />
                )}
              </motion.button>
            ))}
          </div>
        </div>
      </section>

      {/* Right: Mac Clipboard History + Automatic "Open on iPhone" URL Detection */}
      {showClipboard && (
        <div className={styles.clipboard}>
          <div className="mb-2 flex items-center justify-between">
            <div className="disp text-[24px]">Clipboard</div>
            <span className="sub">
              {privateMode ? 'Private mode' : `${deck.clipboard.history.length} items`}
            </span>
          </div>

          {privateMode ? (
            <div className="sub grid flex-1 place-items-center rounded-xl border border-[#fbbf24]/25 bg-[#fbbf24]/5 p-4 text-center text-[#fbbf24]">
              Presentation Mode active — private clipboard previews, paths, and links are hidden.
            </div>
          ) : (
            <div className="deck-scroll flex-1 space-y-1.5 overflow-y-auto pr-0.5">
              {deck.clipboard.history.map((item) => {
                const detectedUrl = extractUrl(item.text);
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        deck.sendEvent({
                          type: 'clipboard:copy',
                          payload: { requestId: makeRequestId(), text: item.text },
                        });
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="font-mono-tech line-clamp-2 text-console-caption text-zinc-200">
                        {item.text}
                      </p>
                    </button>

                    {detectedUrl && (
                      <a
                        href={detectedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex shrink-0 items-center gap-1 rounded-full bg-[#22d3ee] px-2 py-1 text-console-caption font-extrabold text-[#041317]"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        Open
                      </a>
                    )}
                  </div>
                );
              })}

              {deck.clipboard.history.length === 0 && (
                <div className="sub grid h-full place-items-center text-center">
                  Copy text or a link on your computer to see it here.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

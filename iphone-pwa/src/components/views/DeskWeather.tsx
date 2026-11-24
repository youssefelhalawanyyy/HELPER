'use client';

import { useEffect, useState } from 'react';
import { CloudSun, LocateFixed, RefreshCw, Sunrise, Sunset } from 'lucide-react';
import styles from './DeskClock.module.css';

type Place = { label: string; latitude: number; longitude: number };
type Forecast = {
  current?: Partial<Record<'temperature_2m' | 'relative_humidity_2m' | 'apparent_temperature' | 'weather_code' | 'wind_speed_10m', number | null>>;
  daily?: { sunrise?: string[]; sunset?: string[] };
};

const cairo: Place = { label: 'Cairo', latitude: 30.0444, longitude: 31.2357 };
const refreshPeriod = 15 * 60_000;
let lastPlace = cairo;
let cache: { place: Place; report: Forecast; timestamp: number } | undefined;

function sky(code?: number | null) {
  if (code == null) return 'Conditions unavailable';
  if (code < 4) return ['Clear sky', 'Mostly clear', 'Partly cloudy', 'Overcast'][code];
  if (code < 50) return 'Fog';
  if (code < 60) return 'Drizzle';
  if (code < 70) return 'Rain';
  if (code < 80 || code === 85 || code === 86) return 'Snow';
  if (code < 90) return 'Rain showers';
  return 'Thunderstorms';
}

function reading(value: number | null | undefined, unit: string) {
  return value != null && Number.isFinite(value) ? Math.round(value) + unit : '—';
}

export function DeskWeather() {
  const [place, setPlace] = useState(lastPlace);
  const [report, setReport] = useState<Forecast | undefined>(cache?.place === place ? cache.report : undefined);
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    const load = async () => {
      if (document.hidden || fetching) return;
      if (cache?.place === place && Date.now() - cache.timestamp < refreshPeriod) {
        setReport(cache.report);
        return;
      }
      fetching = true;
      const params = new URLSearchParams({
        latitude: String(place.latitude), longitude: String(place.longitude),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
        daily: 'sunrise,sunset', forecast_days: '1', timezone: 'auto',
      });
      try {
        const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params, { signal: controller.signal });
        if (!res.ok) throw Error();
        const next: Forecast = await res.json();
        if (next.current?.temperature_2m == null) throw Error();
        if (controller.signal.aborted) return;
        cache = { place, report: next, timestamp: Date.now() };
        setReport(next);
        setMessage('');
      } catch {
        if (!controller.signal.aborted) setMessage('Weather update unavailable');
      } finally { fetching = false; }
    };
    void load();
    const timer = window.setInterval(load, refreshPeriod);
    document.addEventListener('visibilitychange', load);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [place, retry]);

  const locate = () => {
    if (!navigator.geolocation) { setMessage('Location unavailable in this browser'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      lastPlace = { label: 'Current location', latitude: coords.latitude, longitude: coords.longitude };
      setReport(undefined); setMessage(''); setPlace(lastPlace); setLocating(false);
    }, () => { setMessage('Location unavailable · showing ' + place.label); setLocating(false); }, { timeout: 8000, maximumAge: refreshPeriod });
  };
  const current = report?.current;
  return (
    <section className={styles.weather} aria-label="Weather and daylight">
      <header><h2><CloudSun size={18} />Weather</h2>
        <button type="button" className={styles.weatherLocation} aria-label="Use my location for weather" onClick={locate} disabled={locating}><LocateFixed size={14}/>{locating ? 'Locating…' : place.label}</button>
      </header>
      <div className={styles.temperature}><strong>{reading(current?.temperature_2m, '°C')}</strong><span>{current ? sky(current.weather_code) : (message ? 'No forecast' : 'Loading forecast…')}</span></div>
      <dl className={styles.weatherFacts}>
        <div><dt>Feels like</dt><dd>{reading(current?.apparent_temperature, '°C')}</dd></div>
        <div><dt>Humidity</dt><dd>{reading(current?.relative_humidity_2m, '%')}</dd></div>
        <div><dt>Wind</dt><dd>{reading(current?.wind_speed_10m, ' km/h')}</dd></div>
      </dl>
      <div className={styles.daylight}><span><Sunrise size={15} />Sunrise <b>{report?.daily?.sunrise?.[0]?.slice(11,16) || '—'}</b></span><span><Sunset size={15} />Sunset <b>{report?.daily?.sunset?.[0]?.slice(11,16) || '—'}</b></span></div>
      <footer><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
        {message && <button type="button" onClick={() => { setMessage(''); setRetry(v => v + 1); }}><RefreshCw size={12}/>{message}</button>}
      </footer>
    </section>
  );
}

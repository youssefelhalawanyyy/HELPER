export interface Reading {
  ts: number;
  heat: number | null;
  cpu: number | null;
  rpm: number | null;
  battery: number | null;
  onBattery: boolean;
  minutes: number | null;
  apps: string[];
  workload: string;
}
export interface Activity {
  ts: number;
  id: string;
  kind: 'heat' | 'action' | 'build';
  title: string;
}
export interface ActivityWindow {
  events: Activity[];
  readings: Reading[];
}

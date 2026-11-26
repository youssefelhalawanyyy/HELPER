import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { saveLocal, loadLocal } from './localStore.js';

import { renderViewport } from './reviewBrowser.js';
const exec = promisify(execFile);
export function webAddress(raw: string, local = false) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    (local && !['127.0.0.1','localhost','[::1]'].includes(url.hostname))) throw Error(local?'Choose a localhost preview URL':'Choose an HTTP or HTTPS page');
  return url.href;
}
export async function openPage(url: string) {
  const target = webAddress(url);
  if (process.platform==='win32') await exec('rundll32.exe',['url.dll,FileProtocolHandler',target]);
  else await exec(process.platform==='darwin'?'open':'xdg-open',[target]);
}
export async function openProject(dir: string, editor = 'Antigravity') {
  if (!['Antigravity','Visual Studio Code'].includes(editor) || !(await stat(dir)).isDirectory()) throw Error('Project or editor unavailable');
  if (process.platform==='darwin') await exec('open',['-a',editor,dir]);
  else if (process.platform==='win32') {
    const executable = editor === 'Antigravity' ? 'Antigravity' : 'Code';
    const folder = editor === 'Antigravity' ? 'Antigravity' : 'Microsoft VS Code';
    const locations = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Programs'),process.env.ProgramFiles].filter(Boolean);
    for (const base of locations) {
      const file = path.join(base!, folder, executable+'.exe');
      try { await access(file); } catch { continue; }
      const {spawn}=await import('node:child_process');
      await new Promise<void>((resolve,reject)=>{const child=spawn(file,[dir],{detached:true,stdio:'ignore'});child.once('spawn',()=>{child.unref();resolve();});child.once('error',reject);});
      return;
    }
    throw Error('Selected editor is unavailable');
  } else await exec(editor==='Antigravity'?'antigravity':'code',[dir]);
}
interface Bookmark { id:string; dir:string; editor:string; task:string; branch:string; pages:string[]; }
const bookmarks=loadLocal<Bookmark[]>('workspace-bookmarks.json',[]);
export function listBookmarks() {return bookmarks;}
export async function saveBookmark(dir:string,input:{editor:string;task:string;pages:string[]}) {
  if (!['Antigravity','Visual Studio Code'].includes(input.editor) || typeof input.task!=='string' || !Array.isArray(input.pages) || input.pages.length>8) throw Error('Choose an editor and up to eight pages');
  const pages=input.pages.map(url=>webAddress(url));
  const branch=(await exec('git',['-C',dir,'branch','--show-current']).catch(()=>({stdout:''}))).stdout.trim();
  bookmarks.unshift({id:randomUUID(),dir,editor:input.editor,task:input.task.slice(0,240),branch,pages});
  bookmarks.splice(24);saveLocal('workspace-bookmarks.json',bookmarks);
  return bookmarks;
}
export async function restoreBookmark(id:string) {
  const item=bookmarks.find(b=>b.id===id);
  if(!item) throw Error('Bookmark unavailable');
  await openProject(item.dir,item.editor);
  for(const url of item.pages) await openPage(url);
  return item;
}
const screenshots = new Map<string,{dir:string;ts:number}>();
export async function capturePage(raw:string, width:number,height:number) {
  const url=webAddress(raw,true);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<320||width>1920||height<320||height>1600) throw Error('Invalid viewport size');
  const candidates=process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']:
    process.platform==='win32'?[path.join(process.env.ProgramFiles||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'','Microsoft/Edge/Application/msedge.exe')]:['/usr/bin/chromium','/usr/bin/google-chrome'];
  let browser='';
  for(const file of candidates) {try{await access(file);browser=file;break;}catch{}}
  if(!browser) throw Error('Install Chrome or Edge on the bridge computer to capture a localhost page');
  const dir=await mkdtemp(path.join(os.tmpdir(),'devdeck-review-'));
  const file=path.join(dir,'preview.png');
  try {
    const png=await renderViewport(browser,path.join(dir,'profile'),url,width,height);
    await writeFile(file,png,{mode:0o600});
    await rm(path.join(dir,'profile'),{recursive:true,force:true});
    for(const [key,old] of screenshots) if(Date.now()-old.ts>86400000 || screenshots.size>=24){screenshots.delete(key);await rm(old.dir,{recursive:true,force:true});}
    screenshots.set(file,{dir,ts:Date.now()});
    return {image:'data:image/png;base64,'+png.toString('base64'),file,width:png.readUInt32BE(16),height:png.readUInt32BE(20),url};
  } catch(e) {await rm(dir,{recursive:true,force:true});throw e;}
}

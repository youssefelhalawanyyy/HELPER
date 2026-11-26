import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec=promisify(execFile);
const windowsLens = `Add-Type -AssemblyName System.Drawing,System.Windows.Forms
$p=[System.Windows.Forms.Cursor]::Position
$b=New-Object Drawing.Bitmap 100,100
$g=[Drawing.Graphics]::FromImage($b)
$m=New-Object IO.MemoryStream
try { $g.CopyFromScreen(($p.X-50),($p.Y-50),0,0,$b.Size)
$b.Save($m,[Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($m.ToArray()) } finally { $g.Dispose();$b.Dispose();$m.Dispose() }`;
export async function cursorLens(){
  if(process.platform==='win32'){
    const result=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',windowsLens],{timeout:4500});
    return 'data:image/jpeg;base64,'+result.stdout.trim();
  }
  if(process.platform!=='darwin')throw Error('Screen magnification requires a Mac or Windows desktop');
  const rect=await exec('osascript',['-l','JavaScript','-e',"ObjC.import('AppKit'); const p=$.NSEvent.mouseLocation; const h=$.NSScreen.screens.objectAtIndex(0).frame.size.height; [Math.round(p.x)-50,Math.round(h-p.y)-50,100,100].join(',')"],{timeout:2000});
  const dir=await mkdtemp(path.join(os.tmpdir(),'devdeck-lens-'));
  try{const file=path.join(dir,'cursor.jpg');await exec('screencapture',['-x','-t','jpg','-R'+rect.stdout.trim(),file],{timeout:2500});return 'data:image/jpeg;base64,'+(await readFile(file)).toString('base64');}
  finally{await rm(dir,{recursive:true,force:true});}
}

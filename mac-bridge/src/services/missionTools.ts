import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadDoctorAiKey } from './doctorAiAgent.js';

const exec = promisify(execFile);
export async function desktopSnapshot() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devdeck-screen-'));
  const file = path.join(dir, 'desktop.jpg');
  try {
    if (process.platform === 'darwin')
      await exec('screencapture', ['-x', '-m', '-t', 'jpg', file], { timeout: 8000 });
    else if (process.platform === 'win32') {
      const script = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b=[Windows.Forms.Screen]::PrimaryScreen.Bounds
$i=New-Object Drawing.Bitmap $b.Width,$b.Height
$g=[Drawing.Graphics]::FromImage($i)
$g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size)
$i.Save($env:DECK_SNAPSHOT,[Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose()
$i.Dispose()`;
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, DECK_SNAPSHOT: file },
        timeout: 8000,
      });
    } else throw Error('Desktop capture requires macOS or Windows');
    return {
      image: 'data:image/jpeg;base64,' + (await readFile(file)).toString('base64'),
      capturedAt: Date.now(),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function formatPrompt(text: string) {
  if (!text?.trim() || text.length > 5000) throw Error('Dictate a prompt of up to 5000 characters');
  const key = loadDoctorAiKey();
  if (!key) throw Error('Add a Gemini key in PC Doctor to format dictation');
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: 'Translate this Egyptian Arabic or English dictation into one clear English engineering request. Preserve scope, paths and identifiers. Do not solve or expand the task. Output only the request.',
            },
          ],
        },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.1 },
      }),
    },
  );
  if (!res.ok) throw Error('Prompt formatting unavailable. Your dictation is ready to edit.');
  const data = await res.json();
  const prompt = data.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text || '')
    .join('')
    .trim();
  if (!prompt) throw Error('Empty formatted prompt');
  return { prompt };
}

// Static programs read the typed text from stdin. It never enters a command line or clipboard.
export async function typeIntoHost(text: string) {
  if (typeof text !== 'string' || !text.length || text.length > 2048 || /[\r\n\x00]/.test(text))
    throw Error('Enter one line of up to 2048 characters');
  let program: string, args: string[];
  if (process.platform === 'darwin') {
    program = 'osascript';
    args = [
      '-l',
      'JavaScript',
      '-e',
      `ObjC.import('Foundation');const bytes=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;Application('System Events').keystroke(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes,$.NSUTF8StringEncoding)))`,
    ];
  } else if (process.platform === 'win32') {
    program = 'powershell.exe';
    args = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms
[Console]::InputEncoding=[Text.Encoding]::UTF8
foreach ($c in [Console]::In.ReadToEnd().ToCharArray()) {
  $s=[string]$c
  if ('+^%~(){}[]'.Contains($s)) { $s='{'+$s+'}' }
  [Windows.Forms.SendKeys]::SendWait($s)
}`,
    ];
  } else throw Error('Typing requires macOS or Windows');
  await new Promise<void>((resolve, reject) => {
    const child = execFile(program, args, { timeout: 10000 }, (error) =>
      error ? reject(Error('Host keyboard input failed')) : resolve(),
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(text, 'utf8');
  });
}

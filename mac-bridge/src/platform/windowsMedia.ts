import { runPowerShell } from './win32.js';
import type { MediaState } from '../types/protocol.js';

const query = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$mediaType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Length -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation?1'} | Select-Object -First 1
function AwaitOperation($op,$type){$task=$asTask.MakeGenericMethod($type).Invoke($null,@($op));$task.Wait();$task.Result}
$manager=AwaitOperation ($managerType::RequestAsync()) $managerType
$session=$manager.GetCurrentSession()
if(!$session){return}
$m=AwaitOperation ($session.TryGetMediaPropertiesAsync()) $mediaType
$t=$session.GetTimelineProperties()
$r=@{track=$m.Title;artist=$m.Artist;player=$session.SourceAppUserModelId;playing=($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing');positionSec=$t.Position.TotalSeconds;durationSec=$t.EndTime.TotalSeconds}
if($m.Thumbnail){try{
  $stream=AwaitOperation ($m.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime])
  if($stream.Size -gt 0 -and $stream.Size -lt 350000 -and $stream.ContentType -match '^image/(jpeg|png)$'){
    $reader=[System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $bytes=New-Object IO.MemoryStream
    $reader.CopyTo($bytes);$r.artworkUrl='data:'+$stream.ContentType+';base64,'+[Convert]::ToBase64String($bytes.ToArray())
    $bytes.Dispose();$reader.Dispose()
  }
  $stream.Dispose()
}catch{}}
$r | ConvertTo-Json -Compress`;

export async function windowsMedia(): Promise<Partial<MediaState>> {
  try {
    return JSON.parse(await runPowerShell(query, 4500));
  } catch {
    return {};
  }
}

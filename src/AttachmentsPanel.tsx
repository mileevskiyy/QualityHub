import {useEffect,useState,useRef} from 'react';
import {api} from './api';
interface Attachment {id:string;filename:string;kind:string;byte_size:number;sha256:string;retry:number;expires_at:string}
export default function AttachmentsPanel({projectId,resultId,canWrite}:{projectId:string;resultId:string;canWrite:boolean}){
 const [items,setItems]=useState<Attachment[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[file,setFile]=useState<File|null>(null),[kind,setKind]=useState('screenshot');
 const input=useRef<HTMLInputElement>(null);
 const base=`/projects/${projectId}`,path=`${base}/results/${resultId}/attachments`;
 useEffect(()=>{let cancelled=false;api<Attachment[]>(path).then(a=>{if(!cancelled)setItems(a);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[path]);
 async function upload(){if(!file)return;setBusy(true);setError('');try{
  if(file.size>4*1024*1024||!file.size)throw new Error('Choose a nonempty file up to 4 MiB.');
  const contentBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read file.'));reader.readAsDataURL(file);});
  await api(path,'POST',{filename:file.name,kind,contentBase64});setItems(await api<Attachment[]>(path));setFile(null);if(input.current)input.current.value='';
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="evidence-panel" aria-label="Execution attachments"><h4>Execution attachments</h4><p>Files are immutable evidence retained for 30 days. Adding evidence does not change the recorded outcome. Download traces and open them in your local Playwright Trace Viewer.</p>{error&&<div className="alert" role="alert">{error}</div>}
 {items.map(a=><article key={a.id} className="evidence-file"><a className="text-button" href={`/api${base}/attachments/${a.id}`} download>{a.filename}</a><small>{a.kind} · {a.byte_size.toLocaleString()} bytes · {a.retry<0?'manual evidence':`retry ${a.retry}`} · expires {new Date(a.expires_at).toLocaleDateString()}</small>{a.kind==='screenshot'&&<ScreenshotPreview url={`/api${base}/attachments/${a.id}`} filename={a.filename}/>}<details><summary>SHA-256</summary><code>{a.sha256}</code></details></article>)}{!items.length&&<p>No retained attachments for this execution.</p>}
 {canWrite&&<div className="evidence-upload"><label>Evidence type<select value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="screenshot">Screenshot (PNG, JPEG, WebP)</option><option value="log">Log (UTF-8 text)</option><option value="trace">Playwright trace (ZIP)</option></select></label><label>Evidence file<input ref={input} type="file" disabled={busy} accept={kind==='screenshot'?'.png,.jpg,.jpeg,.webp':kind==='trace'?'.zip':'.txt,.log,.json'} onChange={e=>setFile(e.target.files?.[0]||null)}/></label><button className="button secondary" type="button" disabled={busy||!file} onClick={upload}>{busy?'Uploading…':'Upload evidence'}</button><small>4 MiB per file. 20 files / 20 MiB per execution. Avoid including passwords or personal data.</small></div>}
 </section>;
}

function ScreenshotPreview({url,filename}:{url:string;filename:string}){
 const [open,setOpen]=useState(false),[src,setSrc]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();let objectUrl='';setError('');setSrc('');
  fetch(url,{signal:controller.signal,redirect:'error'}).then(async r=>{if(!r.ok)throw new Error('Screenshot is unavailable or access has expired.');const blob=await r.blob();if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(blob);setSrc(objectUrl);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[open,url]);
 return <div><button type="button" className="text-button" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Hide screenshot':'Preview screenshot'}</button>{open&&src&&<img className="evidence-preview" alt={`Evidence: ${filename}`} src={src}/>} {open&&error&&<p role="alert">{error}</p>}</div>;
}

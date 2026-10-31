import { useEffect, useState } from 'react';
import { ArrowLeftRight, ArrowDownToLine } from 'lucide-react';
import { api } from './api';
import type { ComparisonCategory, Run, RunComparison } from './types';

const labels:Record<ComparisonCategory,string> = {regression:'New failures',fixed:'Fixed',definition_changed:'Definition changed',status_changed:'Other status changes',added:'Added to run',omitted:'Not in candidate',unchanged:'Unchanged'};
const duration = (n:number|null) => n===null ? 'Not recorded' : `${n.toLocaleString()} ms`;
export default function RunComparisonPanel({projectId,runs,onOpenRun}:{projectId:string;runs:Run[];onOpenRun:(id:string)=>void}) {
  const completed = runs.filter(r=>r.status==='completed');
  const [baseline,setBaseline] = useState(completed[1]?.id||'');
  const [candidate,setCandidate] = useState(completed[0]?.id||'');
  const [data,setData] = useState<RunComparison|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState('');
  useEffect(()=>{
    if(!baseline||!candidate||baseline===candidate){setData(null);setError('');setLoading(false);return;}
    let cancelled=false;setData(null);setError('');setLoading(true);
    api<RunComparison>(`/projects/${projectId}/runs/compare?baseline=${encodeURIComponent(baseline)}&candidate=${encodeURIComponent(candidate)}`)
      .then(d=>{if(!cancelled)setData(d);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[projectId,baseline,candidate]);
  function download(){if(!data)return;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='qualityhub-run-comparison.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="panel comparison-panel" aria-label="Run comparison">
    <div className="panel-heading"><div><h2>Compare completed runs</h2><p>Separate product failures from changes to the test itself.</p></div><ArrowLeftRight size={21}/></div>
    <div className="comparison-body">
      {completed.length<2?<p>Complete at least two runs to compare saved results. Active runs stay out of the comparison because their outcomes can still change.</p>:<>
        <div className="comparison-selectors">
          <label>Baseline run<select value={baseline} onChange={e=>setBaseline(e.target.value)}><option value="">Choose baseline</option>{completed.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <button className="button secondary" aria-label="Swap baseline and candidate" onClick={()=>{setBaseline(candidate);setCandidate(baseline);}}><ArrowLeftRight size={16}/>Swap</button>
          <label>Candidate run<select value={candidate} onChange={e=>setCandidate(e.target.value)}><option value="">Choose candidate</option>{completed.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        </div>
        {baseline&&baseline===candidate&&<p role="alert">Choose two different runs.</p>}
        {loading&&<p role="status">Comparing saved evidence…</p>}{error&&<div className="alert" role="alert">{error}</div>}
        {data&&<>
          <p className="comparison-explanation">New failure = passed → failed with the same saved definition. Fixed = failed → passed. Changed definitions are counted separately. Not in candidate means omitted from this run, not deleted from the library. Durations use the last automated attempt; manual results have no measured duration.</p>
          <div className="comparison-counts">{Object.entries(labels).map(([key,title])=><button key={key} className={filter===key?'selected':''} onClick={()=>setFilter(filter===key?'all':key)} aria-pressed={filter===key}><strong>{data.summary[key as ComparisonCategory]}</strong>{title}</button>)}</div>
          <div className="comparison-tools"><label>Find test<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title or suite"/></label><label>Show changes<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All results</option>{Object.entries(labels).map(([key,title])=><option key={key} value={key}>{title}</option>)}</select></label><button className="button secondary" onClick={download}><ArrowDownToLine size={15}/>Export comparison</button></div>
          <div className="comparison-rows">{data.rows.filter(r=>(filter==='all'||r.category===filter)&&`${r.title} ${r.suite}`.toLowerCase().includes(search.toLowerCase())).map(r=><article className={`comparison-row ${r.category}`} key={r.caseId}>
            <div className="comparison-row-heading"><strong>{r.title}</strong><span>{labels[r.category]}</span></div><p>{r.suite}</p>
            <div className="comparison-sides">{(['baseline','candidate'] as const).map(side=>{const result=r[side];return <div key={side}><button className="text-button" onClick={()=>onOpenRun(data[side].id)}>Open {side} run</button>{result?<><p><b>{result.status}</b> · version {result.case_version}</p><small>Last attempt: {duration(side==='baseline'?r.baselineDurationMs:r.candidateDurationMs)}</small><details><summary>Saved definition and observation</summary><strong>{result.snapshot.title}</strong><p>{result.snapshot.preconditions}</p><ol>{result.snapshot.steps.map((s,i)=><li key={i}>{s}</li>)}</ol><p>Expected: {result.snapshot.expected}</p><p className="preserve">Observed: {result.note||'No observation recorded.'}</p></details></>:<p>Not included</p>}</div>;})}</div>
            {r.durationDeltaMs!==null&&<p>Last-attempt duration change: {r.durationDeltaMs>0?'+':''}{duration(r.durationDeltaMs)}{r.category==='definition_changed'?' · Different definitions; not a like-for-like performance comparison.':''}</p>}
          </article>)}{!data.rows.some(r=>(filter==='all'||r.category===filter)&&`${r.title} ${r.suite}`.toLowerCase().includes(search.toLowerCase()))&&<p>No results match these filters.</p>}</div>
        </>}
      </>}
    </div>
  </section>;
}

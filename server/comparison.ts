import type { Result, Run, RunComparison, ComparisonCategory } from '../src/types.ts';

type SnapshotRun = Pick<Run, 'id'|'name'|'status'|'created_at'> & { results: Result[] };
type Attempt = { result_id: string; retry: number; duration_ms: number };

// Compare stored identities and snapshots, never mutable library titles or array positions.
export function compareSnapshots(baseline: SnapshotRun, candidate: SnapshotRun, beforeAttempts: Attempt[], afterAttempts: Attempt[]): RunComparison {
  const before = new Map(baseline.results.map(r => [r.case_id, r]));
  const after = new Map(candidate.results.map(r => [r.case_id, r]));
  const duration = (result: Result | undefined, attempts: Attempt[]) => {
    const latest = attempts.filter(a => a.result_id === result?.id).sort((a,b) => b.retry-a.retry)[0];
    return latest ? Number(latest.duration_ms) : null;
  };
  const summary: Record<ComparisonCategory, number> = { regression:0, fixed:0, definition_changed:0, status_changed:0, added:0, omitted:0, unchanged:0 };
  const rows = [...new Set([...before.keys(), ...after.keys()])].map(caseId => {
    const a = before.get(caseId), b = after.get(caseId);
    const definitionChanged = Boolean(a && b && (a.case_version !== b.case_version || JSON.stringify(a.snapshot) !== JSON.stringify(b.snapshot)));
    const category: ComparisonCategory = !a ? 'added' : !b ? 'omitted' : definitionChanged ? 'definition_changed' : a.status==='passed' && b.status==='failed' ? 'regression' : a.status==='failed' && b.status==='passed' ? 'fixed' : a.status!==b.status ? 'status_changed' : 'unchanged';
    summary[category]++;
    const baselineDurationMs = duration(a,beforeAttempts), candidateDurationMs = duration(b,afterAttempts);
    return { caseId, title:(b||a)!.snapshot.title, suite:(b||a)!.snapshot.suite, category,
      baseline:a||null, candidate:b||null, baselineDurationMs, candidateDurationMs,
      durationDeltaMs:baselineDurationMs!==null && candidateDurationMs!==null ? candidateDurationMs-baselineDurationMs : null };
  });
  const metadata = ({id,name,status,created_at}:SnapshotRun) => ({id,name,status,created_at});
  return { schemaVersion:1, baseline:metadata(baseline), candidate:metadata(candidate), summary, rows };
}

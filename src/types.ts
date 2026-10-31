export type Priority = 'critical'|'high'|'medium'|'low';
export type Status = 'untested'|'passed'|'failed'|'blocked'|'skipped';
export interface Project { id: string; name: string; description: string; created_at: string; role?:'owner'|'tester'|'viewer' }
export interface User {id:string;name:string;email:string;csrf:string}
export interface CaseData { title: string; suite: string; priority: Priority; preconditions: string; steps: string[]; expected: string }
export interface TestCase extends CaseData { id: string; version: number; project_id: string }
export interface Result { id: string; case_id: string; case_version: number; snapshot: CaseData; status: Status; note: string; revision: number; defect_id: string|null }
export interface Run { id: string; name: string; status: 'active'|'completed'; created_at: string; total: number; passed: number; failed: number; blocked: number; untested: number; results?: Result[] }
export interface Defect { id: string; title: string; description: string; severity: Priority; status: 'open'|'in_progress'|'resolved'; run_id: string; case_version: number; created_at: string }
export interface Event { id: string; action: string; detail: string; created_at: string }

export type ComparisonCategory = 'regression'|'fixed'|'definition_changed'|'status_changed'|'added'|'omitted'|'unchanged';
export interface ComparisonRow {
  caseId:string; title:string; suite:string; category:ComparisonCategory;
  baseline:Result|null; candidate:Result|null;
  baselineDurationMs:number|null; candidateDurationMs:number|null; durationDeltaMs:number|null;
}
export interface RunComparison {
  schemaVersion:1;
  baseline:Pick<Run,'id'|'name'|'status'|'created_at'>;
  candidate:Pick<Run,'id'|'name'|'status'|'created_at'>;
  summary:Record<ComparisonCategory,number>;
  rows:ComparisonRow[];
}

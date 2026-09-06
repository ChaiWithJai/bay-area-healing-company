import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

const statuses = new Set(['queued', 'running', 'blocked', 'completed', 'failed', 'cancelled']);
const privateKey = /secret|password|credential|authorization|api.?key|access.?token|refresh.?token|prompt|raw.?output/i;
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !privateKey.test(k)).map(([k,v]) => [k,redact(v)]));
  return value;
}
export class RunStore {
  constructor(stateDir) {
    mkdirSync(stateDir, {recursive:true, mode:0o700});
    this.path = join(stateDir, 'runs.sqlite');
    this.db = new DatabaseSync(this.path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id), type TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS steps(run_id TEXT NOT NULL REFERENCES runs(id), step_id TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(run_id,step_id));
      CREATE TABLE IF NOT EXISTS attempts(run_id TEXT NOT NULL REFERENCES runs(id), attempt_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,attempt_id));`);
  }
  createRun(metadata) {
    if (!metadata?.id || !metadata.workflow) throw new Error('Run id and workflow required');
    const now = new Date().toISOString();
    const row = {...redact(metadata), status:metadata.status ?? 'queued', createdAt:now, updatedAt:now,
      provenance:{node:process.version, platform:process.platform, arch:process.arch, cpu:os.cpus()[0]?.model ?? null, totalMemoryBytes:os.totalmem(), ...redact(metadata.provenance ?? {})}};
    if (!statuses.has(row.status)) throw new Error('Invalid run status');
    this.db.prepare('INSERT INTO runs VALUES (?,?)').run(row.id, JSON.stringify(row));
    return row;
  }
  getRun(id) { const row=this.db.prepare('SELECT metadata FROM runs WHERE id=?').get(id); return row ? JSON.parse(row.metadata) : null; }
  listRuns() { return this.db.prepare('SELECT metadata FROM runs ORDER BY rowid DESC').all().map(r=>JSON.parse(r.metadata)); }
  updateRun(id,patch) {
    const old=this.getRun(id); if(!old) throw new Error(`Unknown run: ${id}`);
    for(const key of ['id','workflow','inputDir','outputDir','createdAt']) if(key in patch && patch[key] !== old[key]) throw new Error(`Immutable run identity: ${key}`);
    const row={...old,...redact(patch),updatedAt:new Date().toISOString()};
    if(!statuses.has(row.status)) throw new Error('Invalid run status');
    this.db.prepare('UPDATE runs SET metadata=? WHERE id=?').run(JSON.stringify(row),id); return row;
  }
  event(runId,type,data={}) {
    if(type==='model.request.finished' && !data.attemptId) throw new Error('Finished model request requires attemptId');
    const safe=redact(data), at=new Date().toISOString(), id=randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(type==='model.request.finished') {
        const existing=this.db.prepare('SELECT data FROM attempts WHERE run_id=? AND attempt_id=?').get(runId,data.attemptId);
        if(existing) {this.db.exec('COMMIT'); return {deduplicated:true,attemptId:data.attemptId};}
        this.db.prepare('INSERT INTO attempts VALUES (?,?,?)').run(runId,data.attemptId,JSON.stringify(safe));
      }
      const inserted=this.db.prepare('INSERT INTO events(id,run_id,type,at,data) VALUES (?,?,?,?,?)').run(id,runId,type,at,JSON.stringify(safe));
      this.db.exec('COMMIT'); return {seq:Number(inserted.lastInsertRowid),id,runId,type,at,data:safe};
    } catch(error) {this.db.exec('ROLLBACK'); throw error;}
  }
  events(runId) {return this.db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY seq').all(runId).map(r=>({seq:r.seq,id:r.id,runId:r.run_id,type:r.type,at:r.at,data:JSON.parse(r.data)}));}
  saveStep(runId,stepId,result) {this.db.prepare('INSERT INTO steps VALUES (?,?,?) ON CONFLICT(run_id,step_id) DO UPDATE SET result=excluded.result').run(runId,stepId,JSON.stringify(redact(result))); return result;}
  getSteps(runId) {return this.db.prepare('SELECT step_id,result FROM steps WHERE run_id=? ORDER BY rowid').all(runId).map(r=>({stepId:r.step_id,...JSON.parse(r.result)}));}
  close() {this.db.close();}
}

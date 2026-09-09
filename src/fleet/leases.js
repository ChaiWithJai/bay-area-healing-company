import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const label=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;return true;}};
const abortError=()=>new Error('Lease acquisition cancelled');
function pause(ms,signal){return new Promise((resolve,reject)=>{let timer;const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(abortError());};if(signal?.aborted)return abort();timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});}

/** Exclusive process leases on ONE coordinator host, using its local PID space.
 * No expiry steals a lease from a live PID. A PID that has been reused remains
 * conservatively live until an operator resolves it. Not a distributed lease.
 */
export class CoordinatorLeases {
 constructor(databasePath){
  mkdirSync(dirname(databasePath),{recursive:true,mode:0o700});this.db=new DatabaseSync(databasePath);
  // Busy waits stay short so acquisition cancellation/deadlines remain responsive.
  this.db.exec('PRAGMA busy_timeout=40; CREATE TABLE IF NOT EXISTS leases(resource TEXT PRIMARY KEY, worker_id TEXT, run_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, owner_pid INTEGER NOT NULL, acquired_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS worker_quarantines(worker_id TEXT PRIMARY KEY, reason TEXT NOT NULL, previous_owner_pid INTEGER, previous_run_id TEXT, created_at TEXT NOT NULL)');
 }
 tryAcquire({resource,workerId=null,runId}){
  if(typeof resource!=='string'||!/^(worker|run):[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(resource)||!label(runId)||(workerId!==null&&!label(workerId)))throw new Error('Invalid lease identity');
  if(resource.startsWith('worker:')&&resource!==`worker:${workerId}`)throw new Error('Worker resource must match worker ID');
  if(resource.startsWith('run:')&&resource!==`run:${runId}`)throw new Error('Run resource must match run ID');
  let begun=false;
  try{
   this.db.exec('BEGIN IMMEDIATE');begun=true;
   const quarantine=workerId?this.inspectQuarantine(workerId):null;
   if(quarantine){this.db.exec('COMMIT');begun=false;throw Object.assign(new Error(`Worker ${workerId} quarantined: ${quarantine.reason}`),{code:'WORKER_QUARANTINED',workerId,quarantine});}
   const old=this.db.prepare('SELECT * FROM leases WHERE resource=?').get(resource);
   if(old&&alive(old.owner_pid)){this.db.exec('COMMIT');return {acquired:false,owner:{pid:old.owner_pid,workerId:old.worker_id,runId:old.run_id,acquiredAt:old.acquired_at}};}
   if(old&&resource.startsWith('worker:')){
    const reason='dead_coordinator_backend_idle_unproven';
    this.db.prepare('INSERT INTO worker_quarantines VALUES(?,?,?,?,?)').run(workerId,reason,old.owner_pid,old.run_id,new Date().toISOString());
    this.db.exec('COMMIT');begun=false;
    throw Object.assign(new Error(`Worker ${workerId} quarantined: ${reason}`),{code:'WORKER_QUARANTINED',workerId});
   }
   // Run leases alone can reclaim a dead owner without backend verification.
   if(old)this.db.prepare('DELETE FROM leases WHERE resource=? AND token=?').run(resource,old.token);
   const lease={resource,workerId,runId,token:randomUUID(),ownerPid:process.pid,acquiredAt:new Date().toISOString(),reclaimedDeadOwner:Boolean(old),previousOwnerPid:old?.owner_pid??null};
   this.db.prepare('INSERT INTO leases VALUES(?,?,?,?,?,?)').run(resource,workerId,runId,lease.token,lease.ownerPid,lease.acquiredAt);
   this.db.exec('COMMIT');return {acquired:true,lease,reclaimedDeadOwner:Boolean(old)};
  }catch(error){if(begun)this.db.exec('ROLLBACK');if(/busy|locked/i.test(error.message))return {acquired:false,busy:true};throw error;}
 }
 async acquire({resource,workerId=null,runId,signal,timeoutMs=30000,pollMs=25}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||!Number.isFinite(pollMs)||pollMs<1)throw new Error('Invalid lease wait budget');
  const deadline=performance.now()+timeoutMs;
  for(;;){
   if(signal?.aborted)throw abortError();
   if(performance.now()>=deadline)throw new Error('Lease acquisition deadline exceeded');
   const result=this.tryAcquire({resource,workerId,runId});
   if(result.acquired){
    // Cancellation/deadline may arrive while SQLite was briefly busy.
    if(signal?.aborted||performance.now()>=deadline){this.release(result.lease);throw signal?.aborted?abortError():new Error('Lease acquisition deadline exceeded');}
    return result.lease;
   }
   await pause(Math.min(pollMs,Math.max(1,deadline-performance.now())),signal);
  }
 }
 release({resource,token,ownerPid=process.pid}){
  // Ownership token prevents an old/retried release from deleting a replacement.
  // Local PID restriction also prevents another process using a leaked token.
  if(ownerPid!==process.pid)return false;
  return this.db.prepare('DELETE FROM leases WHERE resource=? AND token=? AND owner_pid=?').run(resource,token,process.pid).changes===1;
 }
 inspect(resource){const row=this.db.prepare('SELECT resource,worker_id,run_id,owner_pid,acquired_at FROM leases WHERE resource=?').get(resource);return row??null;}
 quarantineOwned(lease,reason='incomplete_generation_backend_idle_unproven'){
  if(!lease?.workerId||!reason)throw new Error('Worker lease and quarantine reason required');
  let begun=false;
  try{
   this.db.exec('BEGIN IMMEDIATE');begun=true;
   const old=this.db.prepare('SELECT * FROM leases WHERE resource=? AND token=? AND owner_pid=?').get(lease.resource,lease.token,process.pid);
   if(!old)throw new Error('Only current worker lease owner can quarantine');
   this.db.prepare('INSERT OR IGNORE INTO worker_quarantines VALUES(?,?,?,?,?)').run(lease.workerId,reason,process.pid,lease.runId,new Date().toISOString());
   this.db.exec('COMMIT');begun=false;return this.inspectQuarantine(lease.workerId);
  }catch(error){if(begun)this.db.exec('ROLLBACK');throw error;}
 }
 inspectQuarantine(workerId){return this.db.prepare('SELECT * FROM worker_quarantines WHERE worker_id=?').get(workerId)??null;}
 clearQuarantine(workerId,{attestation}={}){
  if(!label(workerId)||attestation!=='runtime-stopped-or-idle-verified')throw new Error('Explicit runtime-stopped-or-idle-verified attestation required');
  let begun=false;
  try{
   this.db.exec('BEGIN IMMEDIATE');begun=true;
   const old=this.db.prepare('SELECT * FROM leases WHERE resource=?').get(`worker:${workerId}`);
   if(old&&alive(old.owner_pid))throw new Error('Cannot clear quarantine while worker lease owner is alive');
   const prior=this.inspectQuarantine(workerId);
   if(old)this.db.prepare('DELETE FROM leases WHERE resource=? AND token=?').run(old.resource,old.token);
   this.db.prepare('DELETE FROM worker_quarantines WHERE worker_id=?').run(workerId);
   this.db.exec('COMMIT');begun=false;
   return {workerId,cleared:Boolean(prior),attestation,remoteBackendIdleProven:false,previousQuarantine:prior};
  }catch(error){if(begun)this.db.exec('ROLLBACK');throw error;}
 }
 close(){this.db.close();}
}

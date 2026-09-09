import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {CoordinatorLeases} from '../src/fleet/leases.js';
const childPath=fileURLToPath(new URL('./support/lease-owner-child.mjs',import.meta.url));
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'wm-leases-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'leases.sqlite');}
function child(t,file,worker,run,timeout=3000){const p=fork(childPath,[file,worker,run,String(timeout)],{stdio:['ignore','ignore','ignore','ipc']});t.after(()=>{if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');});return p;}
function message(p){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Child IPC deadline')),5000);p.once('message',m=>{clearTimeout(timer);resolve(m);});});}
function exit(p){return new Promise(resolve=>{if(p.exitCode!==null||p.signalCode!==null)resolve();else p.once('exit',resolve);});}

test('separate processes exclude the same worker until matching owner release',async t=>{
 const file=await setup(t),a=child(t,file,'mac48','run-a');assert.equal((await message(a)).acquired,true);
 const b=child(t,file,'mac48','run-b');let acquired=false;const next=message(b).then(m=>{acquired=m.acquired;return m;});
 await new Promise(r=>setTimeout(r,120));assert.equal(acquired,false);
 a.send('release');await exit(a);assert.equal((await next).acquired,true);b.send('release');await exit(b);
});
test('separate processes can hold different workers concurrently',async t=>{
 const file=await setup(t),a=child(t,file,'mac48','run-a'),b=child(t,file,'gb10','run-b');
 const [x,y]=await Promise.all([message(a),message(b)]);assert.equal(x.acquired,true);assert.equal(y.acquired,true);assert.notEqual(x.lease.token,y.lease.token);
 a.send('release');b.send('release');await Promise.all([exit(a),exit(b)]);
});
test('aborting a waiting process leaves the active owner untouched',async t=>{
 const file=await setup(t),a=child(t,file,'mac48','run-a');const original=await message(a);
 const b=child(t,file,'mac48','run-b');const waiting=message(b);setTimeout(()=>b.send('abort'),100);assert.match((await waiting).error,/cancelled/);await exit(b);
 const store=new CoordinatorLeases(file);assert.equal(store.inspect('worker:mac48').owner_pid,original.lease.ownerPid);store.close();a.send('release');await exit(a);
});
test('dead worker owner persists quarantine until explicit operator reset',async t=>{
 const file=await setup(t),a=child(t,file,'mac48','run-a');await message(a);a.kill('SIGKILL');await exit(a);
 const store=new CoordinatorLeases(file);t.after(()=>store.close());
 for(let n=0;n<2;n++)assert.throws(()=>store.tryAcquire({resource:'worker:mac48',workerId:'mac48',runId:'run-b'}),{code:'WORKER_QUARANTINED'});
 assert.equal(store.inspectQuarantine('mac48').reason,'dead_coordinator_backend_idle_unproven');
 const other=new CoordinatorLeases(file);assert.throws(()=>other.tryAcquire({resource:'worker:mac48',workerId:'mac48',runId:'run-c'}),{code:'WORKER_QUARANTINED'});other.close();
 assert.throws(()=>store.clearQuarantine('mac48'),/attestation/);
 assert.equal(store.clearQuarantine('mac48',{attestation:'runtime-stopped-or-idle-verified'}).remoteBackendIdleProven,false);
 const next=store.tryAcquire({resource:'worker:mac48',workerId:'mac48',runId:'run-b'});assert.equal(next.acquired,true);store.release(next.lease);
});
test('dead run owner remains automatically reclaimable',async t=>{
 const file=await setup(t),a=child(t,file,'mac48','run-a');const old=await message(a);a.kill('SIGKILL');await exit(a);
 const store=new CoordinatorLeases(file);t.after(()=>store.close());
 store.db.prepare('UPDATE leases SET resource=?,worker_id=NULL WHERE resource=?').run('run:run-a','worker:mac48');
 const next=store.tryAcquire({resource:'run:run-a',runId:'run-a'});assert.equal(next.acquired,true);assert.equal(next.lease.reclaimedDeadOwner,true);assert.notEqual(next.lease.token,old.lease.token);store.release(next.lease);
});
test('uncertain generation quarantine survives release and rejects reset under live lease',async t=>{
 const file=await setup(t),store=new CoordinatorLeases(file);t.after(()=>store.close());
 const lease=store.tryAcquire({resource:'worker:mac48',workerId:'mac48',runId:'run-a'}).lease;
 assert.throws(()=>store.quarantineOwned({...lease,token:'wrong'}),/owner/);
 store.quarantineOwned(lease);assert.throws(()=>store.clearQuarantine('mac48',{attestation:'runtime-stopped-or-idle-verified'}),/alive/);
 store.release(lease);assert.throws(()=>store.tryAcquire({resource:'worker:mac48',workerId:'mac48',runId:'run-b'}),{code:'WORKER_QUARANTINED'});
 store.clearQuarantine('mac48',{attestation:'runtime-stopped-or-idle-verified'});assert.equal(store.inspectQuarantine('mac48'),null);
});
test('wrong token cannot release and live owner is never stolen on deadline',async t=>{
 const file=await setup(t),store=new CoordinatorLeases(file);t.after(()=>store.close());
 const lease=await store.acquire({resource:'worker:mac48',workerId:'mac48',runId:'root-run'});
 assert.equal(store.release({...lease,token:'wrong'}),false);assert.equal(store.inspect('worker:mac48').run_id,'root-run');
 const waiter=child(t,file,'mac48','run-b',100);assert.match((await message(waiter)).error,/deadline/);await exit(waiter);assert.equal(store.inspect('worker:mac48').owner_pid,process.pid);assert.equal(store.release(lease),true);
});
test('run leases provide independent run exclusion and reject mismatched identities',async t=>{
 const file=await setup(t),store=new CoordinatorLeases(file);t.after(()=>store.close());
 const lease=await store.acquire({resource:'run:run-one',runId:'run-one'});assert.equal(store.tryAcquire({resource:'run:run-one',runId:'run-one'}).acquired,false);
 assert.throws(()=>store.tryAcquire({resource:'worker:mac48',workerId:'other',runId:'run-one'}),/match/);assert.equal(store.release(lease),true);
});

import { awaitAdmission } from '../fleet/admission.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { testProvider } from './index.js';
import { RunStore, startResourceSampler } from '../observability/index.js';
import { CoordinatorLeases } from '../fleet/leases.js';

// Qualification follows the same run→worker lease order as real workflows.
// The injected probe and the default provider both receive the abort signal.
export async function accountedProbe(config, profile, probe=testProvider, {signal,timeoutMs=config.limits?.runTimeoutMs??900000,readTelemetry}={}) {
 const id=randomUUID(),attemptId=randomUUID(),workerId=config.providers?.[profile]?.workerId??'coordinator';
 const store=new RunStore(config.stateDir);let leases,runLease,workerLease,sampler;
 const ctl=new AbortController(),forward=()=>ctl.abort(signal.reason);signal?.addEventListener('abort',forward,{once:true});if(signal?.aborted)forward();
 const timer=setTimeout(()=>ctl.abort(new Error('Qualification deadline exceeded')),timeoutMs);
 try {
  ctl.signal.throwIfAborted();leases=new CoordinatorLeases(path.join(config.stateDir,'coordinator-leases.sqlite'));
  runLease=await leases.acquire({resource:`run:${id}`,runId:id,signal:ctl.signal,timeoutMs});
  store.createRun({id,workflow:'qualification/structured_probe',runType:'qualification',config,profile,status:'running'});
  store.event(id,'lease.acquired',{scope:'run',coordinatorPid:process.pid,reclaimedDeadOwner:runLease.reclaimedDeadOwner,remoteBackendIdleProven:false});
  sampler=startResourceSampler(sample=>store.event(id,'resource.sample',sample),{intervalMs:1000});
  const waitStart=Date.now();store.event(id,'lease.waiting',{scope:'worker',workerId,profile});
  workerLease=await leases.acquire({resource:`worker:${workerId}`,workerId,runId:id,signal:ctl.signal,timeoutMs});
  store.event(id,'lease.acquired',{scope:'worker',workerId,profile,waitDurationMs:Date.now()-waitStart,reclaimedDeadOwner:workerLease.reclaimedDeadOwner,remoteBackendIdleProven:false});
  await awaitAdmission({config,workerId,signal:ctl.signal,readTelemetry,onEvent:(type,data)=>store.event(id,type,{...data,profile})});
  ctl.signal.throwIfAborted();
  store.event(id,'model.request.started',{attemptId,profile,workerId,transport:workerId==='coordinator'?'loopback':'ssh'});
  try {
   // Never release a live request just because a separate timeout promise wins.
   // Await provider cancellation/settlement before accounting and release.
   const result=await probe(config,profile,{signal:ctl.signal});
   if(ctl.signal.aborted){const error=new Error('Qualification cancelled before request settlement');error.metrics=result.metrics;throw error;}
   store.event(id,'model.request.finished',{attemptId,profile,...result.metrics,success:true});
   store.updateRun(id,{status:'completed'});return {...result,runId:id};
  } catch(error) {
   if(error.metrics?.workerIdleUncertain){const quarantine=leases.quarantineOwned(workerLease);store.event(id,'worker.quarantined',{workerId,profile,quarantine,remoteBackendIdleProven:false});}
   store.event(id,'model.request.finished',{attemptId,profile,...(error.metrics??{inputTokens:null,outputTokens:null}),success:false,cancelled:ctl.signal.aborted,error:error.message});throw error;
  }
 } catch(error){if(runLease&&store.getRun(id))store.updateRun(id,{status:ctl.signal.aborted?'cancelled':'blocked',error:error.message});error.runId=id;throw error;}
 finally {
  clearTimeout(timer);signal?.removeEventListener('abort',forward);
  try {if(workerLease){const released=leases.release(workerLease);store.event(id,'lease.released',{scope:'worker',workerId,released});}}
  finally {try{await sampler?.stop();}finally{try{if(runLease){const released=leases.release(runLease);if(store.getRun(id))store.event(id,'lease.released',{scope:'run',released});}}finally{leases?.close();store.close();}}}
 }
}

import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readWorkerTelemetry, decideAdmission } from './telemetry.js';

function policyFor(config){
 const p={maxWaitMs:30000,pollMs:1000,maxAgeMs:15000,maxCpuPercent:85,maxMemoryPressureLevel:1,...config.admission};
 for(const [key,max] of [['maxWaitMs',300000],['pollMs',60000],['maxAgeMs',60000]])if(!Number.isFinite(p[key])||p[key]<1||p[key]>max)throw Object.assign(new Error(`Invalid admission ${key}`),{code:'ADMISSION_POLICY'});
 if(!Number.isFinite(p.maxCpuPercent)||p.maxCpuPercent<0||p.maxCpuPercent>100)throw Object.assign(new Error('Invalid admission maxCpuPercent'),{code:'ADMISSION_POLICY'});
 if(p.maxMemoryPressureLevel!==1)throw Object.assign(new Error('Admission requires normal native memory pressure (level 1)'),{code:'ADMISSION_POLICY'});
 return p;
}

/** Point-in-time screening inside an already-held worker lease. This is not a
 * GPU reservation or a guarantee about memory pressure after model loading.
 * Timings are admission overhead, never inference token/request accounting.
 */
export async function awaitAdmission({config,workerId,signal,onEvent=()=>{},readTelemetry=readWorkerTelemetry}){
 if(config.admission?.enabled!==true){onEvent('admission.skipped',{workerId,reason:'disabled'});return {enabled:false,admitted:null};}
 const waitId=randomUUID(),started=performance.now();let checks=0,status='blocked',reasons=[],deadline,policy;
 const ctl=new AbortController();let onAbort;
 const combined=signal?AbortSignal.any([signal,ctl.signal]):ctl.signal;
 const interruption=()=>Object.assign(new Error(signal?.aborted?'Capacity admission cancelled':`Capacity admission blocked: ${['admission_wait_deadline',...reasons].join(', ')}`),{code:signal?.aborted?'ADMISSION_CANCELLED':'ADMISSION_BLOCKED',reasons:signal?.aborted?['cancelled']:['admission_wait_deadline',...reasons]});
 const stopped=new Promise((_,reject)=>{onAbort=()=>reject(interruption());combined.addEventListener('abort',onAbort,{once:true});});stopped.catch(()=>{});
 try{
  policy=policyFor(config);
  onEvent('admission.wait.started',{waitId,workerId,maxWaitMs:policy.maxWaitMs,pollMs:policy.pollMs});
  deadline=setTimeout(()=>ctl.abort(),policy.maxWaitMs);
  if(combined.aborted)throw interruption();
  for(;;){
   const checkId=randomUUID(),checkStarted=performance.now();let snapshot,decision;
   try{
    snapshot=await Promise.race([Promise.resolve().then(()=>readTelemetry(config,workerId,{signal:combined,maxAgeMs:policy.maxAgeMs})),stopped]);
    if(performance.now()-started>=policy.maxWaitMs)ctl.abort();
    if(combined.aborted)throw interruption();
    decision=decideAdmission(snapshot,{maxCpuPercent:policy.maxCpuPercent,maxMemoryPressureLevel:policy.maxMemoryPressureLevel,maxAgeMs:policy.maxAgeMs});
    if(snapshot?.workerId!==workerId)decision={...decision,admit:false,reasons:[...decision.reasons,'worker_identity_mismatch']};
   }catch(error){
    decision={admit:false,reasons:combined.aborted?[signal?.aborted?'telemetry_read_cancelled':'telemetry_read_deadline']:['telemetry_read_failed']};
    if(combined.aborted){checks++;onEvent('admission.checked',{waitId,checkId,workerId,admit:false,reasons:decision.reasons,durationMs:performance.now()-checkStarted,telemetryStatus:'unknown'});throw interruption();}
   }
   checks++;reasons=decision.reasons;
   onEvent('admission.checked',{waitId,checkId,workerId,admit:decision.admit,reasons,durationMs:performance.now()-checkStarted,telemetryStatus:snapshot?.status??'unknown',ageMs:snapshot?.ageMs??null,cpuPercent:snapshot?.cpu?.percent??null,nativePressureLevel:snapshot?.memory?.pressure?.level??null});
   if(performance.now()-started>=policy.maxWaitMs)ctl.abort();
   if(combined.aborted)throw interruption();
   if(decision.admit){status='admitted';return {enabled:true,admitted:true,waitId,checks,waitDurationMs:performance.now()-started,decision};}
   await Promise.race([delay(policy.pollMs,undefined,{signal:combined}),stopped]);
  }
 }catch(error){
  const failure=combined.aborted?interruption():error;
  if(failure.code==='ADMISSION_CANCELLED')status='cancelled';else if(failure.code==='ADMISSION_POLICY')status='invalid';
  reasons=failure.reasons??[failure.code??'admission_failed'];throw failure;
 }finally{
  clearTimeout(deadline);combined.removeEventListener('abort',onAbort);
  onEvent('admission.wait.finished',{waitId,workerId,durationMs:performance.now()-started,checks,status,cancelled:status==='cancelled',reasons});
 }
}

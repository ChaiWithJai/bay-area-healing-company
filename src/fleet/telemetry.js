import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { sshFetch,validateWorker } from './ssh.js';
import { collectHostResources } from '../observability/resources.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const percent=n=>finite(n)&&n>=0&&n<=100?n:null;
const bytes=n=>finite(n)&&n>=0?n:null;
const nativeMethod=method=>typeof method==='string'&&method.includes('kern.memorystatus_vm_pressure_level');
const safeWorker=id=>id==='coordinator'||typeof id==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(id)?id:'unknown-worker';
export function normalizeTelemetry(raw,{workerId='coordinator',now=Date.now(),maxAgeMs=15000,source='monitor'}={}) {
 const timestamp=finite(raw?.timestamp)?raw.timestamp:null;
 const total=bytes(raw?.memory?.total),used=bytes(raw?.memory?.used),memoryPercent=percent(raw?.memory?.percent);
 const pageSizeBytes=Number.isInteger(raw?.memory?.pageSizeBytes)&&[4096,16384,65536].includes(raw.memory.pageSizeBytes)?raw.memory.pageSizeBytes:null;
 const pressure=raw?.memory?.pressure;
 const level=[1,2,4].includes(pressure?.level)&&nativeMethod(pressure?.method)?pressure.level:null;
 const invalidMemory=total!==null&&used!==null&&(total===0||used>total)||memoryPercent!==null&&total>0&&used!==null&&Math.abs(memoryPercent-used/total*100)>1;
 const diskTotal=bytes(raw?.disk?.total),diskUsed=bytes(raw?.disk?.used),diskPercent=percent(raw?.disk?.percent);
 const diskBytesValid=diskTotal!==null&&diskTotal>0&&diskUsed!==null&&diskUsed<=diskTotal;
 const diskContradiction=diskTotal!==null&&diskUsed!==null&&(diskTotal===0||diskUsed>diskTotal)||diskBytesValid&&diskPercent!==null&&Math.abs(diskPercent-diskUsed/diskTotal*100)>1;
 const ageMs=timestamp===null?null:now-timestamp;
 const fresh=ageMs!==null&&ageMs>=-1000&&ageMs<=maxAgeMs;
 return {workerId:safeWorker(workerId),source:source==='coordinator'?'coordinator':'monitor',timestamp,observedAt:now,ageMs,fresh,maxAgeMs,
  status:invalidMemory?'invalid':!fresh?'stale':level===null||percent(raw?.cpu?.percent)===null?'unknown':'available',
  cpu:{percent:percent(raw?.cpu?.percent),measurementMethod:source==='coordinator'?'os.cpus aggregate counter delta over bounded sample':'monitor-reported CPU utilization'},
  memory:{total,used,percent:memoryPercent,pageSizeBytes,measurementMethod:'Source bytes retained without page-size conversion',pressure:{level,label:level===null?null:{1:'normal',2:'warning',4:'critical'}[level],method:level===null?null:'kern.memorystatus_vm_pressure_level'}},
  disk:{total:diskTotal,used:diskUsed,percent:diskContradiction?null:diskPercent,consistency:diskContradiction?'inconsistent':diskBytesValid&&diskPercent!==null?'consistent':'unknown'},
  gpu:{utilization:null,capacityKnown:false},capacityLease:false};
}
export function decideAdmission(snapshot,{maxCpuPercent=85,maxMemoryPressureLevel=1,now=Date.now(),maxAgeMs=15000}={}) {
 const reasons=[];
 if(!snapshot||snapshot.status!=='available')reasons.push('telemetry_unavailable_or_invalid');
 if(!finite(snapshot?.timestamp)||now-snapshot.timestamp>maxAgeMs||snapshot.timestamp-now>1000||snapshot?.fresh!==true)reasons.push('telemetry_stale_or_clock_invalid');
 if(!finite(maxCpuPercent)||maxCpuPercent<0||maxCpuPercent>100||!finite(maxMemoryPressureLevel))reasons.push('invalid_admission_threshold');
 const cpu=percent(snapshot?.cpu?.percent);
 if(cpu===null)reasons.push('cpu_unknown');else if(cpu>maxCpuPercent)reasons.push('cpu_busy');
 const pressure=snapshot?.memory?.pressure;
 if(!nativeMethod(pressure?.method)||pressure?.level!==1||pressure.level>maxMemoryPressureLevel)reasons.push('native_memory_pressure_not_normal');
 return {admit:reasons.length===0,reasons,gpuCapacityKnown:false,capacityLease:false,caveat:'Point-in-time CPU/native-memory-pressure screening only; no GPU capacity proof, reservation, or guarantee of future capacity.'};
}
function cpuCounters(){return os.cpus().reduce((out,cpu)=>{out.idle+=cpu.times.idle;out.total+=Object.values(cpu.times).reduce((a,b)=>a+b,0);return out;},{idle:0,total:0});}
export async function readWorkerTelemetry(config,workerId='coordinator',{signal,fetchTelemetry=sshFetch,maxAgeMs=15000}={}) {
 signal?.throwIfAborted();
 try {
  if(workerId==='coordinator'){
   const first=cpuCounters();await delay(150,undefined,{signal});const last=cpuCounters(),delta=last.total-first.total;
   const host=await collectHostResources();signal?.throwIfAborted();
   const total=os.totalmem(),used=total-os.freemem();
   return normalizeTelemetry({timestamp:Date.now(),cpu:{percent:delta>0?100*(1-(last.idle-first.idle)/delta):null},memory:{total,used,percent:used/total*100,pressure:{...host.hostMemoryPressure,method:host.hostMemoryPressureMethod}}},{workerId,source:'coordinator',maxAgeMs});
  }
  const worker=config?.workers?.[workerId];validateWorker(workerId,worker);
  const port=worker.telemetryPort??3000;if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid telemetry port');
  const get=async route=>(await fetchTelemetry(workerId,worker,`http://127.0.0.1:${port}${route}`,{method:'GET',signal,timeoutMs:5000})).json();
  const manifest=await get('/.well-known/agent.json');
  if(manifest?.id!=='local.laptop-context-agent')throw new Error('Unexpected telemetry manifest');
  signal?.throwIfAborted();
  const raw=await get('/api/context');
  return normalizeTelemetry(raw,{workerId,maxAgeMs});
 }catch(error){
  if(signal?.aborted)throw error;
  return {...normalizeTelemetry(null,{workerId,maxAgeMs}),status:'unknown',error:'telemetry_unavailable_or_untrusted'};
 }
}

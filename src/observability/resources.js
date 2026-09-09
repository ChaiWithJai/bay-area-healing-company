import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
const exec=promisify(execFile);

// ps comm contains executable names, not command arguments. Persist only known basenames.
export function parseServerProcesses(stdout) {
  const rows=stdout.split('\n').flatMap(line=>{
    const match=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+?)\s*$/);
    if(!match)return [];
    const name=match[5].endsWith('/.lmstudio/.internal/utils/node')?'lmstudio-runtime-node':path.basename(match[5]);
    const lmstudioRuntime=match[5].endsWith('/.lmstudio/.internal/utils/node');
    return [{pid:Number(match[1]),ppid:Number(match[2]),name,lmstudioRuntime,rssBytes:Number(match[3])*1024,cpuPercent:Number(match[4])}];
  });
  const rootName=/^(ollama(?:_llama_server)?|llmster|llama-server|LM Studio(?: Helper(?: \([\w ]+\))?)?)$/i;
  const selected=new Set(rows.filter(r=>r.lmstudioRuntime||rootName.test(r.name)).map(r=>r.pid));
  let changed=true;
  while(changed) {changed=false;for(const row of rows)if(selected.has(row.ppid)&&!selected.has(row.pid)){selected.add(row.pid);changed=true;}}
  return rows.filter(r=>selected.has(r.pid)).map(({lmstudioRuntime,...r})=>({...r,name:lmstudioRuntime||rootName.test(r.name)?r.name:'inference-descendant',attribution:lmstudioRuntime||rootName.test(r.name)?'known-executable':'descendant-of-known-executable'}));
}
export async function collectHostResources({platform=process.platform,run=exec}={}) {
  const data={serverProcesses:null,serverRssBytes:null,serverCpuPercent:null,
    serverProcessMethod:'ps pid,ppid,rss,pcpu,comm; known inference executables and descendants; descendant names redacted',
    acceleratorAllocationMeasured:false,hostSwapUsedBytes:null,hostMemoryPressure:null,hostMemoryPressureMethod:null};
  const jobs=[(async()=>{
    try {
      const {stdout}=await run('/bin/ps',['-axo','pid=,ppid=,rss=,pcpu=,comm='],{timeout:1000,maxBuffer:1024*1024});
      data.serverProcesses=parseServerProcesses(stdout);
      data.serverRssBytes=data.serverProcesses.reduce((sum,p)=>sum+p.rssBytes,0);
      data.serverCpuPercent=data.serverProcesses.reduce((sum,p)=>sum+p.cpuPercent,0);
    }catch{/* Unknown inventory is null; successful empty inventory has a measured zero sum. */}
  })()];
  if(platform==='darwin') {
    jobs.push((async()=>{try{
      const {stdout}=await run('/usr/sbin/sysctl',['-n','vm.swapusage'],{timeout:1000});
      const match=stdout.match(/used\s*=\s*([\d.]+)([MGK])/);
      if(match)data.hostSwapUsedBytes=Number(match[1])*({K:1024,M:1024**2,G:1024**3}[match[2]]);
    }catch{}})());
    jobs.push((async()=>{try{
      const {stdout}=await run('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level'],{timeout:1000});
      const level=Number(stdout.trim());
      if([1,2,4].includes(level)) {
        data.hostMemoryPressure={level,label:{1:'normal',2:'warning',4:'critical'}[level]};
        data.hostMemoryPressureMethod='macOS kern.memorystatus_vm_pressure_level';
      }
    }catch{}})());
  }
  await Promise.allSettled(jobs);return data;
}
export function startResourceSampler(onSample,{intervalMs=2000}={}) {
  let stopped=false,pending=Promise.resolve(),busy=false,priorCpu=process.cpuUsage(),priorTime=performance.now(),count=0,peak=null,serverPeak=null,lastError=null,stopPromise=null;
  async function sample(phase) {
    const now=performance.now(),cpu=process.cpuUsage();
    const data={at:new Date().toISOString(),phase,processRssBytes:process.memoryUsage().rss,
      processCpuPercent:((cpu.user-priorCpu.user)+(cpu.system-priorCpu.system))/1000/Math.max(1,now-priorTime)*100,
      hostFreeMemoryBytes:os.freemem(),hostTotalMemoryBytes:os.totalmem(),...await collectHostResources()};
    priorCpu=cpu;priorTime=now;
    count++;peak=Math.max(peak??0,data.processRssBytes);
    if(data.serverRssBytes!==null)serverPeak=Math.max(serverPeak??0,data.serverRssBytes);
    await onSample(data);
  }
  const enqueue=phase=>{busy=true;pending=pending.then(()=>sample(phase)).catch(error=>{lastError=error;}).finally(()=>{busy=false;});};
  enqueue('initial');
  const timer=setInterval(()=>{if(!stopped&&!busy)enqueue('interval');},Math.max(1000,intervalMs));timer.unref();
  return {stop(){
    if(stopPromise)return stopPromise;
    stopped=true;clearInterval(timer);
    stopPromise=(async()=>{await pending;enqueue('terminal');await pending;return {sampleCount:count,coordinatorSampledPeakRssBytes:peak,serverSampledPeakRssBytes:serverPeak,sampledPeaksAreLowerBounds:true,acceleratorAllocationMeasured:false,error:lastError?.message??null};})();
    return stopPromise;
  }};
}

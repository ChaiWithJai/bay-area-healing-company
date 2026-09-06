import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateWorker } from '../fleet/ssh.js';
const metricNames=['inputTokens','outputTokens','cachedTokens','durationMs','ttftMs','loadMs','prefillMs','decodeMs'];
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function aggregate(attempts) {
  const metrics=Object.fromEntries(metricNames.map(key=>{
    const values=attempts.map(a=>a[key]).filter(valid);
    return [key,{sum:values.length?values.reduce((a,b)=>a+b,0):null,known:values.length,total:attempts.length,coverage:attempts.length?values.length/attempts.length:null}];
  }));
  return {attempts:attempts.length,successful:attempts.filter(a=>a.success===true&&!a.cancelled).length,
    failed:attempts.filter(a=>a.success===false&&!a.cancelled).length,cancelled:attempts.filter(a=>a.cancelled===true).length,
    unknownOutcome:attempts.filter(a=>typeof a.success!=='boolean'&&!a.cancelled).length,
    incomplete:attempts.filter(a=>a.incomplete===true).length,
    tokensKnown:{input:metrics.inputTokens.sum,output:metrics.outputTokens.sum},metrics};
}
function workerIdentity(attempt) {
  const validLabel=value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
  const legacy=attempt.workerId==null&&attempt.transport==null;
  return {workerId:validLabel(attempt.workerId)?attempt.workerId:legacy?'coordinator':'unknown-worker',
    transport:['loopback','ssh'].includes(attempt.transport)?attempt.transport:legacy?'loopback':'unknown'};
}
function workerResources(attempts) {
  const samples=attempts.flatMap(a=>[a.workerResources?.before,a.workerResources?.after].filter(s=>s&&typeof s==='object'));
  const metric=key=>{const values=samples.map(s=>s[key]).filter(valid);return {peak:values.length?Math.max(...values):null,knownSamples:values.length};};
  const rss=metric('serverRssBytes'),cpu=metric('serverCpuPercent'),swap=metric('hostSwapUsedBytes');
  return {scope:'worker host, before/after request snapshots only; not coordinator samples',sampleCount:samples.length,
    serverSampledPeakRssBytes:rss.peak,serverRssKnownSamples:rss.knownSamples,
    serverSampledPeakCpuPercent:cpu.peak,serverCpuKnownSamples:cpu.knownSamples,
    hostSampledPeakSwapUsedBytes:swap.peak,hostSwapKnownSamples:swap.knownSamples,
    hostMemoryPressureCounts:samples.reduce((out,s)=>{const value=typeof s.hostMemoryPressure==='string'?s.hostMemoryPressure:s.hostMemoryPressure?.label;const label=['normal','warning','critical'].includes(value)?value:'unavailable';out[label]=(out[label]??0)+1;return out;},{}),
    sampledPeaksAreLowerBounds:true,acceleratorAllocationMeasured:false};
}
function runCategory(run) {
  const kind=run.runType??run.kind??run.purpose;
  return kind==='qualification'||/^(qualification|qualify|probe)(?:$|[-_:./])/i.test(run.workflow)?'qualification':kind==='development'?'development':'workflow';
}
function localPolicyEvidence(run) {
  if(run.config?.policy?.localOnly!==true||run.config?.policy?.cloudEnabled!==false)return false;
  const profiles=Object.values(run.config.providers??{}).filter(p=>p.enabled);
  return profiles.length>0&&profiles.every(p=>{
    try {if(p.workerId!=null)validateWorker(p.workerId,run.config.workers?.[p.workerId]);const u=new URL(p.baseUrl);return p.kind==='local'&&['ollama','lmstudio'].includes(p.adapter)&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&!/cloud|https?:\/\//i.test(p.model??'');}catch{return false;}
  });
}
export function summarizeUsage(store,{runId}={}) {
  const runs=runId?[store.getRun(runId)].filter(Boolean):store.listRuns();
  if(runId&&!runs.length) throw new Error(`Unknown run: ${runId}`);
  const events=runs.flatMap(r=>store.events(r.id).map(e=>({...e,workflow:r.workflow,category:runCategory(r)})));
  const attemptMap=new Map();
  const attemptKey=e=>JSON.stringify([e.runId,e.data.attemptId??e.id]);
  for(const e of events.filter(e=>e.type==='model.request.started')) {
    const key=attemptKey(e);
    if(!attemptMap.has(key))attemptMap.set(key,{...e.data,...Object.fromEntries(metricNames.map(k=>[k,null])),success:null,cancelled:false,incomplete:true,runId:e.runId,workflow:e.workflow,category:e.category});
  }
  for(const e of events.filter(e=>e.type==='model.request.finished')) {
    const key=attemptKey(e);
    attemptMap.set(key,{...attemptMap.get(key),...e.data,incomplete:false,runId:e.runId,workflow:e.workflow,category:e.category});
  }
  const attempts=[...attemptMap.values()].map(a=>({...a,...workerIdentity(a)}));
  const byWorker=Object.fromEntries([...new Set(attempts.map(a=>a.workerId))].map(workerId=>{const selected=attempts.filter(a=>a.workerId===workerId);return [workerId,{workerId,...aggregate(selected),byTransport:Object.fromEntries([...new Set(selected.map(a=>a.transport))].map(transport=>[transport,{transport,...aggregate(selected.filter(a=>a.transport===transport)),resources:workerResources(selected.filter(a=>a.transport===transport))}])),resources:workerResources(selected)}];}));
  const group=key=>Object.fromEntries([...new Set(attempts.map(a=>a[key]??'unknown'))].map(name=>[name,aggregate(attempts.filter(a=>(a[key]??'unknown')===name))]));
  const workflowRuns=runs.filter(r=>runCategory(r)==='workflow');
  const workflowAttempts=attempts.filter(a=>a.category==='workflow');
  const workflowUsage=aggregate(workflowAttempts);
  const accepted=workflowRuns.filter(r=>r.status==='completed'&&r.result?.reviewRequired!==true).length;
  const total=aggregate(attempts);
  const resources=events.filter(e=>e.type==='resource.sample').map(e=>e.data);
  const peaks=key=>{const values=resources.map(s=>s[key]).filter(valid);return values.length?Math.max(...values):null;};
  return {schemaVersion:1,runCount:runs.length,acceptedRuns:accepted,workflowRunCount:workflowRuns.length,qualification:{runCount:runs.filter(r=>runCategory(r)==='qualification').length,...aggregate(attempts.filter(a=>a.category==='qualification'))},runtimePolicy:{localOnlySubstantiated:runs.length>0&&runs.every(localPolicyEvidence),substantiatedRunCount:runs.filter(localPolicyEvidence).length,evidence:'Saved local-only configuration: loopback inference on the coordinator or configured SSH-to-private-LAN workers validated against worker settings; not a connectivity test, network capture, or billing measurement',paidRuntimeApiConfigured:runs.length>0&&runs.every(localPolicyEvidence)?false:null},
    runStatuses:Object.fromEntries([...new Set(runs.map(r=>r.status))].map(s=>[s,runs.filter(r=>r.status===s).length])),
    ...total,byWorker,byTransport:group('transport'),byModel:group('model'),byProfile:group('profile'),byWorkflow:group('workflow'),
    perAcceptedRun:{attempts:accepted?workflowAttempts.length/accepted:null,knownInferenceDurationMs:accepted&&workflowUsage.metrics.durationMs.sum!==null?workflowUsage.metrics.durationMs.sum/accepted:null},
    resources:{scope:'coordinator host only; excludes SSH worker hosts',workerId:'coordinator',sampleCount:resources.length,coordinatorSampledPeakRssBytes:peaks('processRssBytes'),serverSampledPeakRssBytes:peaks('serverRssBytes'),serverSampledPeakCpuPercent:peaks('serverCpuPercent'),serverInventoryKnownSamples:resources.filter(s=>Array.isArray(s.serverProcesses)).length,hostSampledPeakSwapUsedBytes:peaks('hostSwapUsedBytes'),hostMemoryPressureCounts:resources.reduce((acc,s)=>{const label=s.hostMemoryPressure?.label??'unavailable';acc[label]=(acc[label]??0)+1;return acc;},{}),acceleratorAllocationMeasured:false,sampledPeaksAreLowerBounds:true},
    development:{eventCount:events.filter(e=>e.type.startsWith('development.')).length,attribution:'Separate from runtime; shared account usage cannot establish build-specific consumption.'},
    energyKwh:null,costs:{paidInferenceApiDollars:null,electricityDollars:null,hardwareAmortizationDollars:null,laborDollars:null},
    caveats:['Missing metrics are unknown, not zero. Token sums include only reported counts; consult coverage. Started requests without a terminal event count once as incomplete with unknown outcome and metrics; these may be in flight or interrupted, not proven failures.','All workflow inference attempts, including failures and repairs, contribute to per-accepted-workflow accounting; qualification and development runs are excluded from that numerator and denominator.','Completed workflow deliverables without reviewRequired supply the accepted denominator; workflow validators must establish completion. Qualification successes are not delivered workflows.','Coordinator and known inference-server RSS are separate; server trees include helper overhead and may miss detached/reparented backends; RSS sums may double-count shared pages and exclude compressed or accelerator allocations. Accelerator allocation is not measured. Host metrics cover unrelated applications too. Server CPU is ps-reported and may be averaged over process lifetime.','Local-only means configured local model runtimes, including SSH-to-private-LAN workers; it does not mean every inference runs on the coordinator. Worker configuration validation is not proof of connectivity or execution. Worker IDs are configured labels, not SSH addresses. Legacy attempts with no worker metadata default to coordinator/loopback; explicit invalid or missing worker identity on SSH remains unknown. Worker snapshots do not measure transfer overhead separately, may miss runtime peaks, and are never substituted with coordinator measurements.','No currency or energy values are inferred from token counts or subscription usage.']};
}
const csvCell=v=>`"${String(v??'').replaceAll('"','""')}"`;
export async function exportReport(store,runId,outputDir) {
  const run=store.getRun(runId); if(!run) throw new Error(`Unknown run: ${runId}`);
  const usage=summarizeUsage(store,{runId});
  // Explicit allowlist: no source paths, inputs, configuration, free-text failures, or model content.
  const provenance=Object.fromEntries(['node','platform','arch','cpu','totalMemoryBytes','appVersion','sourceCodeDigest','commit','fixtureVersion','routingVersion'].filter(k=>run.provenance?.[k]!==undefined).map(k=>[k,run.provenance[k]]));
  const workerMetadata=Object.values(usage.byWorker).flatMap(w=>Object.keys(w.byTransport).map(transport=>({workerId:w.workerId,transport})));
  const report={workers:workerMetadata,schemaVersion:1,exportedAt:new Date().toISOString(),run:{id:run.id,workflow:run.workflow,status:run.status,createdAt:run.createdAt,updatedAt:run.updatedAt,provenance},usage};
  await mkdir(outputDir,{recursive:true});
  const rows=[['model','attempts','successful','failed','cancelled','unknown_outcome','incomplete','input_tokens_known','output_tokens_known','input_coverage','output_coverage','duration_ms_known']];
  for(const [model,u] of Object.entries(usage.byModel)) rows.push([model,u.attempts,u.successful,u.failed,u.cancelled,u.unknownOutcome,u.incomplete,u.tokensKnown.input,u.tokensKnown.output,u.metrics.inputTokens.coverage,u.metrics.outputTokens.coverage,u.metrics.durationMs.sum]);
  const workerRows=[['worker_id','transport','attempts','successful','failed','cancelled','unknown_outcome','incomplete','input_tokens_known','output_tokens_known','input_coverage','output_coverage','duration_ms_known','worker_sample_count','worker_server_peak_rss_bytes']];
  for(const worker of Object.values(usage.byWorker))for(const [transport,u] of Object.entries(worker.byTransport))workerRows.push([worker.workerId,transport,u.attempts,u.successful,u.failed,u.cancelled,u.unknownOutcome,u.incomplete,u.tokensKnown.input,u.tokensKnown.output,u.metrics.inputTokens.coverage,u.metrics.outputTokens.coverage,u.metrics.durationMs.sum,u.resources.sampleCount,u.resources.serverSampledPeakRssBytes]);
  await writeFile(join(outputDir,'workers.csv'),workerRows.map(r=>r.map(csvCell).join(',')).join('\n')+'\n',{mode:0o600});
  await writeFile(join(outputDir,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await writeFile(join(outputDir,'usage.csv'),rows.map(r=>r.map(csvCell).join(',')).join('\n')+'\n',{mode:0o600});
  await writeFile(join(outputDir,'report.md'),`# Workflow evidence report\n\nRun: ${run.id}\n\nWorkflow: ${run.workflow}\n\nStatus: ${run.status}\n\nInference attempts: ${usage.attempts}; successful: ${usage.successful}; failed: ${usage.failed}; cancelled: ${usage.cancelled}; unknown outcome: ${usage.unknownOutcome}; incomplete: ${usage.incomplete}.\n\nReported input/output tokens: ${usage.tokensKnown.input??'unavailable'} / ${usage.tokensKnown.output??'unavailable'}.\n\nSampled coordinator host process/server peak RSS bytes: ${usage.resources.coordinatorSampledPeakRssBytes??'unavailable'} / ${usage.resources.serverSampledPeakRssBytes??'unavailable'}. Samples: ${usage.resources.sampleCount}. Accelerator allocation is not measured.\n\nLocal-only configuration substantiated: ${usage.runtimePolicy.localOnlySubstantiated}. Paid runtime API configured: ${usage.runtimePolicy.paidRuntimeApiConfigured??'unknown'}. This is configuration evidence, not billing measurement.\n\nWorkers: ${workerMetadata.map(w=>w.workerId+' ('+w.transport+')').join(', ')||'none observed'}. Per-worker accounting and snapshot coverage are in report.json and workers.csv. Remote measurements are unavailable unless recorded in worker snapshots.\n\nEnergy and monetary cost: unavailable.\n\n${usage.caveats.map(c=>'- '+c).join('\n')}\n\nThis export excludes raw model content, source documents, configuration, and event payloads. Local SQLite records remain available for inspection.\n`,{mode:0o600});
  return {workersCsv:join(outputDir,'workers.csv'),json:join(outputDir,'report.json'),csv:join(outputDir,'usage.csv'),markdown:join(outputDir,'report.md')};
}

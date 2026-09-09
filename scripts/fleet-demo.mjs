// Real, opt-in two-worker verification. This command performs local inference.
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig, ROOT } from '../src/config.js';
import { runWorkflow } from '../src/engine/runner.js';
import { findWorkflow } from '../src/workflows/registry.js';
import { gradeArtifacts } from '../src/evaluation/index.js';
import { RunStore, summarizeUsage } from '../src/observability/index.js';
import { sourceCodeDigest } from '../src/provenance.js';

const {values}=parseArgs({options:{local:{type:'string',default:'bonsai8'},remote:{type:'string',default:'mac48-qwen7'},task:{type:'string',default:'case_note_normalization-01'},out:{type:'string',default:'.wm/two-mac-concurrency.json'}}});
const config=await loadConfig();
if(config.admission?.enabled!==true)throw new Error('Enable config.admission.enabled before this real fleet demonstration');
if(config.providers[values.local]?.workerId||!config.providers[values.remote]?.workerId)throw new Error('Choose one coordinator profile and one remote worker profile');
const catalog=JSON.parse(await readFile(path.join(ROOT,'fixtures/catalog.json'),'utf8'));
const task=catalog.find(t=>t.id===values.task);if(!task)throw new Error('Unknown task');
const spec=await findWorkflow(config.workflowsDir,task.workflow_id);
// Disable fallback so worker attribution cannot silently change during comparison.
const frozen={...config,routing:{...config.routing,alternatives:[]}};
const digest=await sourceCodeDigest(),startedAt=new Date().toISOString();
const controller=new AbortController();
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>controller.abort(new Error('User cancelled fleet demonstration')));
const settled=await Promise.allSettled([values.local,values.remote].map(profile=>runWorkflow({spec,config:frozen,providerName:profile,signal:controller.signal,inputDir:path.join(ROOT,'fixtures/tasks',task.id,'inputs'),onProgress:e=>console.error(JSON.stringify(e))})));
const reference=JSON.parse(await readFile(path.join(ROOT,'fixtures/tasks',task.id,'reference.json'),'utf8'));
const store=new RunStore(config.stateDir),runs=[];
try {
 for(let i=0;i<settled.length;i++){
  const s=settled[i],result=s.status==='fulfilled'?s.value:null,runId=result?.runId??s.reason?.runId;
  const events=runId?store.events(runId):[],starts=events.filter(e=>e.type==='model.request.started');
  const intervals=starts.map(e=>{const end=events.find(f=>f.type==='model.request.finished'&&f.data.attemptId===e.data.attemptId);return {attemptId:e.data.attemptId,workerId:e.data.workerId,start:e.at,end:end?.at??null,success:end?.data.success??null};});
  runs.push({profile:[values.local,values.remote][i],runId,status:result?.status??'error',error:s.status==='rejected'?String(s.reason?.message):null,reference:result?await gradeArtifacts({task,reference,result,config:frozen}):null,usage:runId?summarizeUsage(store,{runId}):null,admission:events.filter(e=>e.type.startsWith('admission.')).map(({type,at,data})=>({type,at,data})),intervals});
 }
}finally{store.close();}
let overlapMs=0,overlappingPairs=0;
for(const a of runs[0].intervals)for(const b of runs[1].intervals){
 if(!a.end||!b.end||!a.success||!b.success)continue;
 const overlap=Math.max(0,Math.min(Date.parse(a.end),Date.parse(b.end))-Math.max(Date.parse(a.start),Date.parse(b.start)));
 if(overlap>0){overlapMs+=overlap;overlappingPairs++;}
}
const unchanged=digest===await sourceCodeDigest();
const report={version:1,startedAt,finishedAt:new Date().toISOString(),sourceCodeDigest:digest,sourceUnchanged:unchanged,configDigest:createHash('sha256').update(JSON.stringify(frozen)).digest('hex'),taskId:task.id,fixtureType:'synthetic generated_unreviewed',runs,overlapMs,overlappingPairs,passed:unchanged&&runs.every(r=>r.reference?.passed)&&overlapMs>0,claim:'Successful request intervals overlap across two workers. This establishes concurrent requests with measured runtime usage, not GPU utilization or production reliability.'};
await mkdir(path.dirname(values.out),{recursive:true});await writeFile(values.out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:values.out,passed:report.passed,overlapMs,runs:runs.map(({profile,runId,status,reference})=>({profile,runId,status,referencePassed:reference?.passed}))},null,2));
if(!report.passed)process.exitCode=2;

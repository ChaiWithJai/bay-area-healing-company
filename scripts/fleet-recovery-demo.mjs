// Controlled failure + checkpoint recovery using real local inference.
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig,ROOT } from '../src/config.js';
import { findWorkflow } from '../src/workflows/registry.js';
import { runWorkflow } from '../src/engine/runner.js';
import { gradeArtifacts } from '../src/evaluation/index.js';
import { RunStore,summarizeUsage } from '../src/observability/index.js';
import { sourceCodeDigest } from '../src/provenance.js';
const config=await loadConfig();
if(!config.admission?.enabled)throw new Error('Capacity admission must be enabled');
const [profile='mac48-qwen7',out='.wm/fleet-recovery.json']=process.argv.slice(2);
if(!config.providers[profile]?.workerId)throw new Error('Select a configured remote profile');
const catalog=JSON.parse(await readFile(path.join(ROOT,'fixtures/catalog.json'),'utf8'));
const digest=await sourceCodeDigest();
async function task(id){const card=catalog.find(t=>t.id===id);return {card,spec:await findWorkflow(config.workflowsDir,card.workflow_id),inputDir:path.join(ROOT,'fixtures/tasks',id,'inputs')};}
async function grade(t,result,c){const reference=JSON.parse(await readFile(path.join(ROOT,'fixtures/tasks',t.card.id,'reference.json'),'utf8'));return gradeArtifacts({task:t.card,reference,result,config:c});}
const t=await task('case_note_normalization-01'),ctl=new AbortController();let accepted=0,interrupted;
const frozen={...config,routing:{...config.routing,alternatives:[]}};
try {await runWorkflow({spec:t.spec,inputDir:t.inputDir,config:frozen,providerName:profile,signal:ctl.signal,onProgress:e=>{if(e.status==='accepted'&&++accepted===3)ctl.abort(new Error('Controlled checkpoint cancellation after three settled requests'));}});}
catch(error){if(!ctl.signal.aborted)throw error;interrupted=error.runId;}
if(!interrupted)throw new Error('Controlled cancellation did not produce a resumable run');
const beforeStore=new RunStore(config.stateDir);let before;
try{before={status:beforeStore.getRun(interrupted).status,steps:beforeStore.getSteps(interrupted).filter(s=>s.status==='accepted').map(s=>({stepId:s.stepId,attemptId:s.attemptId})),usage:summarizeUsage(beforeStore,{runId:interrupted})};}finally{beforeStore.close();}
const resumed=await runWorkflow({spec:t.spec,inputDir:t.inputDir,config:frozen,providerName:profile,runId:interrupted});
const resumedGrade=await grade(t,resumed,frozen);
// A deliberately absent model tests authenticated remote failure and local fallback.
// It is never installed or downloaded by this command.
const faultConfig={...config,defaultProvider:'fault-missing-model',providers:{...config.providers,'fault-missing-model':{...config.providers[profile],model:'workflow-manager-intentionally-absent-model:never-install'}},routing:{...config.routing,families:{},alternatives:['bonsai8'],maxRepairs:0}};
const f=await task('volunteer_hours_reconciliation-01');
const fallback=await runWorkflow({spec:f.spec,inputDir:f.inputDir,config:faultConfig});
const fallbackGrade=await grade(f,fallback,faultConfig);
const store=new RunStore(config.stateDir);let report;
try {
 const events=store.events(interrupted),steps=store.getSteps(interrupted),faultEvents=store.events(fallback.runId);
 const reused=events.filter(e=>e.type==='step.reused').map(e=>e.data.stepId);
 const checkpointPreserved=before.steps.length===3&&before.steps.every(s=>reused.includes(s.stepId)&&steps.find(a=>a.stepId===s.stepId)?.attemptId===s.attemptId);
 const requests=events.filter(e=>e.type==='model.request.started');
 const noDuplicateAcceptedRequests=before.steps.every(s=>requests.filter(e=>e.data.stepId===s.stepId).length===1);
 const failedRemote=faultEvents.some(e=>e.type==='model.request.finished'&&e.data.profile==='fault-missing-model'&&e.data.success===false);
 const acceptedLocal=faultEvents.some(e=>e.type==='step.accepted'&&e.data.profile==='bonsai8');
 report={version:1,sourceCodeDigest:digest,sourceUnchanged:digest===await sourceCodeDigest(),fixtureType:'synthetic generated_unreviewed',cancellation:{runId:interrupted,statusBeforeResume:before.status,acceptedBeforeResume:before.steps.length,checkpointPreserved,noDuplicateAcceptedRequests,reference:resumedGrade,usageBeforeResume:before.usage,usageAfterResume:summarizeUsage(store,{runId:interrupted}),scope:'Graceful cancellation at an accepted-step boundary after the provider settled; does not establish recovery from an orphaned backend request.'},fallback:{runId:fallback.runId,fault:'Intentionally absent remote model; no download',failedRemote,acceptedLocal,reference:fallbackGrade,usage:summarizeUsage(store,{runId:fallback.runId})}};
 report.passed=report.sourceUnchanged&&before.status==='cancelled'&&checkpointPreserved&&noDuplicateAcceptedRequests&&resumedGrade.passed&&failedRemote&&acceptedLocal&&fallbackGrade.passed;
}finally{store.close();}
await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:out,passed:report.passed,cancellationRun:interrupted,fallbackRun:fallback.runId},null,2));if(!report.passed)process.exitCode=2;

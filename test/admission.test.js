import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {awaitAdmission} from '../src/fleet/admission.js';
import {normalizeTelemetry} from '../src/fleet/telemetry.js';
import {runWorkflow} from '../src/engine/runner.js';
import {accountedProbe} from '../src/providers/probe.js';
import {CoordinatorLeases} from '../src/fleet/leases.js';
import {RunStore,summarizeUsage} from '../src/observability/index.js';
import {DEFAULT_CONFIG} from '../src/config.js';
const admission={enabled:true,maxWaitMs:40,pollMs:5,maxAgeMs:15000,maxCpuPercent:85,maxMemoryPressureLevel:1};
function snapshot(workerId,{cpu=10,level=1,age=0}={}){return normalizeTelemetry({timestamp:Date.now()-age,cpu:{percent:cpu},memory:{total:100,used:40,percent:40,pressure:{level,method:'kern.memorystatus_vm_pressure_level'}}},{workerId});}
async function setup(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'wm-admission-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config={...structuredClone(DEFAULT_CONFIG),admission:{...admission},stateDir:path.join(root,'state'),outputDir:path.join(root,'out'),routing:{alternatives:['beta'],families:{},maxRepairs:1}};
 config.providers.alpha={...config.providers.bonsai8,workerId:'mac48'};config.providers.beta={...config.providers.bonsai8,workerId:'gb10'};
 const schema={type:'object',required:['quote','reason'],properties:{quote:{type:'string'},reason:{type:'string'}},additionalProperties:false};
 const item={id:'evidence',family:'board_evidence',system:'Extract',prompt:'Source verified.',sourceText:'Source verified.',schema};
 const spec={...JSON.parse(await readFile(new URL('../workflows/nonprofit.board_report_synthesis.json',import.meta.url),'utf8')),deliverable:['report.md']};
 const calls=[];
 return {root,inputDir:root,config,spec,providerName:'alpha',calls,
  prepare:async()=>({items:[item],context:{items:[item]},inputManifest:[{id:'source',sha256:'fixed'}]}),
  finalize:async(_id,_context,_results,out)=>{await mkdir(out,{recursive:true});await writeFile(path.join(out,'report.md'),'Controlled artifact');return {artifacts:[],gates:[{id:'domain',pass:true}],reviewRequired:false,score:1};},
  providerFactory:(_c,name)=>({generate:async()=>{calls.push(name);return {text:JSON.stringify({quote:'Source verified.',reason:'Source'}),metrics:{inputTokens:2,outputTokens:3,durationMs:1}};}})};
}
test('disabled admission neither reads telemetry nor claims capacity',async()=>{let reads=0;const events=[];const r=await awaitAdmission({config:{},workerId:'coordinator',readTelemetry:async()=>{reads++;},onEvent:(type,data)=>events.push({type,data})});assert.equal(reads,0);assert.equal(r.admitted,null);assert.equal(events[0].type,'admission.skipped');});
test('busy telemetry can recover within the bounded admission wait',async()=>{let reads=0;const events=[];const r=await awaitAdmission({config:{admission},workerId:'mac48',readTelemetry:async()=>snapshot('mac48',{cpu:++reads===1?99:10}),onEvent:(type,data)=>events.push({type,data})});assert.equal(r.admitted,true);assert.equal(reads,2);assert.deepEqual(events.filter(e=>e.type==='admission.checked').map(e=>e.data.admit),[false,true]);assert.equal(events.at(-1).data.status,'admitted');});
test('stale and non-normal native pressure remain fail-closed',async()=>{for(const patch of [{age:60000},{level:2},{level:null}]){const events=[];await assert.rejects(awaitAdmission({config:{admission},workerId:'mac48',readTelemetry:async()=>snapshot('mac48',patch),onEvent:(type,data)=>events.push({type,data})}),{code:'ADMISSION_BLOCKED'});assert.ok(events.filter(e=>e.type==='admission.checked').every(e=>!e.data.admit));assert.equal(events.at(-1).data.status,'blocked');}});
test('hanging telemetry respects deadline and caller cancellation',async()=>{const never=async()=>new Promise(()=>{});const start=performance.now();await assert.rejects(awaitAdmission({config:{admission},workerId:'mac48',readTelemetry:never}),{code:'ADMISSION_BLOCKED'});assert.ok(performance.now()-start<1000);const ctl=new AbortController();const pending=awaitAdmission({config:{admission:{...admission,maxWaitMs:1000}},workerId:'mac48',signal:ctl.signal,readTelemetry:never});setTimeout(()=>ctl.abort(),10);await assert.rejects(pending,{code:'ADMISSION_CANCELLED'});});
test('capacity fallback selects another worker with no fake denied-profile inference',async t=>{
 const args=await setup(t);let underLease=0;
 const result=await runWorkflow({...args,readTelemetry:async(_c,id)=>{const leases=new CoordinatorLeases(path.join(args.config.stateDir,'coordinator-leases.sqlite'));assert.ok(leases.inspect('worker:'+id));leases.close();underLease++;return snapshot(id,{cpu:id==='mac48'?99:10});}});
 assert.equal(result.passed,true);assert.deepEqual(args.calls,['beta']);assert.ok(underLease>=2);
 const store=new RunStore(args.config.stateDir),events=store.events(result.runId),usage=summarizeUsage(store,{runId:result.runId});
 assert.equal(events.filter(e=>e.type==='routing.capacity_blocked').length,1);assert.equal(events.filter(e=>e.type==='model.request.started').length,1);assert.equal(usage.attempts,1);assert.equal(usage.tokensKnown.input,2);assert.ok(events.findIndex(e=>e.type==='admission.wait.finished'&&e.data.status==='admitted')<events.findIndex(e=>e.type==='model.request.started'));store.close();
});
test('same denied worker is not retried as another profile or model repair',async t=>{
 const args=await setup(t);args.config.providers.beta.workerId='mac48';const result=await runWorkflow({...args,readTelemetry:async(_c,id)=>snapshot(id,{cpu:99})});assert.equal(result.passed,false);assert.deepEqual(args.calls,[]);
 const store=new RunStore(args.config.stateDir),events=store.events(result.runId);assert.equal(events.filter(e=>e.type==='admission.wait.started').length,1);assert.equal(events.filter(e=>e.type==='routing.capacity_skipped').length,1);assert.equal(events.filter(e=>e.type.startsWith('model.request.')).length,0);assert.equal(summarizeUsage(store,{runId:result.runId}).tokensKnown.input,null);store.close();
});
test('invalid admission configuration fails hard before fallback or telemetry',async t=>{
 const args=await setup(t);args.config.admission.maxWaitMs=0;let reads=0,id;await assert.rejects(runWorkflow({...args,readTelemetry:async()=>{reads++;}}),error=>{id=error.runId;return error.code==='ADMISSION_POLICY';});assert.equal(reads,0);assert.deepEqual(args.calls,[]);const store=new RunStore(args.config.stateDir);assert.equal(store.getRun(id).status,'blocked');assert.equal(store.events(id).filter(e=>e.type==='model.request.started').length,0);store.close();
});
test('qualification admission blocks separately from model usage and releases leases',async t=>{
 const args=await setup(t);let calls=0,id;
 await assert.rejects(accountedProbe(args.config,'alpha',async()=>{calls++;return {text:'{"ok":true}',metrics:{}};},{readTelemetry:async(_c,workerId)=>snapshot(workerId,{level:4})}),error=>{id=error.runId;return error.code==='ADMISSION_BLOCKED';});assert.equal(calls,0);
 const store=new RunStore(args.config.stateDir);assert.equal(store.getRun(id).status,'blocked');assert.equal(store.events(id).filter(e=>e.type==='model.request.started').length,0);assert.equal(store.events(id).filter(e=>e.type==='admission.wait.finished')[0].data.status,'blocked');store.close();
 const leases=new CoordinatorLeases(path.join(args.config.stateDir,'coordinator-leases.sqlite'));assert.equal(leases.inspect('worker:mac48'),null);assert.equal(leases.inspect('run:'+id),null);leases.close();
});

test('elapsed deadline cannot be bypassed by a reader delaying timer callbacks',async()=>{
 await assert.rejects(awaitAdmission({config:{admission:{...admission,maxWaitMs:10}},workerId:'mac48',readTelemetry:()=>{const until=performance.now()+20;while(performance.now()<until){}return snapshot('mac48');}}),{code:'ADMISSION_BLOCKED'});
});

test('uncertain model stream quarantines worker and falls back past same-worker profile',async t=>{
 const args=await setup(t);args.config.admission.enabled=false;
 args.config.providers.same={...args.config.providers.alpha};args.config.routing.alternatives=['same','beta'];let betaPrompt;
 args.providerFactory=(_c,name)=>({generate:async({prompt})=>{args.calls.push(name);if(name==='alpha')throw Object.assign(new Error('stream interrupted'),{metrics:{workerIdleUncertain:true,inputTokens:null,outputTokens:null}});betaPrompt=prompt;return {text:JSON.stringify({quote:'Source verified.',reason:'Source'}),metrics:{inputTokens:2,outputTokens:3}};}});
 const result=await runWorkflow(args);assert.equal(result.passed,true);assert.deepEqual(args.calls,['alpha','beta']);
 const leases=new CoordinatorLeases(path.join(args.config.stateDir,'coordinator-leases.sqlite'));assert.ok(leases.inspectQuarantine('mac48'));assert.equal(leases.inspect('worker:mac48'),null);leases.close();
 args.calls.length=0;const rerun=await runWorkflow(args);assert.equal(rerun.passed,true);assert.deepEqual(args.calls,['beta']);
});
test('capacity failure does not fabricate response feedback for healthy fallback',async t=>{
 const args=await setup(t);args.config.providers.same={...args.config.providers.alpha};args.config.routing.alternatives=['same','beta'];let prompt;
 args.providerFactory=()=>({generate:async(request)=>{prompt=request.prompt;return {text:JSON.stringify({quote:'Source verified.',reason:'Source'}),metrics:{}};}});
 const result=await runWorkflow({...args,readTelemetry:async(_c,id)=>snapshot(id,{cpu:id==='mac48'?99:10})});assert.equal(result.passed,true);assert.equal(prompt,'Source verified.');
});
test('uncertain qualification quarantines before release and blocks the next probe',async t=>{
 const args=await setup(t);args.config.admission.enabled=false;let calls=0;
 const probe=async()=>{calls++;throw Object.assign(new Error('stream interrupted'),{metrics:{workerIdleUncertain:true}});};
 await assert.rejects(accountedProbe(args.config,'alpha',probe),/stream interrupted/);
 await assert.rejects(accountedProbe(args.config,'alpha',probe),{code:'WORKER_QUARANTINED'});assert.equal(calls,1);
});

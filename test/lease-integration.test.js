import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DEFAULT_CONFIG} from '../src/config.js';
import {RunStore} from '../src/observability/index.js';
import {runWorkflow} from '../src/engine/runner.js';
import {accountedProbe} from '../src/providers/probe.js';
import {CoordinatorLeases} from '../src/fleet/leases.js';
const answer={quote:'Source verified.',reason:'Source statement'};
const schema={type:'object',additionalProperties:false,required:['quote','reason'],properties:{quote:{type:'string'},reason:{type:'string'}}};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function latch(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function setup(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'wm-lease-integration-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config={...structuredClone(DEFAULT_CONFIG),stateDir:path.join(root,'state'),outputDir:path.join(root,'out'),routing:{alternatives:[],families:{},maxRepairs:0}};
 config.providers.alpha={...config.providers.bonsai8,workerId:'mac48'};config.providers.beta={...config.providers.bonsai8,workerId:'gb10'};
 const item={id:'evidence-1',family:'board_evidence',system:'extract',prompt:'Source verified.',sourceText:'Source verified.',schema};
 const plan={inputManifest:[{id:'source',sha256:'version-one'}],items:[item],context:{items:[item]}};
 const original=JSON.parse(await readFile(new URL('../workflows/nonprofit.board_report_synthesis.json',import.meta.url),'utf8'));
 const spec={...original,deliverable:['report.md']};
 const prepare=async()=>structuredClone(plan);
 const finalize=async(_id,_context,_results,output)=>{await mkdir(output,{recursive:true});await writeFile(path.join(output,'report.md'),'Accepted evidence');return {artifacts:[],gates:[{id:'domain',pass:true}],reviewRequired:false,score:1,summary:'Controlled prototype test'};};
 const providerFactory=()=>({generate:async()=>({text:JSON.stringify(answer),metrics:{inputTokens:10,outputTokens:10,durationMs:0}})});
 return {root,inputDir:root,config,plan,spec,prepare,finalize,providerFactory};
}

test('distinct workers execute different workflow requests concurrently',async t=>{
 const args=await setup(t);let active=0,max=0;
 const providerFactory=()=>({generate:async()=>{active++;max=Math.max(max,active);await delay(100);active--;return {text:JSON.stringify(answer),metrics:{durationMs:100}};}});
 const results=await Promise.all(['alpha','beta'].map(providerName=>runWorkflow({...args,providerName,providerFactory})));
 assert.ok(results.every(r=>r.passed));assert.equal(max,2);
 const store=new RunStore(args.config.stateDir);for(const result of results){const events=store.events(result.runId);assert.ok(events.some(e=>e.type==='lease.acquired'&&e.data.scope==='worker'));assert.ok(events.findIndex(e=>e.type==='model.request.finished')<events.findIndex(e=>e.type==='lease.released'&&e.data.scope==='worker'));}store.close();
});
test('different profiles on the same worker serialize',async t=>{
 const args=await setup(t);args.config.providers.beta.workerId='mac48';let active=0,max=0;
 const providerFactory=()=>({generate:async()=>{active++;max=Math.max(max,active);await delay(80);active--;return {text:JSON.stringify(answer),metrics:{durationMs:80}};}});
 const results=await Promise.all(['alpha','beta'].map(providerName=>runWorkflow({...args,providerName,providerFactory})));
 assert.ok(results.every(r=>r.passed));assert.equal(max,1);
 const store=new RunStore(args.config.stateDir);const waits=results.flatMap(r=>store.events(r.runId)).filter(e=>e.type==='lease.acquired'&&e.data.scope==='worker').map(e=>e.data.waitDurationMs);assert.ok(waits.some(ms=>ms>=50));store.close();
});
test('second claimant for same run rejects without mutating active state',async t=>{
 const args=await setup(t),entered=latch(),finish=latch(),id='same-run';
 const first=runWorkflow({...args,runId:id,providerName:'alpha',providerFactory:()=>({generate:async()=>{entered.resolve();await finish.promise;return {text:JSON.stringify(answer),metrics:{}};}})});
 await entered.promise;const store=new RunStore(args.config.stateDir),before=store.getRun(id);
 await assert.rejects(runWorkflow({...args,runId:id,providerName:'alpha'}),/active for run/);assert.deepEqual(store.getRun(id),before);finish.resolve();assert.equal((await first).passed,true);store.close();
});
test('resume retains accepted checkpoint after rendering interruption',async t=>{
 const args=await setup(t);let calls=0,id;
 const providerFactory=()=>({generate:async()=>{calls++;return {text:JSON.stringify(answer),metrics:{}};}});
 try{await runWorkflow({...args,providerName:'alpha',providerFactory,finalize:async()=>{throw new Error('render interrupted');}});}catch(error){id=error.runId;}
 assert.ok(id);const result=await runWorkflow({...args,providerName:'alpha',providerFactory,runId:id});assert.equal(result.passed,true);assert.equal(calls,1);
 const leases=new CoordinatorLeases(path.join(args.config.stateDir,'coordinator-leases.sqlite'));assert.equal(leases.inspect('run:'+id),null);assert.equal(leases.inspect('worker:mac48'),null);leases.close();
});
test('aborted worker waiter records no inference attempt and preserves the active owner',async t=>{
 const args=await setup(t),entered=latch(),finish=latch(),ctl=new AbortController();
 const first=runWorkflow({...args,providerName:'alpha',providerFactory:()=>({generate:async()=>{entered.resolve();await finish.promise;return {text:JSON.stringify(answer),metrics:{}};}})});
 await entered.promise;const second=runWorkflow({...args,runId:'waiting-run',providerName:'alpha',signal:ctl.signal});await delay(25);ctl.abort(new Error('cancel test'));await assert.rejects(second,/cancel/);
 const store=new RunStore(args.config.stateDir);assert.equal(store.events('waiting-run').filter(e=>e.type==='model.request.started').length,0);assert.equal(store.getRun('waiting-run').status,'cancelled');store.close();finish.resolve();assert.equal((await first).passed,true);
});
test('qualification probes share worker capacity with workflows',async t=>{
 const args=await setup(t),entered=latch(),finish=latch();let probeEntered=false;
 const workflow=runWorkflow({...args,providerName:'alpha',providerFactory:()=>({generate:async()=>{entered.resolve();await finish.promise;return {text:JSON.stringify(answer),metrics:{}};}})});
 await entered.promise;const probe=accountedProbe(args.config,'alpha',async()=>{probeEntered=true;return {text:'{"ok":true}',metrics:{inputTokens:1,outputTokens:1}};});await delay(50);assert.equal(probeEntered,false);finish.resolve();await workflow;await probe;assert.equal(probeEntered,true);
});

test('cancelled qualification retains worker lease until request settlement and accounts known usage',async t=>{
 const args=await setup(t),entered=latch(),finish=latch(),ctl=new AbortController();
 const pending=accountedProbe(args.config,'alpha',async()=>{entered.resolve();await finish.promise;return {text:'{"ok":true}',metrics:{inputTokens:2,outputTokens:3}};},{signal:ctl.signal});
 await entered.promise;ctl.abort();await delay(25);
 const leases=new CoordinatorLeases(path.join(args.config.stateDir,'coordinator-leases.sqlite'));assert.ok(leases.inspect('worker:mac48'));finish.resolve();let id;
 await assert.rejects(pending,error=>{id=error.runId;return /cancelled/.test(error.message);});assert.equal(leases.inspect('worker:mac48'),null);leases.close();
 const store=new RunStore(args.config.stateDir),finished=store.events(id).find(e=>e.type==='model.request.finished');assert.equal(finished.data.cancelled,true);assert.equal(finished.data.inputTokens,2);assert.equal(finished.data.outputTokens,3);assert.equal(store.getRun(id).status,'cancelled');store.close();
});

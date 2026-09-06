import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gradeArtifacts, runEvaluation, evaluationReport } from '../src/evaluation/index.js';
import { renderArtifacts } from '../src/documents.js';
import { DEFAULT_CONFIG, ROOT } from '../src/config.js';

async function setup(t){const root=await realpath(await mkdtemp(join(tmpdir(),'wm-eval-')));t.after(()=>rm(root,{recursive:true,force:true}));return {root,config:{...structuredClone(DEFAULT_CONFIG),stateDir:join(root,'state'),outputDir:join(root,'output'),python:process.env.WM_PYTHON||'python3'}};}
const tbl=(path,headers,rows)=>({path,kind:'tsv',tables:[{headers,rows}]});
async function volunteer(t,{badTotal=false,exceptionOnly=false,passed=true}={}){
 const {root,config}=await setup(t);const artifactDir=join(root,'artifacts');
 const task=JSON.parse(await readFile(join(ROOT,'fixtures/tasks/volunteer_hours_reconciliation-01/task.json'),'utf8'));
 const reference=JSON.parse(await readFile(join(ROOT,'fixtures/tasks/volunteer_hours_reconciliation-01/reference.json'),'utf8'));
 await renderArtifacts(artifactDir,[tbl('hours_ledger.tsv',['person_id','shift_id','hours','status','sources'],['A','B','C'].map((v,i)=>[`PERSON-${v}`,`SHIFT-${v}`,exceptionOnly?'':i+2,exceptionOnly?'conflict':'accepted','scheduler;scan'])),tbl('conflicts.tsv',['person_id','shift_id','reason'],exceptionOnly?[['PERSON-A','SHIFT-A','conflict']]:[]),tbl('funder_rollup.tsv',['metric','value'],[['accepted_hours',badTotal?999:exceptionOnly?0:9],['conflicts',exceptionOnly?1:0]]),{path:'evidence.json',kind:'json',data:[{item_id:'scan-0',value:{records:[{quote:'PERSON-A SHIFT-A 2'}]}}]}],config);
 return {task,reference,config,result:{artifactDir,passed,status:'completed',reviewRequired:false}};
}
test('reference grading reads artifacts independently of engine pass flag',async t=>{const good=await volunteer(t,{passed:false});const grade=await gradeArtifacts(good);assert.equal(grade.passed,true);assert.equal(grade.completedDeliverable,true);const bad=await volunteer(t,{badTotal:true,passed:true});assert.equal((await gradeArtifacts(bad)).passed,false);});
test('exception-only ordinary output cannot masquerade as full completion',async t=>{const grade=await gradeArtifacts(await volunteer(t,{exceptionOnly:true}));assert.equal(grade.passed,false);assert.equal(grade.completedDeliverable,false);});
test('missing artifacts fail reference grading even with engine passed true',async t=>{const data=await volunteer(t);data.result={passed:true,status:'completed'};const grade=await gradeArtifacts(data);assert.equal(grade.passed,false);});
test('bounded evaluation pauses and resumes exact slots without duplicating finished work',async t=>{
 const {config}=await setup(t);let called=0;const seen=[];
 const execute=async options=>{called++;seen.push(options);assert.match(options.inputDir,/inputs$/);assert.doesNotMatch(options.inputDir,/reference/);assert.deepEqual(options.config.routing.alternatives,[]);return {runId:options.runId,status:'blocked',reviewRequired:true};};
 const first=await runEvaluation({config,task:'volunteer_hours_reconciliation',provider:'bonsai8',repetitions:3,maxRuns:2,execute});
 assert.equal(first.slots.length,9);assert.equal(first.summary.finished,2);assert.equal(called,2);
 const second=await runEvaluation({config,campaignId:first.id,maxRuns:2,execute});assert.equal(second.summary.finished,4);assert.equal(called,4);
 assert.equal(new Set(seen.map(s=>s.runId)).size,4);
 const report=await evaluationReport(config,first.id);assert.equal(report.summary.failed,4);assert.equal(report.summary.pending,5);
 assert.ok(report.slots.filter(s=>s.status==='finished').every(s=>s.grade.reviewStatus==='generated_unreviewed'));
});
test('evaluation options reject invalid bounds and unknown providers',async t=>{const {config}=await setup(t);for(const args of [{split:'test'},{provider:'cloud'},{repetitions:0},{maxRuns:0},{campaignId:'../escape'}])await assert.rejects(runEvaluation({config,...args,execute:()=>{throw new Error('Must not execute');}}));});
test('held-out campaign preserves split and configuration across resume',async t=>{const {config}=await setup(t);const execute=async o=>({runId:o.runId,status:'blocked',reviewRequired:true});const c=await runEvaluation({config,split:'heldout',task:'stewardship_structuring',maxRuns:1,execute});assert.ok(c.slots.every(s=>/-0[456]:/.test(s.key)));await assert.rejects(runEvaluation({config:{...config,defaultProvider:'qwen7'},campaignId:c.id,execute}),/configuration changed/);});

test('missing scan source permits a correct zero-inference abstention, with real ledger accounting',async t=>{
 const data=await volunteer(t,{exceptionOnly:true});
 data.task=JSON.parse(await readFile(join(ROOT,'fixtures/tasks/volunteer_hours_reconciliation-03/task.json'),'utf8'));
 data.reference=JSON.parse(await readFile(join(ROOT,'fixtures/tasks/volunteer_hours_reconciliation-03/reference.json'),'utf8'));
 await renderArtifacts(data.result.artifactDir,[{path:'evidence.json',kind:'json',data:[]}],data.config);
 data.result.status='blocked';data.result.reviewRequired=true;
 data.result.gateResults=[{id:'inputs_readable',pass:false,detail:'Missing input self_reported.xlsx; No scanned sign-ins supplied'}];
 const grade=await gradeArtifacts(data);assert.equal(grade.passed,true,JSON.stringify(grade.checks));assert.equal(grade.completedDeliverable,false);assert.equal(grade.correctReviewOrAbstention,true);assert.equal(grade.rubricVersion,'2.2.0');
 data.result.gateResults=[];assert.equal((await gradeArtifacts(data)).passed,false);
});

test('evaluation rejects a source-code provenance mismatch on resume',async t=>{
 const {config}=await setup(t);const execute=async o=>({runId:o.runId,status:'blocked',reviewRequired:true});
 const c=await runEvaluation({config,task:'stewardship_structuring',maxRuns:1,execute});assert.match(c.sourceCodeDigest,/^[a-f0-9]{64}$/);
 const {writeFile}=await import('node:fs/promises');await writeFile(join(config.stateDir,'evaluations',`${c.id}.json`),JSON.stringify({...c,sourceCodeDigest:'changed'}));
 await assert.rejects(runEvaluation({config,campaignId:c.id,execute}),/source code changed/);
});

test('routed campaigns preserve family selection and fallback without a forced profile',async t=>{
 const {config}=await setup(t);config.routing.families={case_extract:'qwen7'};let captured;
 await runEvaluation({config,provider:'routed',task:'case_note_normalization',maxRuns:1,execute:async o=>{captured=o;return {runId:o.runId,status:'blocked',reviewRequired:true};}});
 assert.equal(captured.providerName,undefined);assert.deepEqual(captured.config.routing,config.routing);
});

test('stewardship accepts source-backed prohibition but rejects omission and boilerplate mention',async t=>{
 const {root,config}=await setup(t);const artifactDir=join(root,'stewardship');
 const fixture=join(ROOT,'fixtures/tasks/stewardship_structuring-01');const task=JSON.parse(await readFile(join(fixture,'task.json'),'utf8'));const reference=JSON.parse(await readFile(join(fixture,'reference.json'),'utf8'));
 const assets=JSON.parse(await readFile(join(fixture,'inputs/asset_inventory.json'),'utf8'));
 await renderArtifacts(artifactDir,[tbl('ip_transfer_inventory.tsv',['asset_id','proposed_owner','consent_status'],assets.map(a=>[a.id,a.proposed_owner,a.consent_status])),tbl('governance_matrix.tsv',['decision','authority','independent'],[['Fund spending oversight','Independent host board','yes']]),{path:'structuring_memo.md',kind:'md',text:'Review packet; no ownership transfer is executed.'},{path:'fund_use_policy.md',kind:'md',text:'Exclude private founder benefit.'},{path:'evidence.json',kind:'json',data:[{value:{quote:'Fiscal sponsorship source'}},{value:{quote:'Standalone nonprofit source'}}]}],config);
 const args={task,reference,config,result:{artifactDir,reviewRequired:true,status:'completed'}};
 assert.equal((await gradeArtifacts(args)).checks.find(c=>c.id==='founder_exclusion').pass,true);
 for(const text of ['Missing founder-benefit exclusion requires revision.','Do not exclude private founder benefit.','Contributor pay requires approval.']){await renderArtifacts(artifactDir,[{path:'fund_use_policy.md',kind:'md',text}],config);assert.equal((await gradeArtifacts(args)).checks.find(c=>c.id==='founder_exclusion').pass,false);}
});

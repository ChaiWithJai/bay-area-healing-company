import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, ROOT, DEFAULT_CONFIG } from './config.js';
import { loadWorkflows, findWorkflow } from './workflows/registry.js';
import { getProvider } from './providers/index.js';
import { accountedProbe } from './providers/probe.js';
import { runWorkflow } from './engine/runner.js';
import { RunStore, summarizeUsage, exportReport } from './observability/index.js';
const HELP=`wm — local accountability workflow lab

  wm init
  wm doctor [--probe] [--provider NAME]
  wm workflow list|show ID
  wm workflow run ID --input-dir DIR [--provider NAME] [--output-dir DIR]
  wm task list|show ID
  wm task run ID [--provider NAME]
  wm provider list|test NAME
  wm run list|status|resume|cancel [RUN_ID]
  wm trace RUN_ID
  wm usage [--run-id RUN_ID]
  wm report export RUN_ID [--output-dir DIR]
  wm eval run|resume|report [CAMPAIGN_ID] [--split development|heldout]
      [--provider NAME] [--repetitions N] [--max-runs N] [--task ID]
  wm config show

All model execution is local. No cloud/Codex runtime or API keys.
Use WM_PYTHON for your prepared document Python environment.
Runs are isolated, checkpointed, and accounted in .wm/runs.sqlite.
`;
const print=x=>console.log(typeof x==='string'?x:JSON.stringify(x,null,2));
export async function taskCatalog(){return JSON.parse(await readFile(path.join(ROOT,'fixtures','catalog.json'),'utf8'));}
export async function main(argv){
  const {positionals:pos,values:v}=parseArgs({args:argv,allowPositionals:true,options:{help:{type:'boolean',short:'h'},probe:{type:'boolean'},json:{type:'boolean'},provider:{type:'string'},'input-dir':{type:'string'},'output-dir':{type:'string'},'run-id':{type:'string'},split:{type:'string'},repetitions:{type:'string'},'max-runs':{type:'string'},task:{type:'string'}}});
  const [group,sub,id]=pos;
  if(!group||group==='help'||v.help){print(HELP);return;}
  const c=await loadConfig();
  const ctrl=new AbortController();const interrupt=()=>ctrl.abort(new Error('User cancelled execution'));
  const execute=async(spec,inputDir,options={})=>{
    process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
    try{return await runWorkflow({spec,config:c,inputDir,outputDir:v['output-dir'],providerName:v.provider,signal:ctrl.signal,onProgress:e=>{if(!v.json)console.error(`${e.runId} ${e.stepId??''} ${e.status}${e.profile?' '+e.profile:''}${e.reason?' — '+e.reason:''}`);},...options});}
    finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
  };
  if(group==='init'){
    const sample={version:2,defaultProvider:DEFAULT_CONFIG.defaultProvider,providers:DEFAULT_CONFIG.providers,routing:DEFAULT_CONFIG.routing,policy:DEFAULT_CONFIG.policy};
    try{await writeFile('wm.config.json',JSON.stringify(sample,null,2)+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
    await mkdir('inputs',{recursive:true});print('Configuration ready. Run wm doctor --probe, then wm task run volunteer_hours_reconciliation-01.');return;
  }
  if(group==='doctor'){
    const report={localOnly:true,node:process.version,python:c.python,profiles:[]};
    try{const {stdout}=await promisify(execFile)(c.python,[path.join(ROOT,'scripts/check-documents.py')],{timeout:10000,maxBuffer:100000});report.documents=JSON.parse(stdout);}catch(error){report.documents={ready:false,reason:error.message};}
    for(const name of v.provider?[v.provider]:Object.keys(c.providers)){
      try{const p=getProvider(c,name);const identity=await p.describe();const probe=v.probe?await accountedProbe(c,name):null;report.profiles.push({...identity,structuredProbe:probe?JSON.parse(probe.text).ok===true:'unprobed',metrics:probe?.metrics??null});}
      catch(error){report.profiles.push({profile:name,status:c.providers[name]?.enabled?'unavailable':'disabled',reason:error.message});}
    }
    print(report);return;
  }
  if(group==='provider'){
    if(sub==='list'){print(Object.entries(c.providers).map(([name,p])=>({name,...p})));return;}
    if(sub==='test'){print(await accountedProbe(c,id??c.defaultProvider));return;}
  }
  if(group==='workflow'){
    if(sub==='list'){print((await loadWorkflows(c.workflowsDir)).map(s=>({id:s.id,name:s.name})));return;}
    if(sub==='show'){print(await findWorkflow(c.workflowsDir,id));return;}
    if(sub==='run'){const spec=await findWorkflow(c.workflowsDir,id);const r=await execute(spec,v['input-dir']??path.join('inputs',id.split('/').pop()));print(r);if(!r.passed)process.exitCode=2;return;}
  }
  if(group==='task'){
    const catalog=await taskCatalog();
    if(sub==='list'){print(catalog.map(({id,workflow_id,split,variant,provenance})=>({id,workflow:workflow_id,split,variant,provenance})));return;}
    const t=catalog.find(t=>t.id===id);if(!t)throw new Error(`Unknown task ${id}`);
    if(sub==='show'){print(t);return;}
    if(sub==='run'){const r=await execute(await findWorkflow(c.workflowsDir,t.workflow_id),path.join(ROOT,'fixtures','tasks',t.id,'inputs'));print(r);if(!r.passed)process.exitCode=2;return;}
  }
  if(group==='eval'){
    const {runEvaluation,evaluationReport}=await import('./evaluation/index.js');
    if(sub==='run'||sub==='resume'){
      process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
      try{print(await runEvaluation({config:c,signal:ctrl.signal,campaignId:sub==='resume'?id:undefined,split:v.split??'development',provider:v.provider,repetitions:Number(v.repetitions??1),maxRuns:Number(v['max-runs']??10),task:v.task,onProgress:e=>console.error(JSON.stringify(e))}));if(ctrl.signal.aborted)process.exitCode=130;}
      finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}return;
    }
    if(sub==='report'){print(await evaluationReport(c,id));return;}
  }
  if(group==='config'&&sub==='show'){print(c);return;}
  const store=new RunStore(c.stateDir);
  try {
    if(group==='usage'){print(summarizeUsage(store,{runId:v['run-id']}));return;}
    if(group==='trace'){if(!store.getRun(sub))throw new Error(`Unknown run ${sub}`);print(store.events(sub));return;}
    if(group==='report'&&sub==='export'){print(await exportReport(store,id,path.resolve(v['output-dir']??path.join('reports',id))));return;}
    if(group==='run'){
      if(sub==='list'){print(store.listRuns().map(r=>({id:r.id,workflow:r.workflow,status:r.status,createdAt:r.createdAt})));return;}
      const run=store.getRun(id);if(!run)throw new Error(`Unknown run ${id}`);
      if(sub==='status'){print(run);return;}
      if(sub==='cancel'){if(run.status==='completed'){print('Run already completed');return;}store.updateRun(id,{cancelRequested:true});store.event(id,'run.cancel_requested',{});print({runId:id,cancelRequested:true});return;}
      if(sub==='resume'){const r=await execute(await findWorkflow(c.workflowsDir,run.workflow),run.inputDir,{runId:id});print(r);if(!r.passed)process.exitCode=2;return;}
    }
  } finally {store.close();}
  throw new Error(`Unknown command. Run wm help.`);
}

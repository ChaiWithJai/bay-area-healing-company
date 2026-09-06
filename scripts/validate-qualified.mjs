import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { runEvaluation } from '../src/evaluation/index.js';
import { routingReport } from './routing-report.mjs';
const config=await loadConfig();
const ids=process.argv.slice(2);if(!ids.length)throw new Error('Pass completed development campaign IDs');
const campaigns=await Promise.all(ids.map(id=>{if(!/^[\w-]+$/.test(id))throw new Error('Invalid ID');return readFile(path.join(config.stateDir,'evaluations',id+'.json'),'utf8').then(JSON.parse);}));
const selection=routingReport(campaigns);
const controller=new AbortController();for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>controller.abort(new Error('User cancelled validation')));
await mkdir('docs/results',{recursive:true});await writeFile('docs/results/routing-development.json',JSON.stringify(selection,null,2)+'\n');
for(const profile of [...new Set(selection.measurements.filter(m=>m.eligible).map(m=>m.profile))]){
 const eligible=selection.measurements.filter(m=>m.eligible&&m.profile===profile);
 const groups=eligible.length===5?[{task:undefined,suffix:'all'}]:eligible.map(m=>({task:m.workflow,suffix:m.workflow.split('/').pop()}));
 for(const group of groups){
  if(controller.signal.aborted)break;
  const id=`heldout-${profile}-${group.suffix}-v4`;
  const result=await runEvaluation({config,campaignId:id,provider:profile,task:group.task,split:'heldout',repetitions:3,maxRuns:45,signal:controller.signal,onProgress:e=>{if(e.status==='graded'||e.taskId&&e.status==='running')console.log(JSON.stringify(e));}});
  console.log(JSON.stringify({id,summary:result.summary}));
 }
}
if(!controller.signal.aborted){
 const result=await runEvaluation({config,campaignId:'heldout-routed-v4',provider:'routed',split:'heldout',repetitions:1,maxRuns:15,signal:controller.signal,onProgress:e=>{if(e.status==='graded'||e.taskId&&e.status==='running')console.log(JSON.stringify(e));}});
 console.log(JSON.stringify({id:result.id,summary:result.summary}));
}

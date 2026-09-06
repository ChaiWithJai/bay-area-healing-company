import { loadConfig } from '../src/config.js';
import { runEvaluation } from '../src/evaluation/index.js';
const config=await loadConfig();
const [id,provider='bonsai8',split='development',repeat='1',max='15']=process.argv.slice(2);
if(!id)throw new Error('Usage: node scripts/evaluate-local.mjs ID PROFILE SPLIT REPETITIONS MAX_RUNS');
const controller=new AbortController();
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>controller.abort(new Error('User cancelled evaluation')));
const result=await runEvaluation({config,campaignId:id,provider,split,repetitions:Number(repeat),maxRuns:Number(max),signal:controller.signal,onProgress:e=>{if(e.status==='graded'||e.taskId&&e.status==='running')console.log(JSON.stringify(e));}});
console.log(JSON.stringify({id:result.id,summary:result.summary,failures:result.slots.filter(s=>s.grade&&!s.grade.passed).map(s=>({task:s.taskId,checks:s.grade.checks.filter(c=>!c.pass)}))},null,2));

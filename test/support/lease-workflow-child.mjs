import path from 'node:path';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {DEFAULT_CONFIG} from '../../src/config.js';
import {runWorkflow} from '../../src/engine/runner.js';
const [root,workerId,runId]=process.argv.slice(2),ctl=new AbortController();let finish;
process.on('message',message=>{if(message==='finish')finish?.();if(message==='abort')ctl.abort(new Error('Cancelled process test'));});
const config={...structuredClone(DEFAULT_CONFIG),stateDir:path.join(root,'state'),outputDir:path.join(root,'out'),routing:{alternatives:[],families:{},maxRepairs:0}};
config.providers.test={...config.providers.bonsai8,workerId};
const schema={type:'object',additionalProperties:false,required:['quote','reason'],properties:{quote:{type:'string'},reason:{type:'string'}}};
const item={id:'one',family:'board_evidence',system:'Extract',prompt:'Source verified.',sourceText:'Source verified.',schema};
const spec={...JSON.parse(await readFile(new URL('../../workflows/nonprofit.board_report_synthesis.json',import.meta.url),'utf8')),deliverable:['report.md']};
try{
 const result=await runWorkflow({spec,config,runId,inputDir:root,providerName:'test',signal:ctl.signal,
 prepare:async()=>({items:[item],inputManifest:[{id:'source',sha256:'same'}],context:{items:[item]}}),
 finalize:async(_id,_context,_results,output)=>{await mkdir(output,{recursive:true});await writeFile(path.join(output,'report.md'),'Controlled response');return {artifacts:[],gates:[{id:'domain',pass:true}],reviewRequired:false,score:1};},
 providerFactory:()=>({generate:async()=>{const waiting=new Promise(resolve=>finish=resolve);process.send({type:'request-started',runId,workerId});await waiting;return {text:JSON.stringify({quote:'Source verified.',reason:'Controlled source selection'}),metrics:{inputTokens:1,outputTokens:1}};}})});
 process.send({type:'finished',runId,passed:result.passed});
}catch(error){process.send({type:'error',message:error.message,runId:error.runId});process.exitCode=2;}
process.disconnect();

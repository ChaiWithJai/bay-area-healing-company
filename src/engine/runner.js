import { mkdir, writeFile, readFile, open, unlink, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import { sourceCodeDigest } from '../provenance.js';
import Ajv from 'ajv';
import { getProvider } from '../providers/index.js';
import { prepareWorkflow, finalizeWorkflow, validateWorkItem } from '../domain/index.js';
import { RunStore, startResourceSampler } from '../observability/index.js';
import { runStructuralGates, gatesPassed } from './gates.js';
import domainContracts from './domain-contracts.json' with { type: 'json' };
const ajv = new Ajv({ allErrors: true, strict: false });
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');

export async function acquireLock(stateDir, runId) {
  await mkdir(stateDir, {recursive:true,mode:0o700});
  const file=path.join(stateDir,'inference.lock');
  for(let n=0;n<2;n++) {
    try { const handle=await open(file,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,runId}));await handle.close();return async()=>{await unlink(file).catch(()=>{});}; }
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      const old=JSON.parse(await readFile(file,'utf8'));
      let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
      if(alive)throw new Error(`Another coordinator is active (PID ${old.pid}, run ${old.runId}). One inference slot is permitted.`);
      await unlink(file);
    }
  }
  throw new Error('Cannot acquire inference slot');
}
async function atomicJson(file,data){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${randomUUID()}.tmp`;await writeFile(tmp,JSON.stringify(data,null,2),{mode:0o600});await rename(tmp,file);}
export function parseResult(text,schema){const value=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));const validate=ajv.compile(schema);if(!validate(value))throw new Error(`Schema: ${ajv.errorsText(validate.errors)}`);return value;}

export async function runWorkflow({spec,config,providerName,inputDir,outputDir,runId,signal,onProgress=()=>{},prepare=prepareWorkflow,finalize=finalizeWorkflow,providerFactory=getProvider}) {
  const store=new RunStore(config.stateDir),id=runId??randomUUID();
  let release,stopSampling,poll,timer;const ctl=new AbortController();
  const forward=()=>ctl.abort(signal.reason);signal?.addEventListener('abort',forward,{once:true});
  if(signal?.aborted)forward();
  let run=store.getRun(id),attempts=0;
  try {
    release=await acquireLock(config.stateDir,id);
    if(run?.status==='completed')return run.result;
    inputDir=path.resolve(run?.inputDir??inputDir);
    outputDir=path.resolve(run?.outputDir??path.join(outputDir??config.outputDir,id));
    const codeDigest=await sourceCodeDigest();
    if(run?.codeDigest&&run.codeDigest!==codeDigest)throw new Error('Application code changed; start a new run');
    if(!run)run=store.createRun({id,workflow:spec.id,inputDir,outputDir,config,profile:providerName??config.defaultProvider,forcedProfile:providerName,codeDigest,configDigest:hash(config),provenance:{hostname:os.hostname(),runtimeCloud:false,appVersion:'0.2.0',sourceCodeDigest:codeDigest}});
    else if(run.configDigest!==hash(config))throw new Error('Configuration changed since this run; start a new run to preserve comparison integrity');
    store.updateRun(id,{status:'running',cancelRequested:false,pid:process.pid});
    store.event(id,'run.started',{resumed:Boolean(runId)});onProgress({runId:id,status:'running'});
    timer=setTimeout(()=>ctl.abort(new Error('Run time budget exhausted')),config.limits.runTimeoutMs);
    poll=setInterval(()=>{if(store.getRun(id)?.cancelRequested)ctl.abort(new Error('Cancellation requested'));},500);
    const sampler=startResourceSampler(sample=>store.event(id,'resource.sample',sample),{intervalMs:1000});stopSampling=sampler.stop;
    const started=Date.now();
    const plan=await prepare(spec.id,inputDir,{...config,signal:ctl.signal});
    store.event(id,'tool.finished',{tool:'prepare',durationMs:Date.now()-started,sources:plan.inputManifest.length,workItems:plan.items.length});
    const manifestDigest=hash(plan.inputManifest),planDigest=hash(plan.items);
    if(run.manifestDigest&&run.manifestDigest!==manifestDigest)throw new Error('Inputs changed; refusing to reuse old checkpoints');
    if(run.planDigest&&run.planDigest!==planDigest)throw new Error('Work plan changed; start a new run');
    store.updateRun(id,{manifestDigest,planDigest,inputManifest:plan.inputManifest,totalSteps:plan.items.length});
    const prior=new Map(store.getSteps(id).map(s=>[s.stepId,s]));const results={};const failures=[];
    const providers=new Map();
    for(const item of plan.items){
      ctl.signal.throwIfAborted();
      if(prior.get(item.id)?.status==='accepted'){results[item.id]=prior.get(item.id).value;store.event(id,'step.reused',{stepId:item.id});continue;}
      let feedback='';const first=providerName??run.forcedProfile??config.routing.families[item.family]??config.defaultProvider;
      const profiles=[first,...config.routing.alternatives.filter(p=>p!==first)].slice(0,2);
      for(const profile of profiles){
        if(results[item.id])break;
        store.event(id,'routing.selected',{stepId:item.id,family:item.family,profile,reason:profile===first?'configured family profile':'prior profile failed validation or execution'});
        for(let repair=0;repair<=config.routing.maxRepairs;repair++){
          ctl.signal.throwIfAborted();if(attempts>=config.limits.maxAttempts)throw new Error('Attempt budget exhausted; checkpoint retained');
          const prompt=item.prompt+(feedback?`\nPrevious response failed validation: ${feedback}. Correct the response using only the source evidence.`:'');
          if(prompt.length+item.system.length+JSON.stringify(item.schema).length>config.limits.maxPromptChars){feedback='Prompt exceeds configured bounded context; no silent truncation';store.event(id,'step.context_blocked',{stepId:item.id,profile});break;}
          const attemptId=randomUUID(),start=Date.now();attempts++;
          const tracePath=path.join(config.stateDir,'runs',id,'attempts',`${attemptId}.json`);
          store.event(id,'model.request.started',{attemptId,stepId:item.id,profile,repair,workerId:config.providers?.[profile]?.workerId??'coordinator',transport:config.providers?.[profile]?.workerId?'ssh':'loopback'});
          let generated,recorded=false;
          try {
            if(!providers.has(profile))providers.set(profile,providerFactory(config,profile));
            generated=await providers.get(profile).generate({system:item.system,prompt,schema:item.schema,signal:ctl.signal});
            await atomicJson(tracePath,{system:item.system,prompt,schema:item.schema,response:generated.text,metrics:generated.metrics});
            const value=parseResult(generated.text,item.schema),validation=validateWorkItem(item,value,plan.context);
            if(!validation.pass)throw new Error(validation.detail);
            store.event(id,'model.request.finished',{attemptId,stepId:item.id,profile,...generated.metrics,success:true,traceArtifact:tracePath});recorded=true;
            store.saveStep(id,item.id,{status:'accepted',value,profile,attemptId});results[item.id]=value;
            store.event(id,'step.accepted',{stepId:item.id,profile});onProgress({runId:id,stepId:item.id,status:'accepted',profile});break;
          } catch(error) {
            feedback=error.message;
            if(!recorded)store.event(id,'model.request.finished',{attemptId,stepId:item.id,profile,...(generated?.metrics??error.metrics??{durationMs:Date.now()-start,inputTokens:null,outputTokens:null}),success:false,cancelled:ctl.signal.aborted,error:feedback,traceArtifact:generated?tracePath:null});
            store.event(id,'step.rejected',{stepId:item.id,profile,reason:feedback});onProgress({runId:id,stepId:item.id,status:'retry',profile,reason:feedback});
            if(ctl.signal.aborted)throw error;
            if(/not installed|disabled|unavailable|HTTP|fetch failed|prohibited/i.test(feedback))break;
          }
        }
      }
      if(!results[item.id]){failures.push({stepId:item.id,reason:feedback});store.saveStep(id,item.id,{status:'blocked',reason:feedback});}
    }
    ctl.signal.throwIfAborted();
    const artifactDir=path.join(outputDir,`generation-${randomUUID()}`),start=Date.now();
    const outcome=await finalize(spec.id,plan.context,results,artifactDir,{...config,signal:ctl.signal});
    store.event(id,'tool.finished',{tool:'finalize',durationMs:Date.now()-start,artifacts:outcome.artifacts});
    const contractKnown=domainContracts[spec.id]===hash(spec.gates);
    const gates=[...runStructuralGates(spec,artifactDir,{domainHandled:contractKnown}),...outcome.gates,{id:'registered_domain_contract',pass:contractKnown,detail:contractKnown?'Declared gate version has a domain implementation':'Unknown or changed gate contract; implement and register before accepting'}];
    const passed=failures.length===0&&gatesPassed(gates);
    const result={runId:id,workflow:spec.id,passed,status:passed?'completed':'blocked',reviewRequired:outcome.reviewRequired,score:passed?outcome.score:0,summary:outcome.summary,gateResults:gates,artifacts:outcome.artifacts,artifactDir,failures};
    await atomicJson(path.join(outputDir,'result.json'),result);
    store.updateRun(id,{status:result.status,result,completedSteps:Object.keys(results).length});store.event(id,'run.finished',{status:result.status,passed,reviewRequired:result.reviewRequired});
    return result;
  } catch(error) {
    if(release&&store.getRun(id)){const cancelled=ctl.signal.aborted&&/cancel|abort/i.test(String(ctl.signal.reason));store.updateRun(id,{status:cancelled?'cancelled':'blocked',error:error.message});store.event(id,'run.interrupted',{reason:error.message,cancelled});}
    error.runId=id;throw error;
  } finally {
    clearInterval(poll);clearTimeout(timer);signal?.removeEventListener('abort',forward);
    if(stopSampling)await stopSampling();if(release)await release();store.close();
  }
}

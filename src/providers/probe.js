import { randomUUID } from 'node:crypto';
import { testProvider } from './index.js';
import { RunStore, startResourceSampler } from '../observability/index.js';
import { acquireLock } from '../engine/runner.js';

// Probes consume real local resources and share the same inference slot as runs.
export async function accountedProbe(config, profile, probe=testProvider) {
 const id=randomUUID(),attemptId=randomUUID();
 const release=await acquireLock(config.stateDir,id);
 const store=new RunStore(config.stateDir);let sampler;
 try {
  store.createRun({id,workflow:'qualification/structured_probe',runType:'qualification',config,profile,status:'running'});
  sampler=startResourceSampler(sample=>store.event(id,'resource.sample',sample),{intervalMs:1000});
  store.event(id,'model.request.started',{attemptId,profile});
  try {
   const result=await probe(config,profile);
   store.event(id,'model.request.finished',{attemptId,profile,...result.metrics,success:true});
   store.updateRun(id,{status:'completed'});
   return {...result,runId:id};
  } catch(error) {
   store.event(id,'model.request.finished',{attemptId,profile,...(error.metrics??{inputTokens:null,outputTokens:null}),success:false,error:error.message});
   store.updateRun(id,{status:'blocked',error:error.message});error.runId=id;throw error;
  }
 } finally {await sampler?.stop();store.close();await release();}
}

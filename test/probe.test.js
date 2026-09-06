import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { accountedProbe } from '../src/providers/probe.js';
import { RunStore } from '../src/observability/index.js';
test('qualification retains successful and failed probe consumption outside deliverable runs',async()=>{
 const stateDir=await mkdtemp(path.join(os.tmpdir(),'wm-probe-'));const config={stateDir};
 try {
 const ok=await accountedProbe(config,'tiny',async()=>({text:'{"ok":true}',metrics:{inputTokens:8,outputTokens:4}}));
 let failed;try{await accountedProbe(config,'tiny',async()=>{const e=new Error('Invalid JSON');e.metrics={inputTokens:9,outputTokens:3};throw e;});}catch(e){failed=e;}
 const store=new RunStore(stateDir);
 try{assert.equal(store.getRun(ok.runId).runType,'qualification');assert.equal(store.getRun(failed.runId).status,'blocked');assert.equal(store.events(failed.runId).find(e=>e.type==='model.request.finished').data.outputTokens,3);}finally{store.close();}
 }finally{await rm(stateDir,{recursive:true,force:true});}
});

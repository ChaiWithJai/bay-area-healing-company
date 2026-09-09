import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RunStore,summarizeUsage } from '../src/observability/index.js';
import { fleetReport,markdown } from '../scripts/fleet-report.mjs';
const campaign=(id,usage)=>({id,status:'completed',sourceCodeDigest:'same-source',configDigest:'same-config',rubricVersion:'same-rubric',catalogDigest:'same-catalog',split:'development',slots:[{runId:id+'-run',status:'finished',taskId:'grant_cycle_package-01',profile:'mixed',referenceDigest:'same-reference',grade:{passed:true,completedDeliverable:true},usage}]});
test('fleet report uses current mixed-worker accounting and does not export connections or paths',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'fleet-report-'));const store=new RunStore(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 store.createRun({id:'run',workflow:'grants'});
 store.event('run','resource.sample',{processRssBytes:100,serverRssBytes:200});
 store.event('run','model.request.finished',{attemptId:'a',workerId:'coordinator',transport:'loopback',success:true,inputTokens:5,outputTokens:3,durationMs:10});
 store.event('run','model.request.finished',{attemptId:'b',workerId:'mac48',transport:'ssh',success:false,inputTokens:8,durationMs:20,sshHost:'PRIVATE_HOST',workerResources:{before:{serverRssBytes:900}}});
 store.event('run','model.request.started',{attemptId:'c',workerId:'mac48',transport:'ssh'});
 const c=campaign('c',summarizeUsage(store));c.privatePath='PRIVATE_PATH';c.slots[0].result={artifactDir:'PRIVATE_PATH'};
 const report=fleetReport([c]);const w=report.campaigns[0].workflows[0];
 assert.equal(w.accounting.attempts,3);assert.equal(w.accounting.metrics.inputTokens.sum,13);assert.equal(w.accounting.metrics.inputTokens.coverage,2/3);
 assert.equal(w.workers.find(x=>x.workerId==='mac48').accounting.incomplete,1);
 assert.equal(w.workers.find(x=>x.workerId==='mac48').resources.sampledServerPeakRssBytes,900);
 assert.equal(w.workers.find(x=>x.workerId==='coordinator').resources.sampledServerPeakRssBytes,null);
 assert.equal(w.coordinatorResources.sampledPeakRssBytes,100);
 assert.equal(report.costs.paidInferenceApi,null);assert.ok(!JSON.stringify(report).includes('PRIVATE_'));assert.match(markdown(report),/not human reliability/);
});
test('comparability requires complete matched fixed provenance and task coverage',()=>{
 const a=campaign('a'),b=campaign('b');assert.equal(fleetReport([a,b]).comparison.status,'comparable-fixed-campaigns');
 b.configDigest='other';assert.equal(fleetReport([a,b]).comparison.status,'non-comparable');b.configDigest=a.configDigest;b.slots[0].referenceDigest='other';assert.ok(fleetReport([a,b]).comparison.reasons.includes('Different reference content'));
 delete b.sourceCodeDigest;assert.ok(fleetReport([a,b]).comparison.reasons.includes('Missing sourceCodeDigest'));
 b.status='paused';assert.throws(()=>fleetReport([a,b]),/completed/);
});
test('missing usage and worker snapshots stay unknown; duplicate runs reject',()=>{
 const a=campaign('a');const report=fleetReport([a]);assert.equal(report.campaigns[0].accounting.attempts,null);assert.equal(report.campaigns[0].accounting.runsMissingAccounting,1);assert.equal(report.campaigns[0].workflows[0].workers[0].resources.sampledServerPeakRssBytes,null);assert.throws(()=>fleetReport([a,a]),/duplicated/);
});

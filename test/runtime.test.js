import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertLocalEndpoint, validateProfile, getProvider } from '../src/providers/index.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { acquireLock, parseResult, runWorkflow } from '../src/engine/runner.js';
import { RunStore } from '../src/observability/index.js';
import { CoordinatorLeases } from '../src/fleet/leases.js';
import { gatesPassed, runStructuralGates } from '../src/engine/gates.js';

const schema={type:'object',additionalProperties:false,required:['quote','reason'],properties:{quote:{type:'string'},reason:{type:'string'}}};
const answer={quote:'Source verified.',reason:'Source statement'};
const profile={kind:'local',adapter:'ollama',enabled:true,model:'small:latest',context:4096,maxTokens:128};
async function server(t, handler) {
  const instance=http.createServer(handler);
  await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{instance.close(resolve);instance.closeAllConnections();}));
  return `http://127.0.0.1:${instance.address().port}`;
}
function providerConfig(baseUrl, adapter='ollama') {
  return {...structuredClone(DEFAULT_CONFIG),defaultProvider:'small',providers:{small:{...profile,adapter,baseUrl}}};
}
function ollamaHandler(chat, show={}) {
  return (req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:profile.model,digest:'sha256:fixture',size:1024}]}));
    if(req.url==='/api/show')return res.end(JSON.stringify(show));
    if(req.url==='/api/version')return res.end(JSON.stringify({version:'test'}));
    if(req.url==='/api/chat')return chat(req,res);
    res.writeHead(404).end();
  };
}

test('only explicit HTTP loopback and local profiles can dispatch',()=>{
  for(const url of ['https://127.0.0.1','http://example.com','http://192.168.0.2','http://127.0.0.1.example.com','http://user:password@localhost','http://localhost?key=value'])assert.throws(()=>assertLocalEndpoint(url));
  assert.match(assertLocalEndpoint('http://localhost:1234'),/^http:\/\/127\.0\.0\.1:1234$/);
  for(const patch of [{kind:'cloud'},{adapter:'codex'},{model:'tiny-cloud'},{enabled:false}])assert.throws(()=>validateProfile({...profile,baseUrl:'http://127.0.0.1',...patch}));
});

test('loopback HTTP redirect is not followed',async t=>{
  let destinationHits=0;
  const destination=await server(t,(_req,res)=>{destinationHits++;res.end('{}');});
  const base=await server(t,(_req,res)=>res.writeHead(302,{location:destination}).end());
  await assert.rejects(getProvider(providerConfig(base)).describe());
  assert.equal(destinationHits,0);
});

test('remote-backed Ollama model rejected before inference',async t=>{
  let calls=0;
  const base=await server(t,ollamaHandler((_req,res)=>{calls++;res.end();},{remote_host:'https://remote.invalid',remote_model:'remote'}));
  await assert.rejects(getProvider(providerConfig(base)).generate({system:'',prompt:'',schema}),/Remote-backed/);
  assert.equal(calls,0);
});

test('chunked local output validates and preserves measured usage',async t=>{
  const serialized=JSON.stringify(answer);
  const base=await server(t,ollamaHandler((_req,res)=>{
    const stream=[{message:{content:serialized.slice(0,7)},done:false},{message:{content:serialized.slice(7)},done:false},{done:true,done_reason:'stop',prompt_eval_count:12,eval_count:8,load_duration:1000000}].map(x=>JSON.stringify(x)+'\n').join('');
    res.write(stream.slice(0,13));res.end(stream.slice(13));
  }));
  const result=await getProvider(providerConfig(base)).generate({system:'extract',prompt:'Source verified.',schema});
  assert.deepEqual(parseResult(result.text,schema),answer);
  assert.equal(result.metrics.inputTokens,12);assert.equal(result.metrics.outputTokens,8);assert.equal(result.metrics.loadMs,1);
  assert.throws(()=>parseResult('{"quote":3}',schema),/Schema/);
});

test('incomplete stream fails with unknown token accounting, never zero',async t=>{
  const base=await server(t,ollamaHandler((_req,res)=>res.end(JSON.stringify({message:{content:'{"quote":'},done:false})+'\n')));
  await assert.rejects(getProvider(providerConfig(base)).generate({system:'',prompt:'',schema}),error=>{
    assert.match(error.message,/Incomplete/);assert.equal(error.metrics.workerIdleUncertain,true);assert.equal(error.metrics.inputTokens,null);assert.equal(error.metrics.outputTokens,null);assert.ok(error.metrics.partialOutputChars>0);return true;
  });
});

test('token-limit completion is rejected even when partial text is valid JSON',async t=>{
  const base=await server(t,ollamaHandler((_req,res)=>res.end(JSON.stringify({message:{content:JSON.stringify(answer)},done:true,done_reason:'length',eval_count:128})+'\n')));
  await assert.rejects(getProvider(providerConfig(base)).generate({system:'',prompt:'',schema}),error=>{assert.match(error.message,/truncated/);assert.equal(error.metrics.workerIdleUncertain,false);return true;});
});

async function setup(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'wm-runtime-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const config={...structuredClone(DEFAULT_CONFIG),stateDir:path.join(root,'state'),outputDir:path.join(root,'out'),routing:{alternatives:[],families:{},maxRepairs:0}};
  const item={id:'evidence-1',family:'board_evidence',system:'extract',prompt:'Source verified.',sourceText:'Source verified.',schema};
  const plan={inputManifest:[{id:'source',sha256:'version-one'}],items:[item],context:{items:[item]}};
  const original=JSON.parse(await readFile(new URL('../workflows/nonprofit.board_report_synthesis.json',import.meta.url),'utf8'));
  const spec={...original,deliverable:['report.md']};
  const prepare=async()=>structuredClone(plan);
  const finalize=async(_id,_context,_results,output)=>{await mkdir(output,{recursive:true});await writeFile(path.join(output,'report.md'),'Accepted evidence');return {artifacts:[],gates:[{id:'domain',pass:true}],reviewRequired:false,score:1,summary:'Test'};};
  const providerFactory=()=>({generate:async()=>({text:JSON.stringify(answer),metrics:{inputTokens:10,outputTokens:10}})});
  return {root,config,plan,spec,prepare,finalize,providerFactory,inputDir:root};
}

test('unknown gates fail closed and stale previous outputs cannot fulfill a new run',async t=>{
  const args=await setup(t);
  assert.equal(gatesPassed([{pass:null}]),false);
  assert.equal(gatesPassed([]),false);
  await mkdir(args.config.outputDir,{recursive:true});
  await writeFile(path.join(args.config.outputDir,'report.md'),'Stale');
  assert.equal(gatesPassed(runStructuralGates({...args.spec,gates:['unencoded']},args.config.outputDir)),false);
  const result=await runWorkflow({...args,finalize:async()=>({artifacts:[],gates:[{id:'domain',pass:true}],score:1})});
  assert.equal(result.passed,false);
  assert.ok(result.gateResults.some(g=>g.id==='deliverable-exists:report.md'&&g.pass===false));
});

test('resume refuses changed input digest before reusing accepted work',async t=>{
  const args=await setup(t);let calls=0, runId;
  const factory=()=>({generate:async()=>{calls++;return {text:JSON.stringify(answer),metrics:{}};}});
  try {await runWorkflow({...args,providerFactory:factory,finalize:async()=>{throw new Error('interrupted during rendering');}});}catch(error){runId=error.runId;}
  assert.ok(runId);assert.equal(calls,1);
  args.plan.inputManifest[0].sha256='version-two';
  await assert.rejects(runWorkflow({...args,runId,providerFactory:factory}),/Inputs changed/);
  assert.equal(calls,1);
});

test('resume reuses accepted checkpoint rather than issuing duplicate inference',async t=>{
  const args=await setup(t);let calls=0, runId;
  const factory=()=>({generate:async()=>{calls++;return {text:JSON.stringify(answer),metrics:{}};}});
  try {await runWorkflow({...args,providerFactory:factory,finalize:async()=>{throw new Error('render interrupted');}});}catch(error){runId=error.runId;}
  const result=await runWorkflow({...args,runId,providerFactory:factory});
  assert.equal(result.passed,true);assert.equal(calls,1);
});

test('active coordinator lock refuses another claimant',async t=>{
  const args=await setup(t);
  const release=await acquireLock(args.config.stateDir,'owner');
  try{await assert.rejects(acquireLock(args.config.stateDir,'other'),/Another coordinator is active/);}finally{await release();}
  const second=await acquireLock(args.config.stateDir,'other');await second();
});

test('LM Studio EOF without terminal completion is rejected',async t=>{
  const base=await server(t,(req,res)=>{
    if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:profile.model}]}));
    res.setHeader('content-type','text/event-stream');
    res.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(answer)}}]})+'\n\n');
  });
  await assert.rejects(getProvider(providerConfig(base,'lmstudio')).generate({system:'',prompt:'',schema}),/Incomplete/);
});

test('refused same-run lock cannot change active owner status',async t=>{
  const args=await setup(t),id='active-owner';
  const store=new RunStore(args.config.stateDir);
  store.createRun({id,workflow:args.spec.id,status:'running',inputDir:args.root,outputDir:args.config.outputDir});
  const leases=new CoordinatorLeases(path.join(args.config.stateDir,'coordinator-leases.sqlite'));
  const lease=await leases.acquire({resource:`run:${id}`,runId:id});
  const before=store.getRun(id);
  try {
    await assert.rejects(runWorkflow({...args,runId:id}),/Another coordinator/);
    assert.deepEqual(store.getRun(id),before);
  } finally {leases.release(lease);leases.close();store.close();}
});

test('new unimplemented spec gate cannot silently disappear at runtime',async t=>{
  const args=await setup(t);
  args.spec.gates.push('New correctness requirement with no implementation');
  const result=await runWorkflow(args);
  assert.equal(result.passed,false);
  assert.ok(result.gateResults.some(g=>g.id==='registered_domain_contract'&&g.pass===false));
});

test('cancelled streaming request records partial output and unknown usage',async t=>{
  const controller=new AbortController();
  const base=await server(t,ollamaHandler((_req,res)=>{
    res.write(JSON.stringify({message:{content:'partial evidence'},done:false})+'\n');
  }));
  await assert.rejects(getProvider(providerConfig(base)).generate({system:'',prompt:'',schema,signal:controller.signal,onToken:()=>controller.abort(new Error('user cancelled'))}),error=>{
    assert.equal(error.metrics.cancelled,true);assert.equal(error.metrics.workerIdleUncertain,true);
    assert.ok(error.metrics.partialOutputChars>0);
    assert.equal(error.metrics.inputTokens,null);
    assert.equal(error.metrics.outputTokens,null);
    return true;
  });
});

test('source-validation failure gets one repair then a bounded local alternative with full accounting',async t=>{
 const args=await setup(t);args.config.routing={families:{},alternatives:['qwen7'],maxRepairs:1};
 const calls=[];
 const providerFactory=(_config,name)=>({generate:async()=>{calls.push(name);return {text:JSON.stringify(name==='qwen7'?answer:{quote:'Invented claim.',reason:'Unsupported'}),metrics:{inputTokens:10,outputTokens:5}};}});
 const result=await runWorkflow({...args,providerFactory});assert.equal(result.passed,true);
 assert.deepEqual(calls,['bonsai8','bonsai8','qwen7']);
 const store=new RunStore(args.config.stateDir);
 try {const finished=store.events(result.runId).filter(e=>e.type==='model.request.finished');assert.deepEqual(finished.map(e=>e.data.success),[false,false,true]);assert.equal(finished.reduce((n,e)=>n+e.data.inputTokens,0),30);assert.equal(store.getSteps(result.runId)[0].profile,'qwen7');}
 finally{store.close();}
});

test('LM Studio records actual loaded context and forwards explicitly configured reasoning control',async t=>{
 let received;
 const base=await server(t,(req,res)=>{
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:profile.model}]}));
  if(req.url==='/api/v1/models')return res.end(JSON.stringify({models:[{key:'qualified/model',quantization:{name:'4bit'},loaded_instances:[{id:profile.model,config:{context_length:8192}}]}]}));
  if(req.url==='/v1/chat/completions'){let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{received=JSON.parse(raw);res.end('data: '+JSON.stringify({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:4}})+'\n\ndata: [DONE]\n\n');});return;}
  res.writeHead(404).end();
 });
 const c=providerConfig(base,'lmstudio');c.providers.small.reasoningEffort='none';
 const r=await getProvider(c).generate({system:'',prompt:'Return JSON',schema:{type:'object'}});
 assert.equal(received.reasoning_effort,'none');assert.equal(r.metrics.runtimeContext,8192);assert.equal(r.metrics.context,4096);assert.equal(r.metrics.workerId,'coordinator');
 assert.equal(r.metrics.modelDigest,null);
});

test('LM Studio refuses advertised loaded context smaller than request budget',async t=>{
 const base=await server(t,(req,res)=>res.end(JSON.stringify(req.url==='/v1/models'?{data:[{id:profile.model}]}:{models:[{loaded_instances:[{id:profile.model,config:{context_length:2048}}]}]})));
 await assert.rejects(getProvider(providerConfig(base,'lmstudio')).describe(),/below configured/);
});

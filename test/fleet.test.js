import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { sshFetch,sshArgs,validateWorker } from '../src/fleet/ssh.js';
const worker={host:'192.168.1.20',user:'worker'};
const source=await readFile(new URL('../tools/worker_relay.py',import.meta.url),'utf8');
const localRelay=()=>spawn(process.env.WM_PYTHON??'python3',['-u','-c',source],{stdio:['pipe','pipe','ignore']});
async function server(t,handler){const s=http.createServer(handler);await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>{s.closeAllConnections();s.close();});return `http://127.0.0.1:${s.address().port}`;}
test('fleet SSH restricts destination and prevents shell and SSH option injection',()=>{
 for(const patch of [{host:'example.com'},{host:'8.8.8.8'},{host:'127.0.0.1'},{host:'-oProxyCommand=anything'},{user:'x;echo secret'},{port:0}])assert.throws(()=>validateWorker('mac48',{...worker,...patch}));
 for(const label of ['coordinator','192.168.1.20','x@y','../worker'])assert.throws(()=>validateWorker(label,worker));
 const args=sshArgs('mac48',worker,"print('ok')");
 assert.ok(args.includes('StrictHostKeyChecking=yes'));assert.ok(args.includes('BatchMode=yes'));
 assert.ok(args.includes('ForwardAgent=no'));assert.ok(args.includes('/dev/null'));assert.equal(args.at(-2),worker.host);
});
test('real Python relay streams bounded runtime output and provides worker snapshots',async t=>{
 const base=await server(t,(_req,res)=>{res.setHeader('content-type','application/json');res.write('{"ok":');setTimeout(()=>res.end('true}'),20);});
 const response=await sshFetch('mac48',worker,base+'/api/chat',{method:'POST',body:'{}',sampleResources:true},{launch:localRelay,source});
 assert.deepEqual(await response.json(),{ok:true});
 assert.equal(typeof response.workerResources.before.serverRssBytes,'number');
 assert.equal(typeof response.workerResources.after.serverRssBytes,'number');
 assert.equal(response.workerResources.before.acceleratorAllocationMeasured,false);
});
test('relay rejects redirects and unsupported operations without contacting destinations',async t=>{
 let hits=0;const dest=await server(t,(_req,res)=>{hits++;res.end('{}');});
 const base=await server(t,(_req,res)=>res.writeHead(302,{location:dest}).end());
 await assert.rejects(sshFetch('mac48',worker,base+'/api/tags',{}, {launch:localRelay,source}),/unavailable/);
 await assert.rejects(sshFetch('mac48',worker,dest+'/api/pull',{method:'POST',body:'{}'}, {launch:localRelay,source}),/unavailable/);
 assert.equal(hits,0);
});
test('relay cancellation terminates an incomplete response instead of reporting success',async t=>{
 const base=await server(t,(_req,res)=>{res.writeHead(200);res.write('partial');});
 const ctl=new AbortController();
 const response=await sshFetch('mac48',worker,base+'/api/chat',{method:'POST',body:'{}',signal:ctl.signal},{launch:localRelay,source});
 const result=response.text();ctl.abort();await assert.rejects(result,/cancelled|interrupted/);
});
test('unavailable SSH retains no fabricated usage or remote resource values',async()=>{
 const failed=()=>spawn(process.execPath,['-e','process.exit(255)'],{stdio:['pipe','pipe','ignore']});
 await assert.rejects(sshFetch('mac48',worker,'http://127.0.0.1:11434/api/tags',{}, {launch:failed,source}),/worker unavailable/);
});

test('deadline rejects and reaps a stalled child that ignores SIGTERM',async()=>{
 let child;
 const stalled=()=>child=spawn(process.execPath,['-e',`process.on('SIGTERM',()=>{});process.stdout.write(JSON.stringify({type:'headers',status:200})+'\\n');setInterval(()=>{},1000);`],{stdio:['pipe','pipe','ignore']});
 const start=Date.now();
 const response=await sshFetch('mac48',worker,'http://127.0.0.1:11434/api/tags',{timeoutMs:150},{launch:stalled,source});
 await assert.rejects(response.text(),/deadline/);
 assert.ok(Date.now()-start<2000,'Deadline plus bounded termination grace');
 assert.equal(child.signalCode,'SIGKILL');assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
});

test('cancellation rejects while awaiting SSH exit after a complete end frame',async()=>{
 let child;
 const stalled=()=>child=spawn(process.execPath,['-e',`process.on('SIGTERM',()=>{});process.stdout.write(JSON.stringify({type:'headers',status:200})+'\\n'+JSON.stringify({type:'end'})+'\\n');setInterval(()=>{},1000);`],{stdio:['pipe','pipe','ignore']});
 const ctl=new AbortController();const response=await sshFetch('mac48',worker,'http://127.0.0.1:11434/api/tags',{signal:ctl.signal},{launch:stalled,source});
 const body=response.text();setTimeout(()=>ctl.abort(),20);await assert.rejects(body,/cancelled/);
 assert.equal(child.signalCode,'SIGKILL');assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
});

test('missing-newline SSH output is rejected at the raw frame bound',async()=>{
 let child;
 const noisy=()=>child=spawn(process.execPath,['-e',`process.on('SIGTERM',()=>{});process.stdout.write('x'.repeat(12001));setInterval(()=>{},1000);`],{stdio:['pipe','pipe','ignore']});
 await assert.rejects(sshFetch('mac48',worker,'http://127.0.0.1:11434/api/tags',{timeoutMs:5000},{launch:noisy,source}),/frame too large/);
 assert.equal(child.signalCode,'SIGKILL');assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
});

test('deadline cleans up an unconsumed response without an unhandled rejection',async()=>{
 let child;
 const stalled=()=>child=spawn(process.execPath,['-e',`process.on('SIGTERM',()=>{});process.stdout.write(JSON.stringify({type:'headers',status:200})+'\\n');setInterval(()=>{},1000);`],{stdio:['pipe','pipe','ignore']});
 await sshFetch('mac48',worker,'http://127.0.0.1:11434/api/tags',{timeoutMs:150},{launch:stalled,source});
 await new Promise(resolve=>child.once('close',resolve));
 assert.equal(child.signalCode,'SIGKILL');assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
});

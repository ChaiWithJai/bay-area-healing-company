import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
async function setup(t){const root=await mkdtemp(join(tmpdir(),'wm-engine-process-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
function child(t,root,worker,id){const p=fork(fileURLToPath(new URL('./support/lease-workflow-child.mjs',import.meta.url)),[root,worker,id],{stdio:['ignore','ignore','ignore','ipc']});t.after(()=>{if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');});return p;}
function next(p){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('IPC deadline')),5000);p.once('message',m=>{clearTimeout(timer);resolve(m);});});}
function exited(p){return new Promise(resolve=>{if(p.exitCode!==null||p.signalCode!==null)resolve();else p.once('exit',resolve);});}
test('actual workflow processes overlap on different worker leases',async t=>{
 const root=await setup(t),a=child(t,root,'mac48','run-a');assert.equal((await next(a)).type,'request-started');
 const b=child(t,root,'gb10','run-b');assert.equal((await next(b)).type,'request-started');
 const x=next(a),y=next(b);a.send('finish');b.send('finish');assert.ok((await x).passed);assert.ok((await y).passed);await Promise.all([exited(a),exited(b)]);
});
test('actual workflow processes serialize model requests on one worker',async t=>{
 const root=await setup(t),a=child(t,root,'mac48','run-a');assert.equal((await next(a)).type,'request-started');
 const b=child(t,root,'mac48','run-b');let began=false;const waiting=next(b).then(m=>{began=true;return m;});await new Promise(r=>setTimeout(r,120));assert.equal(began,false);
 const doneA=next(a);a.send('finish');assert.ok((await doneA).passed);assert.equal((await waiting).type,'request-started');const doneB=next(b);b.send('finish');assert.ok((await doneB).passed);await Promise.all([exited(a),exited(b)]);
});

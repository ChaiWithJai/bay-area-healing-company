import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPromptBudget,getProvider } from '../src/providers/index.js';
import { DEFAULT_CONFIG } from '../src/config.js';
test('UTF-8 context guard reserves output and template overhead',()=>{
 const profile={context:4096,maxTokens:1024};assert.ok(checkPromptBudget(profile,{system:'JSON',prompt:'source',schema:{type:'object'}}).contentBytes>0);
 assert.throws(()=>checkPromptBudget(profile,{system:'',prompt:'界'.repeat(800),schema:{}}),/context budget/);
 assert.throws(()=>checkPromptBudget(profile,{system:'',prompt:'source',maxTokens:4096}),/context budget/);
});
test('oversized context is rejected before contacting even a local runtime',async()=>{
 const c=structuredClone(DEFAULT_CONFIG);c.providers.bonsai8.baseUrl='http://127.0.0.1:1';
 await assert.rejects(getProvider(c,'bonsai8').generate({system:'',prompt:'界'.repeat(800),schema:{}}),/No request dispatched/);
});

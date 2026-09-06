import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readSources } from '../src/documents.js';
import { prepareWorkflow, validateWorkItem, finalizeWorkflow } from '../src/domain/index.js';

const names=['volunteer_hours_reconciliation','case_note_normalization','board_report_synthesis','grant_cycle_package','stewardship_structuring'];
async function fixture(name,index=1){const root=resolve('fixtures/tasks',`${name}-${String(index).padStart(2,'0')}`);return {root,...await prepareWorkflow(`nonprofit/${name}`,join(root,'inputs'))};}
async function out(t){const dir=await realpath(await mkdtemp(join(tmpdir(),'wm-domain-')));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
// These deterministic responses test domain logic only. They are not model benchmarks.
async function responses(p){const result={};const reference=JSON.parse(await readFile(join(p.root,'reference.json'),'utf8'));
 for(const i of p.items){
  if(i.family==='participation_extract')result[i.id]={records:i.sourceText.split('\n').filter(s=>/^PERSON-/.test(s)).map(quote=>{const [person_id,shift_id,hours]=quote.trim().split(/\s+/);return {person_id,shift_id,hours:Number(hours),quote};})};
  else if(i.family==='case_extract'){const r=reference.records.find(r=>r.note_id===i.noteId);result[i.id]={date:r.date,service:r.service,outcome:r.outcome,quote:i.sourceText.split('\nName:')[0].trim()};}
  else if(i.family==='board_evidence')result[i.id]={quote:i.sourceText.split('\n').find(s=>s.startsWith(i.quarter+' '))??'',reason:'Test source selection'};
  else if(i.family==='grant_evidence'){const idx=Number(i.id.slice(1))-1;result[i.id]={quote:i.sourceText.trim().split('\n')[idx]??'',reason:'Test source selection'};}
  else result[i.id]={quote:i.sourceText.split('\n').find(s=>s.startsWith(i.option+':'))??'',reason:'Test source selection'};
 }
 return result;
}

for(const name of names)test(`${name}: valid sources and controlled model results produce complete native artifacts`,async t=>{
 const p=await fixture(name);assert.deepEqual(p.context.problems,[]);const values=await responses(p);
 for(const i of p.items)assert.deepEqual(validateWorkItem(i,values[i.id],p.context).pass,true,`${i.id}: ${JSON.stringify(validateWorkItem(i,values[i.id],p.context))}`);
 const directory=await out(t);const finished=await finalizeWorkflow(`nonprofit/${name}`,p.context,values,directory);
 assert.ok(finished.gates.every(g=>g.pass),JSON.stringify(finished.gates));assert.ok(finished.artifacts.every(a=>a.sha256&&a.bytes>0));
 if(name==='volunteer_hours_reconciliation'){assert.match(await readFile(join(directory,'output/funder_rollup.tsv'),'utf8'),/accepted_hours\t9/);assert.equal(finished.reviewRequired,false);}
 if(name==='case_note_normalization'){assert.equal((await readSources(directory)).sources.find(s=>s.path.endsWith('normalized_cases.tsv')).tables.sheets[0].rows.length,40);assert.doesNotMatch(await readFile(join(directory,'output/normalized_cases.tsv'),'utf8'),/example.invalid|Synthetic Person/);}
 if(name==='stewardship_structuring')assert.equal(finished.reviewRequired,true);
});

test('missing model results never constitute complete execution',async t=>{const p=await fixture(names[0]);const result=await finalizeWorkflow(p.context.id,p.context,{},await out(t));assert.equal(result.gates.find(g=>g.id==='model_work_complete').pass,false);assert.equal(result.reviewRequired,true);});
test('participation conflicts are surfaced and excluded from totals',async t=>{const p=await fixture(names[0],2);const d=await out(t);const r=await finalizeWorkflow(p.context.id,p.context,await responses(p),d);assert.ok(r.gates.every(g=>g.pass));assert.equal(r.reviewRequired,true);assert.match(await readFile(join(d,'output/funder_rollup.tsv'),'utf8'),/accepted_hours\t6/);assert.match(await readFile(join(d,'output/conflicts.tsv'),'utf8'),/PERSON-B.*conflict/);});
test('fabricated scan values and omitted rows fail verification',async()=>{const p=await fixture(names[0]);const vals=await responses(p);const i=p.items[0];vals[i.id].records[0].hours=19;assert.equal(validateWorkItem(i,vals[i.id],p.context).pass,false);const correct=await responses(p);correct[i.id].records.pop();assert.equal(validateWorkItem(i,correct[i.id],p.context).pass,false);});
test('case PII and unsupported values fail before rendering',async()=>{const p=await fixture(names[1]);const i=p.items[0];const v=(await responses(p))[i.id];assert.equal(validateWorkItem(i,{...v,outcome:'invented outcome'},p.context).pass,false);assert.equal(validateWorkItem(i,{...v,email:'person1@example.invalid'},p.context).pass,false);assert.equal(validateWorkItem(i,{...v,quote:i.sourceText},p.context).pass,false);});
test('missing case fields are explicit exceptions with full note coverage',async t=>{const p=await fixture(names[1],3);const d=await out(t);const r=await finalizeWorkflow(p.context.id,p.context,await responses(p),d);assert.ok(r.gates.every(g=>g.pass));assert.equal(r.reviewRequired,true);assert.match(await readFile(join(d,'output/exceptions.tsv'),'utf8'),/N040\tmissing_required_field/);});
test('board narrative disagreement with metrics fails independently of source citation',async t=>{const p=await fixture(names[2],2);const r=await finalizeWorkflow(p.context.id,p.context,await responses(p),await out(t));assert.equal(r.gates.find(g=>g.id==='narrative_numbers_supported').pass,false);});
test('restricted grant charges and missing evidence fail closed',async t=>{for(const index of [2,3]){const p=await fixture(names[3],index);const r=await finalizeWorkflow(p.context.id,p.context,await responses(p),await out(t));assert.ok(r.gates.some(g=>!g.pass));assert.equal(r.reviewRequired,true);}});
test('irrelevant but exact grant quotes do not satisfy requirement subjects',async()=>{const p=await fixture(names[3]);const vals=await responses(p);assert.equal(validateWorkItem(p.items[0],vals.R2,p.context).pass,false);});
test('all thirty tasks have separated inputs and unreviewed synthetic references',async()=>{const c=JSON.parse(await readFile('fixtures/catalog.json','utf8'));assert.equal(c.length,30);for(const n of names){const selected=c.filter(x=>x.workflow_id===`nonprofit/${n}`);assert.equal(selected.filter(x=>x.split==='heldout').length,3);assert.equal(selected.filter(x=>x.split==='development').length,3);}assert.ok(c.every(x=>x.provenance.review_status==='generated_unreviewed'&&x.provenance.type==='synthetic'));});

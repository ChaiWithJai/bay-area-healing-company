import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeWorkflow, validateWorkItem, prepareWorkflow } from '../src/domain/index.js';

async function output(t){const directory=await realpath(await mkdtemp(join(tmpdir(),'wm-adversarial-')));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
const context=(items,extra={})=>({problems:[],items,sources:[],...extra});
const item=(id,family,text,extra={})=>({id,family,sourceText:text,sourceIds:['source-'+id],...extra});

// Requirement-level adversarial tests. These deliberately exercise valid-looking,
// source-grounded outputs that still violate the user's original task contract.
test('case target schema new required field cannot be silently discarded',async t=>{
  const row=item('case-1','case_extract','2026-09-01 Coaching completed',{noteId:'N1'});
  const c=context([row],{policy:{prohibited_fields:[]},target:{fields:['note_id','date','service','outcome','location','source_id','quote'],required:['date','service','outcome','location'],expected_notes:1}});
  const directory=await output(t);
  const result=await finalizeWorkflow('nonprofit/case_note_normalization',c,{'case-1':{date:'2026-09-01',service:'Coaching',outcome:'completed',quote:row.sourceText}},directory);
  const exceptions=await readFile(join(directory,'output/exceptions.tsv'),'utf8');
  assert.ok(result.gates.some(g=>!g.pass)||exceptions.includes('N1'),'Missing required location must block or create an exception');
});

test('two scanned pages do not constitute two independent source types',async t=>{
  const text='PERSON-A SHIFT-1 2';
  const items=[item('page-1','participation_extract',text),item('page-2','participation_extract',text)];
  const c=context(items,{scheduler:[],self:[],metric:{accepted_hours:'Sum only uncontested hours with at least two source types',unit:'hours'}});
  const responses=Object.fromEntries(items.map(i=>[i.id,{records:[{person_id:'PERSON-A',shift_id:'SHIFT-1',hours:2,quote:text}]}]));
  const directory=await output(t);
  await finalizeWorkflow('nonprofit/volunteer_hours_reconciliation',c,responses,directory);
  const rollup=await readFile(join(directory,'output/funder_rollup.tsv'),'utf8');
  assert.match(rollup,/accepted_hours\t0(?:\r?\n|$)/,'Duplicate scans must not inflate corroboration');
});

test('changed funder metric rule cannot be ignored with a passing run',async t=>{
  const text='PERSON-A SHIFT-1 2',i=item('page-1','participation_extract',text);
  const record={person_id:'PERSON-A',shift_id:'SHIFT-1',hours:2};
  const c=context([i],{scheduler:[record],self:[],metric:{accepted_hours:'Count hours only when all three source types agree',unit:'hours'}});
  const directory=await output(t);
  const result=await finalizeWorkflow('nonprofit/volunteer_hours_reconciliation',c,{[i.id]:{records:[{...record,quote:text}]}},directory);
  const rollup=await readFile(join(directory,'output/funder_rollup.tsv'),'utf8');
  assert.ok(result.gates.some(g=>!g.pass)||/accepted_hours\t0(?:\r?\n|$)/.test(rollup),'Unsupported or stricter metric rules must fail closed or be applied');
});

test('every reported board metric is present in the variance source of truth',async t=>{
  const items=[1,2,3,4].map(n=>item('q'+n,'board_evidence',`Q${n} served ${100+n} participants.`,{quarter:'Q'+n}));
  const c=context(items,{metrics:[1,2,3,4].map(n=>({quarter:'Q'+n,participants:100+n})),financials:[1,2,3,4].map(n=>({quarter:'Q'+n,category:'Services',budget:900,actual:950})),risks:[]});
  const responses=Object.fromEntries(items.map(i=>[i.id,{quote:i.sourceText,reason:'Evidence'}]));
  const directory=await output(t);
  const result=await finalizeWorkflow('nonprofit/board_report_synthesis',c,responses,directory);
  const variance=await readFile(join(directory,'output/variance.tsv'),'utf8');
  assert.ok([101,102,103,104].every(n=>variance.includes(String(n))),'Narrative numbers must trace to variance.tsv, not only another source');
});

test('stewardship timing must address first tax-deductible funds, not arbitrary timing',async t=>{
  const items=['Fiscal sponsorship','Standalone nonprofit'].map((option,n)=>item('option-'+n,'stewardship_evidence',`${option}: Meetings occur every two weeks.`,{option}));
  const c=context(items,{assets:[{id:'a',description:'Course',current_owner:'Founder',proposed_owner:'Host',consent_status:'documented'}],decisions:[{decision:'Funding oversight',authority:'Independent board',independent:true}],hosts:[]});
  const responses=Object.fromEntries(items.map(i=>[i.id,{quote:i.sourceText,reason:'Exact evidence'}]));
  const result=await finalizeWorkflow('nonprofit/stewardship_structuring',c,responses,await output(t));
  assert.equal(result.gates.find(g=>g.id==='timing_stated').pass,false,'Unrelated meeting cadence cannot satisfy time-to-first-tax-deductible-dollar requirement');
});

test('present required case fields cannot be converted to valid missing-data exceptions',()=>{
  const text='Date: 2026-09-01\nService: Coaching\nOutcome: completed\nName: Private Person\nEmail: private@example.invalid';
  const i=item('case','case_extract',text,{noteId:'N1'});
  const c=context([i],{target:{fields:['note_id','date','service','outcome','source_id','quote'],required:['date','service','outcome']},policy:{prohibited_fields:['name','email']}});
  const omitted={date:'',service:'Coaching',outcome:'completed',quote:'Service: Coaching\nOutcome: completed'};
  assert.equal(validateWorkItem(i,omitted,c).pass,false);
  assert.equal(validateWorkItem(i,{...omitted,date:'2026-09-01',quote:text.split('\nName:')[0]},c).pass,true);
});

test('source-absent case outcome stays a valid exception instead of inventing a value',()=>{
  const text='Date: 2026-09-01\nService: Coaching\nOutcome: \nName: Private Person';
  const i=item('case','case_extract',text,{noteId:'N1'});
  const c=context([i],{target:{fields:['note_id','date','service','outcome','source_id','quote'],required:['date','service','outcome']},policy:{prohibited_fields:['name']}});
  assert.equal(validateWorkItem(i,{date:'2026-09-01',service:'Coaching',outcome:'',quote:'Date: 2026-09-01\nService: Coaching'},c).pass,true);
});

test('extra risk in prior PDF cannot silently vanish from the current register',async t=>{
  const items=[1,2,3,4].map(n=>item('q'+n,'board_evidence',`Q${n} served ${100+n} participants.`,{quarter:'Q'+n}));
  const c=context(items,{metrics:[1,2,3,4].map(n=>({quarter:'Q'+n,participants:100+n})),financials:[1,2,3,4].map(n=>({quarter:'Q'+n,category:'Services',budget:900,actual:950})),risks:[{id:'RISK-A',description:'Existing risk',status:'open'}],priorPacket:{text:'RISK-A: Existing risk\nRISK-B: Risk omitted from supplied sidecar'}});
  const responses=Object.fromEntries(items.map(i=>[i.id,{quote:i.sourceText,reason:'Evidence'}]));
  const result=await finalizeWorkflow('nonprofit/board_report_synthesis',c,responses,await output(t));
  assert.equal(result.gates.find(g=>g.id==='prior_packet_reconciled').pass,false);
});

test('founder cannot declare own funding authority independent',async t=>{
  const items=['Fiscal sponsorship','Standalone nonprofit'].map((option,n)=>item('option-'+n,'stewardship_evidence',`${option}: First tax-deductible funds arrive in 30 days. Reversibility requires consent. Succession rests with Alice Founder.`,{option}));
  const c=context(items,{assets:[{id:'a',description:'Course',proposed_owner:'Host'}],decisions:[{decision:'Funding oversight',authority:'Alice Founder',independent:true}],contributors:[{contributor:'Alice Founder',role:'Founder'}],hosts:[],fundingIntent:{id:'intent',text:'Exclude private founder benefit.'}});
  const responses=Object.fromEntries(items.map(i=>[i.id,{quote:i.sourceText,reason:'Evidence'}]));
  const result=await finalizeWorkflow('nonprofit/stewardship_structuring',c,responses,await output(t));
  assert.equal(result.gates.find(g=>g.id==='independent_oversight').pass,false);
});

test('missing founder exclusion cannot be invented by a static fund policy template',async t=>{
  const c=context([],{assets:[],decisions:[],contributors:[],hosts:[],fundingIntent:{id:'intent',text:'Fund community work.'}});
  const result=await finalizeWorkflow('nonprofit/stewardship_structuring',c,{},await output(t));
  assert.equal(result.gates.find(g=>g.id==='founder_benefit_excluded').pass,false);
});

test('PII policy prohibited values cannot leak through the evidence quote',()=>{
  const text='Date: 2026-09-01\nService: Coaching\nAddress: 42 Private Street\nOutcome: completed';
  const i=item('case','case_extract',text,{noteId:'N1'});
  const c=context([i],{target:{fields:['date','service','outcome','quote'],required:['date','service','outcome']},policy:{prohibited_fields:['address']}});
  assert.equal(validateWorkItem(i,{date:'2026-09-01',service:'Coaching',outcome:'completed',quote:text},c).pass,false);
});

test('grant annual-return contradiction and unimplemented restrictions fail closed',async t=>{
  const i=item('R1','grant_evidence','Annual revenue 999.',{requirement:'R1: Report annual revenue.'});
  const c=context([i],{requirements:['R1: Report annual revenue.'],budget:[{category:'program',fund:'restricted',amount:100}],rules:{expected_total:100,unrestricted_only:[],currency:'USD',new_funder_rule:'Requires separate approval'},annualReturn:{text:'Revenue 250000; program expenses 210000.'}});
  const result=await finalizeWorkflow('nonprofit/grant_cycle_package',c,{R1:{quote:i.sourceText,reason:'Evidence'}},await output(t));
  assert.equal(result.gates.find(g=>g.id==='annual_return_consistent').pass,false);
  assert.equal(result.gates.find(g=>g.id==='restriction_schema_supported').pass,false);
});

test('case requests minimize labeled PII while original evidence remains authoritative',async t=>{
  const directory=await output(t);await mkdir(join(directory,'notes_raw'));
  const source='Date: 2026-09-01\nService: Coaching\nOutcome: completed\nName: Private Person\nEmail: private@example.invalid\nAddress: 42 Private Street';
  await writeFile(join(directory,'notes_raw','N1.txt'),source);
  await writeFile(join(directory,'target_schema.json'),JSON.stringify({fields:['note_id','date','service','outcome','source_id','quote'],required:['date','service','outcome']}));
  await writeFile(join(directory,'pii_policy.json'),JSON.stringify({prohibited_fields:['name','email','address']}));
  const plan=await prepareWorkflow('nonprofit/case_note_normalization',directory),i=plan.items[0];
  assert.equal(i.sourceText,source);
  for(const privateValue of ['Private Person','private@example.invalid','42 Private Street'])assert.equal(i.prompt.includes(privateValue),false);
  assert.match(i.prompt,/Date: 2026-09-01\nService: Coaching\nOutcome: completed/);
  const clean=source.split('\nName:')[0];
  assert.equal(validateWorkItem(i,{date:'2026-09-01',service:'Coaching',outcome:'completed',quote:clean},plan.context).pass,true);
  assert.equal(validateWorkItem(i,{date:'2026-09-01',service:'Coaching',outcome:'completed',quote:source},plan.context).pass,false);
});

test('PII redaction does not join discontiguous allowed fields into fabricated evidence',async t=>{
  const directory=await output(t);await mkdir(join(directory,'notes_raw'));
  const source='Date: 2026-09-01\nName: Private Person\nService: Coaching\nOutcome: completed';
  await writeFile(join(directory,'notes_raw','N1.txt'),source);
  await writeFile(join(directory,'target_schema.json'),JSON.stringify({fields:['date','service','outcome','quote'],required:['date','service','outcome']}));
  await writeFile(join(directory,'pii_policy.json'),JSON.stringify({prohibited_fields:['name']}));
  const plan=await prepareWorkflow('nonprofit/case_note_normalization',directory),i=plan.items[0];
  assert.match(i.prompt,/Date: 2026-09-01\n\[REDACTED PROHIBITED FIELD\]\nService: Coaching/);
  assert.equal(validateWorkItem(i,{date:'2026-09-01',service:'Coaching',outcome:'completed',quote:'Date: 2026-09-01\nService: Coaching\nOutcome: completed'},plan.context).pass,false);
});

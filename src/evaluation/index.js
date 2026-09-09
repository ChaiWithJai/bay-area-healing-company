import { readFile, writeFile, mkdir, rename, open, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT } from '../config.js';
import { runWorkflow } from '../engine/runner.js';
import { findWorkflow } from '../workflows/registry.js';
import { RunStore, summarizeUsage } from '../observability/index.js';
import { readSources } from '../documents.js';
export const RUBRIC_VERSION='2.2.0';
const catalogPath=path.join(ROOT,'fixtures/catalog.json');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const safeId=x=>{if(typeof x!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(x))throw new Error('Invalid campaign ID');return x;};
export { sourceCodeDigest } from '../provenance.js';
import { sourceCodeDigest } from '../provenance.js';

async function atomic(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${randomUUID()}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,file);}
function objectRows(source){return (source?.tables?.sheets??[]).flatMap(s=>s.rows.map(r=>Array.isArray(r)?Object.fromEntries(s.headers.map((h,i)=>[h,r[i]])):r));}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function close(a,b){return Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<0.000001;}

/** Independent output/reference comparison. Never uses result.passed or structural score as an oracle. */
export async function gradeArtifacts({task,reference,result,config}) {
 const checks=[];const check=(id,pass,detail)=>checks.push({id,pass:Boolean(pass),detail});
 let sources=[];
 if(result?.artifactDir){try{const read=await readSources(result.artifactDir,config);sources=read.sources;check('readable_artifacts',read.errors.length===0,JSON.stringify(read.errors));}catch(error){check('readable_artifacts',false,error.message);}}
 else check('readable_artifacts',false,'No artifact directory');
 const src=name=>sources.find(s=>path.basename(s.path)===name);
 const table=name=>objectRows(src(name));
 const evidence=src('evidence.json');let evidenceRows=[];try{evidenceRows=JSON.parse(evidence?.text??'[]');}catch{}
 const expectedNoInferenceSource=task.workflow_id.endsWith('volunteer_hours_reconciliation')&&task.variant==='missing'&&Boolean(evidence)&&result?.gateResults?.some(g=>g.id==='inputs_readable'&&!g.pass&&/scanned sign-ins|self_reported/.test(g.detail));
 check('model_evidence_present',evidenceRows.length>0||expectedNoInferenceSource,expectedNoInferenceSource?'Missing required inference source explicitly flagged; empty evidence artifact retained':'Accepted model evidence must be retained');
 const ordinary=task.variant==='ordinary';let expectedReview=!ordinary||task.workflow_id.endsWith('stewardship_structuring');
 let completedDeliverable=false;
 if(task.workflow_id.endsWith('volunteer_hours_reconciliation')){
  const ledger=table('hours_ledger.tsv'),conflicts=table('conflicts.tsv'),rollup=Object.fromEntries(table('funder_rollup.tsv').map(r=>[r.metric,Number(r.value)]));
  check('accepted_hours_reference',close(rollup.accepted_hours,reference.accepted_hours),`Expected ${reference.accepted_hours}, observed ${rollup.accepted_hours}`);
  if(task.variant!=='missing')check('conflict_count_reference',conflicts.length===reference.conflict_count,`${conflicts.length} surfaced conflicts`);
  check('no_duplicate_shifts',ledger.length>0&&new Set(ledger.map(r=>r.person_id+'|'+r.shift_id)).size===ledger.length,'Each person/shift appears once');
  check('ledger_total_matches_rollup',close(ledger.filter(r=>r.status==='accepted').reduce((s,r)=>s+Number(r.hours),0),rollup.accepted_hours),'Artifact ledger reconciles to rollup');
  if(ordinary)check('ordinary_not_exception_only',ledger.every(r=>r.status==='accepted')&&ledger.length===reference.ordinary_shift_count,'Normal case must reconcile all expected shifts');
  completedDeliverable=task.variant!=='missing';
 } else if(task.workflow_id.endsWith('case_note_normalization')){
  const rows=table('normalized_cases.tsv'),exceptions=table('exceptions.tsv');
  const all=[...rows.map(r=>r.note_id),...exceptions.map(r=>r.note_id)];
  check('exact_note_coverage',all.length===reference.records.length&&new Set(all).size===all.length&&reference.records.every(r=>all.includes(r.note_id)),'Each reference note appears exactly once');
  for(const ref of reference.records){const row=rows.find(r=>r.note_id===ref.note_id);const exc=exceptions.find(r=>r.note_id===ref.note_id);check(`note_${ref.note_id}`,ref.exception?Boolean(exc)&&!row:Boolean(row)&&!exc&&['date','service','outcome'].every(k=>row[k]===ref[k]),ref.exception?'Expected explicit exception':'Exact reference fields required');}
  check('no_contact_pii',!/@example\.invalid|Synthetic Person/.test(src('normalized_cases.tsv')?.text??''),'Known fixture PII excluded');
  completedDeliverable=exceptions.length===0&&rows.length===reference.records.length;
 } else if(task.workflow_id.endsWith('board_report_synthesis')){
  const allVariance=table('variance.tsv'),rows=allVariance.filter(r=>!r.record_type||r.record_type==='financial'),risks=table('risk_register_diff.tsv'),packet=src('board_packet.pdf');
  check('all_variances_match',rows.length===reference.variance_rows.length&&reference.variance_rows.every(r=>rows.some(v=>v.quarter===r[0]&&v.category===r[1]&&close(v.budget,r[2])&&close(v.actual,r[3])&&close(v.variance,r[4]))),'All quarter budgets, actuals and variances match reference');
  const taskInputs=await readSources(path.join(ROOT,'fixtures/tasks',task.id,'inputs'),config);const metricSource=taskInputs.sources.find(s=>path.basename(s.path)==='metrics_q1_q4.csv');const expectedMetrics=objectRows(metricSource);
  check('metric_variance_trace',expectedMetrics.every(m=>Object.entries(m).filter(([k])=>k!=='quarter').every(([key,value])=>allVariance.some(r=>r.record_type==='metric'&&r.quarter===m.quarter&&r.category===key&&close(r.actual,value)))),'Every source metric appears in variance.tsv');
  check('all_prior_risks_retained',eq(risks.map(r=>r.risk_id).sort(),[...reference.risk_ids].sort())&&risks.every(r=>r.change==='retained'||r.reason),'No reference risk silently disappears');
  check('native_board_packet',packet?.kind==='pdf'&&packet.text.length>30,'Readable PDF board packet required');
  if(ordinary)check('quarter_evidence_complete',evidenceRows.length===4&&evidenceRows.every(r=>r.value?.quote),'Four nonempty model-selected quarter explanations');
  if(task.variant==='conflict')check('contradiction_flagged',result?.gateResults?.some(g=>g.id==='narrative_numbers_supported'&&!g.pass)&&result?.reviewRequired,'Known narrative contradiction must be explicitly flagged');
  if(task.variant==='missing')check('missing_quarter_flagged',result?.gateResults?.some(g=>g.id==='quarter_explanations_complete'&&!g.pass)&&result?.reviewRequired,'Missing quarter explanation must be explicitly flagged');
  completedDeliverable=ordinary;
 } else if(task.workflow_id.endsWith('grant_cycle_package')){
  const cross=table('compliance_crosswalk.tsv'),budget=table('budget.xlsx');
  check('requirement_coverage',eq(cross.map(r=>r.requirement_id).sort(),[...reference.requirement_ids].sort()),'Exactly the reference requirement IDs');
  const total=budget.find(r=>r.category==='TOTAL');check('reference_budget_total',close(total?.amount,reference.budget_total),'Native budget total matches reference');
  check('native_narrative',src('narrative.docx')?.kind==='docx'&&src('narrative.docx').text.length>20,'Readable DOCX narrative');
  if(ordinary)check('all_requirements_supported',cross.every(r=>r.status==='supported'&&r.quote&&r.source_id),'Normal case cannot pass with exception-only evidence');
  if(task.variant==='missing')check('missing_evidence_flagged',cross.some(r=>r.status==='missing')&&result?.reviewRequired,'Missing evidence is explicit in the crosswalk');
  if(task.variant==='conflict')check('restriction_violation_flagged',budget.filter(r=>r.category==='administration'&&r.fund==='restricted').length===reference.forbidden_charges&&result?.gateResults?.some(g=>g.id==='restricted_funds_compliant'&&!g.pass)&&result?.reviewRequired,'Known prohibited allocation is preserved and flagged');
  completedDeliverable=ordinary;
 } else if(task.workflow_id.endsWith('stewardship_structuring')){
  const inv=table('ip_transfer_inventory.tsv'),governance=table('governance_matrix.tsv');
  check('asset_inventory_reference',eq(inv.map(r=>r.asset_id).sort(),[...reference.asset_ids].sort()),'Exactly the reference assets');
  check('unresolved_assets_reference',inv.filter(r=>!r.proposed_owner||r.consent_status!=='documented').length===reference.unresolved_assets,'Known unresolved ownership or consent tracked');
  check('independent_oversight',governance.some(r=>r.independent==='yes'&&r.authority&&/oversight|spend|fund/i.test(r.decision)),'Independent party named');
  const intent=await readFile(path.join(ROOT,'fixtures/tasks',task.id,'inputs/funding_intent.md'),'utf8');
  const exclusionClauses=intent.split(/[.\n]+/).map(s=>s.trim()).filter(s=>/^(?:Exclude|Prohibit)\s+(?:private\s+)?founder\s+benefit$/i.test(s)||/^Founder benefit is excluded$/i.test(s));
  const policyText=src('fund_use_policy.md')?.text??'';
  check('founder_exclusion',exclusionClauses.length>0&&exclusionClauses.some(clause=>policyText.split(/[.\n]+/).some(line=>line.trim().toLowerCase()===clause.toLowerCase())),'Explicit source-backed founder-benefit prohibition retained; merely mentioning missing exclusion is insufficient');
  check('human_decision_handoff',result?.reviewRequired===true&&/no ownership transfer/i.test(src('structuring_memo.md')?.text??''),'Packet does not enact a legal transaction');
  if(ordinary)check('both_options_grounded',evidenceRows.length===2&&evidenceRows.every(r=>r.value?.quote),'Both alternatives require model-selected evidence');
  completedDeliverable=task.variant!=='missing';
 } else check('known_reference_workflow',false,'No independent grader for this workflow');
 if(expectedReview)check('review_handoff_present',result?.reviewRequired===true||['blocked','cancelled'].includes(result?.status),'Expected issue must produce a visible review handoff');
 const passed=checks.length>0&&checks.every(c=>c.pass);
 return {passed,rubricVersion:RUBRIC_VERSION,referenceScore:checks.filter(c=>c.pass).length/checks.length,checks,reviewStatus:reference.review_status,fixtureType:'synthetic',completedDeliverable:passed&&completedDeliverable,correctReviewOrAbstention:passed&&expectedReview,claim:'Generated fixture reference agreement; not expert qualification'};
}

export async function runEvaluation({config,campaignId,split='development',provider,repetitions=1,maxRuns=10,task,signal,onProgress=()=>{},execute=runWorkflow}){
 if(!['development','heldout'].includes(split))throw new Error('split must be development or heldout');
 if(!Number.isInteger(repetitions)||repetitions<1||repetitions>10)throw new Error('repetitions must be an integer from 1 to 10');
 if(!Number.isInteger(maxRuns)||maxRuns<1||maxRuns>100)throw new Error('maxRuns must be an integer from 1 to 100');
 if(provider&&provider!=='routed'&&(!config.providers[provider]||config.providers[provider].enabled===false))throw new Error('Unknown or disabled provider');
 const id=campaignId?safeId(campaignId):randomUUID();const directory=path.join(config.stateDir,'evaluations');await mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,`${id}.json`);
 const lockFile=path.join(directory,`${id}.lock`);let lock;
 try{lock=await open(lockFile,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid}));}catch(e){if(e.code==='EEXIST'){const owner=await json(lockFile);let live=true;try{process.kill(owner.pid,0);}catch(err){if(err.code==='ESRCH')live=false;}if(live)throw new Error('Evaluation campaign is already running');await unlink(lockFile);lock=await open(lockFile,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid}));}else throw e;}
 try{
 let campaign;try{campaign=await json(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 const catalog=await json(catalogPath);const codeDigest=await sourceCodeDigest();
 if(campaign){if(campaign.sourceCodeDigest!==codeDigest)throw new Error('Evaluation source code changed; create a new campaign');if(provider&&campaign.provider!==provider)throw new Error('Evaluation provider changed; create a new campaign');if(campaign.configDigest!==hash(config))throw new Error('Evaluation configuration changed; create a new campaign');}
 else {
  const selected=catalog.filter(t=>t.split===split&&(!task||t.id===task||t.workflow_id===task||t.workflow_id.endsWith('/'+task)));
  if(!selected.length)throw new Error('No tasks match the requested split and task');
  const profile=provider??config.defaultProvider;
  if(profile!=='routed'&&(!config.providers[profile]||config.providers[profile].enabled===false))throw new Error('Unknown or disabled provider');
  campaign={id,rubricVersion:RUBRIC_VERSION,sourceCodeDigest:codeDigest,createdAt:new Date().toISOString(),configDigest:hash(config),catalogDigest:hash(catalog),split,provider:profile,repetitions,reviewStatus:'generated_unreviewed',slots:selected.flatMap(t=>Array.from({length:repetitions},(_,i)=>({key:`${t.id}:${profile}:${i+1}`,taskId:t.id,profile,repetition:i+1,runId:randomUUID(),status:'pending'})))};
  await atomic(file,campaign);
 }
 if(campaign.catalogDigest!==hash(catalog))throw new Error('Task catalog changed; create a new campaign');
 let consumed=0;
 for(const slot of campaign.slots){
  if(signal?.aborted)break;
  if(slot.status==='finished'||consumed>=maxRuns)continue;
  const card=catalog.find(t=>t.id===slot.taskId);const taskRoot=path.join(ROOT,'fixtures/tasks',card.id);
  slot.status='running';slot.startedAt??=new Date().toISOString();await atomic(file,campaign);onProgress({campaignId:id,taskId:card.id,status:'running',runId:slot.runId});
  let result;
  try{const spec=await findWorkflow(config.workflowsDir,card.workflow_id);const executionConfig=slot.profile==='routed'?config:{...config,routing:{...config.routing,alternatives:[],families:{}}};
   if(execute===runWorkflow){const store=new RunStore(config.stateDir);try{const prior=store.getRun(slot.runId);if(prior&&['completed','blocked','cancelled'].includes(prior.status))result=prior.result??{runId:slot.runId,status:prior.status,reviewRequired:true};}finally{store.close();}}
   result??=await execute({spec,config:executionConfig,providerName:slot.profile==='routed'?undefined:slot.profile,inputDir:path.join(taskRoot,'inputs'),outputDir:config.outputDir,runId:slot.runId,signal,onProgress});}
  catch(error){slot.error=error.message;result={runId:slot.runId,status:'blocked',reviewRequired:true};}
  // The hidden reference is deliberately first loaded after execution returns or terminates.
  const reference=await json(path.join(taskRoot,'reference.json'));
  campaign.referenceDigests??={};const referenceDigest=hash(reference);if(campaign.referenceDigests[card.id]&&campaign.referenceDigests[card.id]!==referenceDigest)throw new Error('Reference changed during campaign; create a new campaign');campaign.referenceDigests[card.id]=referenceDigest;slot.referenceDigest=referenceDigest;
  slot.result={runId:result.runId,status:result.status,artifactDir:result.artifactDir,reviewRequired:result.reviewRequired};
  if(execute===runWorkflow){const store=new RunStore(config.stateDir);try{if(store.getRun(slot.runId))slot.usage=summarizeUsage(store,{runId:slot.runId});}finally{store.close();}}
  slot.grade=await gradeArtifacts({task:card,reference,result,config});slot.status='finished';slot.finishedAt=new Date().toISOString();consumed++;
  await atomic(file,campaign);onProgress({campaignId:id,taskId:card.id,status:'graded',passed:slot.grade.passed});
 }
 campaign.updatedAt=new Date().toISOString();campaign.status=campaign.slots.every(s=>s.status==='finished')?'completed':'paused';await atomic(file,campaign);
 return {...campaign,summary:summarize(campaign),batchRuns:consumed};
 }finally{await lock?.close();await unlink(lockFile).catch(()=>{});}
}
function summarize(c){const done=c.slots.filter(s=>s.status==='finished');return {total:c.slots.length,finished:done.length,pending:c.slots.length-done.length,referencePasses:done.filter(s=>s.grade?.passed).length,completedDeliverables:done.filter(s=>s.grade?.completedDeliverable).length,correctReviewOrAbstention:done.filter(s=>s.grade?.correctReviewOrAbstention).length,failed:done.filter(s=>!s.grade?.passed).length,reviewStatus:c.reviewStatus,accounting:{inferenceAttempts:done.reduce((n,s)=>n+(s.usage?.attempts??0),0),runsWithAccounting:done.filter(s=>s.usage).length,knownInferenceDurationMs:done.some(s=>s.usage?.metrics?.durationMs?.sum!=null)?done.reduce((n,s)=>n+(s.usage?.metrics?.durationMs?.sum??0),0):null,knownInputTokens:done.some(s=>s.usage?.tokensKnown?.input!=null)?done.reduce((n,s)=>n+(s.usage?.tokensKnown?.input??0),0):null,knownOutputTokens:done.some(s=>s.usage?.tokensKnown?.output!=null)?done.reduce((n,s)=>n+(s.usage?.tokensKnown?.output??0),0):null,denominator:'completedDeliverables counts independently reference-graded deliverables; resource sums include failed runs and repairs. Unknown metrics remain unavailable.'}};}
export async function evaluationReport(config,campaignId){const c=await json(path.join(config.stateDir,'evaluations',`${safeId(campaignId)}.json`));return {...c,summary:summarize(c)};}

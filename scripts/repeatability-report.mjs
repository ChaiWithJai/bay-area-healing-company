#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const safe=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)?value:'unknown';
function measured(records,key){
 const entries=records.map(r=>r.usage?.metrics?.[key]);
 const sums=entries.map(e=>e?.sum).filter(finite),known=entries.map(e=>e?.known).filter(finite),totals=entries.map(e=>e?.total).filter(finite);
 const sum=a=>a.reduce((a,b)=>a+b,0);
 const knownCount=known.length?sum(known):null,total=totals.length?sum(totals):null;
 return {sum:sums.length?sum(sums):null,known:knownCount,total,coverage:knownCount!==null&&total>0?knownCount/total:null,runsMissingMetricAccounting:entries.filter(e=>!e||!finite(e.known)||!finite(e.total)).length};
}
function summarize(records){
 const attempts=records.map(r=>r.usage?.attempts).filter(finite);
 return {runs:records.length,referencePasses:records.filter(r=>r.grade?.passed===true).length,referenceFailures:records.filter(r=>r.grade?.passed===false).length,unknownReferenceOutcomes:records.filter(r=>typeof r.grade?.passed!=='boolean').length,
  completedDeliverables:records.filter(r=>r.grade?.completedDeliverable===true).length,correctReviewOrAbstention:records.filter(r=>r.grade?.correctReviewOrAbstention===true).length,
  accounting:{attempts:attempts.length?attempts.reduce((a,b)=>a+b,0):null,runsWithAttemptAccounting:attempts.length,runsMissingAttemptAccounting:records.length-attempts.length,
   inputTokens:measured(records,'inputTokens'),outputTokens:measured(records,'outputTokens'),durationMs:measured(records,'durationMs')}};
}
export function repeatabilityReport(campaigns,{expectedTaskIds}={}) {
 if(!Array.isArray(campaigns)||!campaigns.length)throw new Error('Provide completed held-out campaigns');
 if(!Array.isArray(expectedTaskIds)||expectedTaskIds.length!==15||new Set(expectedTaskIds).size!==15||expectedTaskIds.some(id=>safe(id)!==id))throw new Error('Exactly 15 unique expected held-out task IDs are required');
 const required=['sourceCodeDigest','configDigest','catalogDigest','rubricVersion','split'];
 for(const c of campaigns){
  if(c.status!=='completed'||!c.slots?.length||c.slots.some(s=>s.status!=='finished'))throw new Error('Campaign must be completed with all slots finished');
  if(c.split!=='heldout')throw new Error('Only held-out campaigns are accepted');
  for(const key of required)if(!c[key]||c[key]!==campaigns[0][key])throw new Error(`Missing or mismatched ${key}`);
 }
 const seen=new Set(),groups=new Map(),refs=new Map();
 for(const c of campaigns)for(const slot of c.slots){
  if(!slot.runId||seen.has(slot.runId))throw new Error('Missing or duplicate run ID');seen.add(slot.runId);
  if(!expectedTaskIds.includes(slot.taskId))throw new Error('Unexpected held-out task ID');
  const profile=slot.profile??c.provider;if(safe(profile)!==profile)throw new Error('Missing or invalid profile label');
  const digest=slot.referenceDigest??c.referenceDigests?.[slot.taskId];
  if(digest){if(refs.has(slot.taskId)&&refs.get(slot.taskId)!==digest)throw new Error('Mismatched retained reference digest');refs.set(slot.taskId,digest);}
  if(!groups.has(profile))groups.set(profile,[]);groups.get(profile).push({...slot,retainedReferenceDigest:digest});
 }
 const profiles=[...groups].map(([profile,records])=>{
  const tasks=expectedTaskIds.map(taskId=>({taskId,...summarize(records.filter(r=>r.taskId===taskId))}));
  const reasons=[];
  if(tasks.some(t=>t.runs<3))reasons.push('Every expected task requires at least three distinct runs');
  if(records.some(r=>!r.retainedReferenceDigest))reasons.push('Missing retained reference digest');
  if(records.some(r=>r.grade?.passed!==true))reasons.push('One or more reference outcomes failed or remain unknown');
  return {profile,...summarize(records),tasks,minimumThreeRunsPerTask:tasks.every(t=>t.runs>=3),syntheticRepeatabilityQualified:reasons.length===0,reasons};
 });
 return {schemaVersion:1,mode:'heldout-synthetic-repeatability',provenance:Object.fromEntries(required.map(key=>[key,campaigns[0][key]])),campaignIds:campaigns.map(c=>safe(c.id)),expectedTaskCount:15,requiredRunsPerTask:3,profiles,
  claim:'Repeated synthetic reference agreement only, not human/expert qualification or production reliability.',
  caveats:['Distinct run IDs establish separately recorded runs, not statistical independence. Repetition numbers may restart across campaigns.',
   'Completed deliverable and correct review/abstention counts may overlap; do not add them together.',
   'Known token and timing sums include only retained measurements. Coverage excludes missing run accounting, which is separately counted; unknown is not zero.',
   'Three repeats per task are a bounded repeatability check, not a reliability confidence bound. All failures remain visible.',
   'Stewardship held-out inputs duplicate development inputs, so these tasks establish repeatability rather than unseen-input generalization.',
   'No hidden references are loaded; retained digest metadata is checked only. No runtime or routing configuration is changed.']};
}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){console.log('Usage: node scripts/repeatability-report.mjs COMPLETED_CAMPAIGN.json [COMPLETED_CAMPAIGN.json ...]');return;}
 const catalog=JSON.parse(await readFile(new URL('../fixtures/catalog.json',import.meta.url),'utf8'));
 const expectedTaskIds=catalog.filter(t=>t.split==='heldout').map(t=>t.id);
 const campaigns=[];for(const file of args){try{campaigns.push(JSON.parse(await readFile(file,'utf8')));}catch{throw new Error('Unable to read campaign JSON');}}
 console.log(JSON.stringify(repeatabilityReport(campaigns,{expectedTaskIds}),null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

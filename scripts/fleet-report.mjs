#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const label=(v,fallback='unknown')=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(v)?v:fallback;
const sum=values=>{const known=values.filter(finite);return known.length?known.reduce((a,b)=>a+b,0):null;};
const peak=values=>{const known=values.filter(finite);return known.length?Math.max(...known):null;};
function usageTotal(records) {
 const usages=records.map(r=>r.usage).filter(Boolean);
 const metrics=Object.fromEntries(['inputTokens','outputTokens','durationMs'].map(key=>{
  const observations=usages.map(u=>u.metrics?.[key]);const known=sum(observations.map(m=>m?.known));const total=sum(observations.map(m=>m?.total));
  return [key,{sum:sum(observations.map(m=>m?.sum)),known,total,coverage:total>0&&known!==null?known/total:null}];
 }));
 return {attempts:sum(usages.map(u=>u.attempts)),successful:sum(usages.map(u=>u.successful)),failed:sum(usages.map(u=>u.failed)),cancelled:sum(usages.map(u=>u.cancelled)),incomplete:sum(usages.map(u=>u.incomplete)),unknownOutcome:sum(usages.map(u=>u.unknownOutcome)),runsWithAccounting:usages.length,runsMissingAccounting:records.length-usages.length,metrics};
}
function summary(records) {
 return {runs:records.length,referencePasses:records.filter(r=>r.slot.grade?.passed===true).length,
  completedDeliverables:records.filter(r=>r.slot.grade?.completedDeliverable===true).length,
  correctReviewOrAbstention:records.filter(r=>r.slot.grade?.correctReviewOrAbstention===true).length,
  accounting:usageTotal(records),coordinatorResources:{scope:'coordinator host only',sampledPeakRssBytes:peak(records.map(r=>r.slot.usage?.resources?.coordinatorSampledPeakRssBytes)),sampledServerPeakRssBytes:peak(records.map(r=>r.slot.usage?.resources?.serverSampledPeakRssBytes)),sampledPeaksAreLowerBounds:true}};
}
function comparability(campaigns) {
 const reasons=[];
 for(const key of ['sourceCodeDigest','configDigest','rubricVersion','catalogDigest','split']) {
  if(campaigns.some(c=>!c[key]))reasons.push(`Missing ${key}`);
  else if(new Set(campaigns.map(c=>c[key])).size>1)reasons.push(`Different ${key}`);
 }
 const taskShape=c=>JSON.stringify(c.slots.map(s=>s.taskId).sort());
 if(new Set(campaigns.map(taskShape)).size>1)reasons.push('Different task coverage or repetition counts');
 const referenceMap=new Map();
 for(const c of campaigns)for(const s of c.slots){const digest=s.referenceDigest??c.referenceDigests?.[s.taskId];if(!digest){reasons.push('Missing fixed reference digest');continue;}if(referenceMap.has(s.taskId)&&referenceMap.get(s.taskId)!==digest)reasons.push('Different reference content');referenceMap.set(s.taskId,digest);}
 return {status:reasons.length?'non-comparable':campaigns.length<2?'single-campaign':'comparable-fixed-campaigns',reasons:[...new Set(reasons)],recommendations:[]};
}
/** Read-only descriptive accounting. Never loads runtime config or contacts a worker. */
export function fleetReport(campaigns) {
 if(!Array.isArray(campaigns)||!campaigns.length)throw new Error('Supply completed campaign JSON files');
 for(const c of campaigns)if(c.status!=='completed'||!c.slots?.length||c.slots.some(s=>s.status!=='finished'))throw new Error('Only completed campaigns with all slots finished are accepted');
 const seenRuns=new Set();
 for(const c of campaigns)for(const s of c.slots){if(!s.runId||seenRuns.has(s.runId))throw new Error('Missing or duplicated run identity; supply independent campaigns once');seenRuns.add(s.runId);}
 const measurements=campaigns.map(c=>{
  const records=c.slots.map(slot=>({slot,usage:slot.usage,profile:label(slot.profile??c.provider),workflow:label(slot.taskId?.replace(/-\d+$/,''))}));
  const groups=new Map();
  for(const r of records){const key=r.profile+'|'+r.workflow;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  const workflows=[...groups.values()].map(group=>{
   const workers=new Map();
   for(const r of group){const attribution=r.usage?.byWorker;
    const values=attribution?Object.entries(attribution):[['unknown-worker',r.usage]];
    for(const [workerId,u]of values){const safe=label(workerId,'unknown-worker');if(!workers.has(safe))workers.set(safe,[]);workers.get(safe).push({...r,usage:u});}
   }
   return {profile:group[0].profile,workflow:group[0].workflow,...summary(group),workers:[...workers.entries()].map(([workerId,entries])=>({workerId,runsInvolvingWorker:entries.length,referencePassingRunsInvolvingWorker:entries.filter(r=>r.slot.grade?.passed===true).length,transport:[...new Set(entries.flatMap(r=>Object.keys(r.usage?.byTransport??{})))].filter(v=>['ssh','loopback','unknown'].includes(v)),accounting:usageTotal(entries),resources:{scope:'worker before/after snapshots only',sampleCount:sum(entries.map(r=>r.usage?.resources?.sampleCount)),sampledServerPeakRssBytes:peak(entries.map(r=>r.usage?.resources?.serverSampledPeakRssBytes)),sampledPeaksAreLowerBounds:true,acceleratorAllocationMeasured:false}}))};
  });
  return {campaign:label(c.id),...summary(records),workflows};
 });
 return {schemaVersion:1,mode:'descriptive-fleet-accounting',comparison:comparability(campaigns),campaigns:measurements,costs:{energy:null,electricity:null,hardware:null,labor:null,paidInferenceApi:null},caveats:[
  'Reference passes are synthetic rubric outcomes, not human reliability or expert qualification; review/abstention is reported separately from completed deliverables.',
  'All recorded failures, repairs and incomplete attempts remain included. Unknown usage is not zero. Metric coverage applies to retained accounting; missing runs are separately counted.',
  'Inference duration is a sum of measured attempts, not end-to-end latency, throughput or separately measured transport overhead.',
  'A run involving multiple workers contributes to each worker involvement count; worker pass counts cannot be summed into unique successful runs or attributed causally to one worker.',
  'Coordinator RSS never substitutes for missing worker RSS. Before/after snapshots miss interior peaks; RSS is not full model allocation, compressed memory or accelerator allocation.',
  'No worker connectivity is tested, configuration changed, profile selected, price inferred or human time savings claimed.',
  'Stewardship held-out fixtures duplicate development inputs; those results establish repeatability only.'
 ]};
}
export function markdown(report){return `# Fleet accounting comparison\n\nComparison: ${report.comparison.status}. ${report.comparison.reasons.join('; ')}\n\n| Campaign | Reference passes/runs | Completed deliverables | Known attempts | Known inference ms | Input/output token coverage |\n|---|---:|---:|---:|---:|---|\n${report.campaigns.map(c=>`| ${c.campaign} | ${c.referencePasses}/${c.runs} | ${c.completedDeliverables} | ${c.accounting.attempts??'unknown'} | ${c.accounting.metrics.durationMs.sum??'unknown'} | ${c.accounting.metrics.inputTokens.coverage??'unknown'} / ${c.accounting.metrics.outputTokens.coverage??'unknown'} |`).join('\n')}\n\n| Campaign / profile / workflow | Worker / transport | Reference-passing runs involving worker | Attempts | Known input/output tokens | Worker RSS sampled peak bytes |\n|---|---|---:|---:|---:|---:|\n${report.campaigns.flatMap(c=>c.workflows.flatMap(w=>w.workers.map(k=>`| ${c.campaign} / ${w.profile} / ${w.workflow} | ${k.workerId} / ${k.transport.join(', ')||'unknown'} | ${k.referencePassingRunsInvolvingWorker}/${k.runsInvolvingWorker} | ${k.accounting.attempts??'unknown'} | ${k.accounting.metrics.inputTokens.sum??'unknown'} / ${k.accounting.metrics.outputTokens.sum??'unknown'} | ${k.resources.sampledServerPeakRssBytes??'unknown'} |`))).join('\n')}\n\n${report.caveats.map(c=>'- '+c).join('\n')}\n`;}
export async function main(args=process.argv.slice(2)){
 if(!args.length||args.includes('--help')){console.log('Usage: node scripts/fleet-report.mjs [--markdown] CAMPAIGN.json [CAMPAIGN.json ...]\nReads completed campaign files; outputs JSON or Markdown to stdout.');return;}
 const md=args.includes('--markdown');const files=args.filter(a=>a!=='--markdown');if(files.some(f=>f.startsWith('--')))throw new Error('Unknown report option');
 const campaigns=[];for(const file of files){try{campaigns.push(JSON.parse(await readFile(file,'utf8')));}catch{throw new Error('Unable to read a valid campaign JSON input');}}
 const report=fleetReport(campaigns);console.log(md?markdown(report):JSON.stringify(report,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

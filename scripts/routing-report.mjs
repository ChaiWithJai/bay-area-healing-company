#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

export const workflowFamilies = {
  volunteer_hours_reconciliation: 'participation_extract',
  case_note_normalization: 'case_extract',
  board_report_synthesis: 'board_evidence',
  grant_cycle_package: 'grant_evidence',
  stewardship_structuring: 'stewardship_evidence',
};
const variants=['ordinary','conflict','missing'];
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;

/** Read-only selection aid. It never changes runtime profiles or configuration. */
export function routingReport(campaigns) {
  if(!Array.isArray(campaigns)||!campaigns.length)throw new Error('Supply at least one completed development campaign');
  for(const campaign of campaigns){
    if(campaign.split!=='development')throw new Error(`Campaign ${campaign.id} is not development data; held-out results cannot select routing`);
    if(campaign.status!=='completed'||!campaign.slots?.length||campaign.slots.some(s=>s.status!=='finished'))throw new Error(`Campaign ${campaign.id} is not complete`);
  }
  const configDigests=new Set(campaigns.map(c=>c.configDigest).filter(Boolean));
  const sourceDigests=new Set(campaigns.map(c=>c.sourceCodeDigest).filter(Boolean));
  const rubricVersions=new Set(campaigns.map(c=>c.rubricVersion).filter(Boolean));
  if(sourceDigests.size>1||rubricVersions.size>1||configDigests.size>1)throw new Error('Campaigns use different source code, configurations or rubrics; compare matching versions only');
  const hasComparableProvenance=campaigns.every(c=>c.sourceCodeDigest&&c.rubricVersion&&c.configDigest);
  const groups=new Map();
  const seenRuns=new Set();
  for(const campaign of campaigns)for(const slot of campaign.slots){
    if(seenRuns.has(slot.runId))continue;seenRuns.add(slot.runId);
    const workflow=Object.keys(workflowFamilies).find(name=>new RegExp(`^${name}-0[123]$`).test(slot.taskId));
    if(!workflow)throw new Error(`Unrecognized development task ${slot.taskId}`);
    const variant=variants[Number(slot.taskId.slice(-2))-1];
    const profile=slot.profile??campaign.provider;
    const key=workflow+'|'+profile;
    if(!groups.has(key))groups.set(key,{workflow:`nonprofit/${workflow}`,family:workflowFamilies[workflow],profile,campaignIds:new Set(),runs:[],variants:new Set()});
    const group=groups.get(key);group.campaignIds.add(campaign.id);group.variants.add(variant);
    const usage=slot.usage;
    // A retained usage record with zero requests establishes zero inference work.
    // Absent accounting, incomplete timings, and interrupted requests remain unknown.
    const duration=usage?.attempts===0&&usage?.unknownOutcome===0?0:finite(usage?.metrics?.durationMs?.sum)&&usage.metrics.durationMs.known===usage.metrics.durationMs.total?usage.metrics.durationMs.sum:null;
    group.runs.push({runId:slot.runId,variant,passed:slot.grade?.passed===true,durationMs:duration,attempts:usage?.attempts??null,reviewStatus:slot.grade?.reviewStatus??'unavailable'});
  }
  const measurements=[...groups.values()].map(group=>{
    const reasons=[];
    if(!hasComparableProvenance)reasons.push('Missing source, configuration or rubric provenance');
    if(group.variants.size!==3)reasons.push('All three development variants are required');
    const referencePasses=group.runs.filter(r=>r.passed).length;
    if(referencePasses!==group.runs.length)reasons.push('One or more reference outcomes failed');
    const measured=group.runs.filter(r=>r.durationMs!==null);
    if(measured.length!==group.runs.length)reasons.push('Incomplete inference timing accounting');
    if(group.profile==='routed')reasons.push('Routed system is not a concrete model profile');
    const mean=measured.length?measured.reduce((n,r)=>n+r.durationMs,0)/measured.length:null;
    return {workflow:group.workflow,family:group.family,profile:group.profile,campaignIds:[...group.campaignIds],referencePasses,runs:group.runs.length,variantCounts:Object.fromEntries(variants.map(v=>[v,group.runs.filter(r=>r.variant===v).length])),measuredRuns:measured.length,meanMeasuredInferenceMs:mean,knownInferenceAttempts:group.runs.some(r=>r.attempts!==null)?group.runs.reduce((n,r)=>n+(r.attempts??0),0):null,eligible:reasons.length===0,reasons,reviewStatus:[...new Set(group.runs.map(r=>r.reviewStatus))]};
  }).sort((a,b)=>a.workflow.localeCompare(b.workflow)||a.profile.localeCompare(b.profile));
  const recommendations=Object.entries(workflowFamilies).map(([name,family])=>{
    const choices=measurements.filter(m=>m.family===family&&m.eligible).sort((a,b)=>a.meanMeasuredInferenceMs-b.meanMeasuredInferenceMs||a.profile.localeCompare(b.profile));
    const chosen=choices[0];
    return {workflow:`nonprofit/${name}`,family,decision:chosen?'propose':'review',proposedProfile:chosen?.profile??null,reason:chosen?`Lowest measured mean inference time among ${choices.length} eligible profiles; every supplied development repetition passed all three scenario types`:'No complete, reference-passing, fully timed concrete profile evidence',meanMeasuredInferenceMs:chosen?.meanMeasuredInferenceMs??null};
  });
  return {schemaVersion:1,mode:'recommendations_only',selectionSplit:'development',sourceCodeDigest:[...sourceDigests][0]??null,rubricVersion:[...rubricVersions][0]??null,campaignIds:campaigns.map(c=>c.id),measurements,recommendations,proposedFamilyProfiles:Object.fromEntries(recommendations.filter(r=>r.decision==='propose').map(r=>[r.family,r.proposedProfile])),caveats:[
    'Three synthetic, generated-unreviewed variants are weak qualification evidence, not production reliability or expert approval.',
    'Reference passes include correctly surfaced review or abstention for incomplete cases; they do not mean every case yielded a complete substantive deliverable.',
    'Mean inference duration includes all recorded attempts, repairs and failures within each run. It excludes document-tool time and is not end-to-end latency.',
    'Missing durations remain unknown. Zero is used only where retained accounting establishes that no inference request occurred.',
    'Model size is not an eligibility signal. This proposes the fastest measured eligible profile; no configuration is applied.',
    'A routed baseline is reported but cannot be selected as an individual profile. Evaluate recommendations on held-out data only after selection.',
  ]};
}

export async function main(args=process.argv.slice(2)) {
 if(!args.length||args.includes('--help')){console.log('Usage: node scripts/routing-report.mjs DEVELOPMENT_CAMPAIGN_ID [DEVELOPMENT_CAMPAIGN_ID ...]\nRead-only routing recommendations; held-out campaigns are rejected.');return;}
 if(args.some(id=>!/^[a-zA-Z0-9_-]{1,100}$/.test(id)))throw new Error('Invalid campaign ID');
 const config=await loadConfig();
 const campaigns=await Promise.all([...new Set(args)].map(async id=>JSON.parse(await readFile(path.join(config.stateDir,'evaluations',id+'.json'),'utf8'))));
 console.log(JSON.stringify(routingReport(campaigns),null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

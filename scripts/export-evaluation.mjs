import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { evaluationReport } from '../src/evaluation/index.js';
const [id,directory='docs/results']=process.argv.slice(2);
if(!id)throw new Error('Usage: node scripts/export-evaluation.mjs CAMPAIGN_ID [DIRECTORY]');
const config=await loadConfig(),c=await evaluationReport(config,id);
const report={schemaVersion:1,id:c.id,createdAt:c.createdAt,updatedAt:c.updatedAt,status:c.status,sourceCodeDigest:c.sourceCodeDigest,rubricVersion:c.rubricVersion,configDigest:c.configDigest,catalogDigest:c.catalogDigest,split:c.split,provider:c.provider,repetitions:c.repetitions,summary:c.summary,limitations:['Synthetic generated fixtures; no human expert qualification','Stewardship heldout inputs duplicate development: repeatability only','Resource samples include host interference and are not energy or billing measurements'],slots:c.slots.map(s=>({key:s.key,taskId:s.taskId,profile:s.profile,repetition:s.repetition,runId:s.runId,status:s.status,referenceDigest:s.referenceDigest,result:{status:s.result?.status,reviewRequired:s.result?.reviewRequired},grade:s.grade,usage:s.usage}))};
await mkdir(directory,{recursive:true});const file=path.join(directory,`${id}.json`);await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(file);

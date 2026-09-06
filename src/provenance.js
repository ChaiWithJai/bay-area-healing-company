import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './config.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function sourceCodeDigest() {
 const files=[];
 async function visit(dir){for(const entry of await readdir(path.join(ROOT,dir),{withFileTypes:true})){const name=path.join(dir,entry.name);if(entry.name.startsWith('.')||entry.name==='__pycache__')continue;if(entry.isDirectory())await visit(name);else if(entry.isFile())files.push(name);}}
 for(const dir of ['src','tools','workflows'])await visit(dir);
 files.push('package.json','npm-shrinkwrap.json','requirements.txt');files.sort();
 const contents=await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(path.join(ROOT,file))).digest('hex')]));
 return hash(contents);
}

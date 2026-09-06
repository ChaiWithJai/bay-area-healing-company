import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
const c=await loadConfig();
const files=(await readdir('test')).filter(f=>f.endsWith('.test.js')).sort().map(f=>`test/${f}`);
const child=spawn(process.execPath,['--test',...files],{stdio:'inherit',env:{...process.env,WM_PYTHON:c.python}});
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});

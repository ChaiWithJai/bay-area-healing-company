import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { sshArgs } from './ssh.js';
export async function workerInventory(id,worker) {
  const source=await readFile(new URL('../../tools/worker_inventory.py',import.meta.url),'utf8');
  return new Promise((resolve,reject)=>{
    const child=execFile('/usr/bin/ssh',sshArgs(id,worker,source),{timeout:20000,maxBuffer:1024*1024},(error,stdout)=>{
      if(error)return reject(new Error('Worker inventory unavailable; verify Remote Login, trusted host key, authorized SSH key and Python 3'));
      try {const inventory=JSON.parse(stdout);if(inventory.schemaVersion!==1||!inventory.hardware)throw new Error('Invalid worker inventory');resolve({workerId:id,transport:'ssh',...inventory});}
      catch(error){reject(error);}
    });
    child.stdin.on('error',()=>{});child.stdin.end();
  });
}

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { isIP } from 'node:net';

export function validateWorker(id,worker) {
  if(!/^[a-z][a-z0-9_-]{0,39}$/.test(id)||id==='coordinator')throw new Error('Invalid SSH worker label');
  const h=worker?.host, octets=typeof h==='string'?h.split('.').map(Number):[];
  if(isIP(h??'')!==4||!(octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168)))throw new Error('SSH worker requires an explicit private LAN IPv4 address');
  if(!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(worker.user??''))throw new Error('SSH worker requires a valid account name');
  if(!Number.isInteger(worker.port??22)||(worker.port??22)<1||(worker.port??22)>65535)throw new Error('Invalid SSH port');
}
export function sshArgs(id,worker,source) {
  validateWorker(id,worker);
  const quote=s=>`'${s.replaceAll("'",`'"'"'`)}'`;
  return ['-F','/dev/null','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-p',String(worker.port??22),'-l',worker.user,worker.host,`python3 -u -c ${quote(source)}`];
}

// Each HTTP request travels over SSH stdio; no forwarding listener is opened.
// Local child termination is bounded. Remote backend cessation still requires
// worker/runtime evidence; closing the SSH process alone does not prove it.
export async function sshFetch(id,worker,url,options={}, {launch=spawn,source}={}) {
  const u=new URL(url);
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw new Error('SSH relay requires a loopback HTTP target');
  const timeoutMs=options.timeoutMs??90000;
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('Invalid SSH request timeout');
  options.signal?.throwIfAborted();
  source??=await readFile(new URL('../../tools/worker_relay.py',import.meta.url),'utf8');
  options.signal?.throwIfAborted();
  const child=launch('/usr/bin/ssh',sshArgs(id,worker,source),{stdio:['pipe','pipe','ignore']});
  let closed=false,spawnError,stopError,deadline,killTimer,wake,ended=false,rawBytes=0,pending='';
  const decoder=new StringDecoder('utf8'),queue=[];
  let rejectStop;
  const stopped=new Promise((_,reject)=>{rejectStop=reject;});
  // A deadline can fire after headers arrive but before a consumer requests body.
  // Observe the rejection now; active frame/exit waits also race this promise.
  stopped.catch(()=>{});
  const terminate=()=>{
    if(closed)return;
    child.kill('SIGTERM');
    killTimer??=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},250);
  };
  const stop=error=>{if(!stopError){stopError=error;rejectStop(error);wake?.();}terminate();};
  const abort=()=>stop(new Error('SSH request cancelled'));
  const done=new Promise(resolve=>{
    child.once('error',error=>{spawnError=error;stop(new Error('SSH worker unavailable: process could not start'));resolve(null);});
    child.once('close',code=>{closed=true;clearTimeout(deadline);clearTimeout(killTimer);options.signal?.removeEventListener('abort',abort);wake?.();resolve(code);});
  });
  function addLine(line){
    if(Buffer.byteLength(line)>12000)throw new Error('SSH relay frame too large');
    queue.push(line.replace(/\r$/,''));
  }
  const onData=chunk=>{
    if(stopError)return;
    try{
      rawBytes+=chunk.length;
      if(rawBytes>12_000_000)throw new Error('SSH raw response size limit exceeded');
      pending+=decoder.write(chunk);
      let index;
      while((index=pending.indexOf('\n'))!==-1){addLine(pending.slice(0,index));pending=pending.slice(index+1);}
      // Enforce before newline, not after an unbounded readline allocation.
      if(Buffer.byteLength(pending)>12000)throw new Error('SSH relay frame too large');
      wake?.();
    }catch(error){stop(error);}
  };
  const onEnd=()=>{
    try{pending+=decoder.end();if(pending)addLine(pending);pending='';}
    catch(error){stop(error);}
    ended=true;wake?.();
  };
  const onStdoutError=()=>stop(new Error('SSH relay output interrupted'));
  child.stdout.on('data',onData);child.stdout.once('end',onEnd);child.stdout.once('error',onStdoutError);
  child.stdin.on('error',()=>{});
  options.signal?.addEventListener('abort',abort,{once:true});
  deadline=setTimeout(()=>stop(new Error('SSH request deadline exceeded')),timeoutMs);
  if(options.signal?.aborted)abort();
  child.stdin.end(JSON.stringify({port:Number(u.port||80),path:u.pathname,method:options.method??'GET',body:options.body??null,timeoutSeconds:Math.min(900,Math.max(1,timeoutMs/1000)),sampleResources:options.sampleResources===true}));
  const workerResources={before:null,after:null};
  async function cleanup(){
    clearTimeout(deadline);options.signal?.removeEventListener('abort',abort);
    if(!closed){
      terminate();
      // Escalate at 250ms, then allow a bounded interval to reap the child.
      let grace;
      await Promise.race([done,new Promise(resolve=>{grace=setTimeout(resolve,1000);})]);
      clearTimeout(grace);
    }
    clearTimeout(killTimer);child.stdout.off('data',onData);child.stdout.off('end',onEnd);child.stdout.off('error',onStdoutError);
  }
  async function frame(){
    for(;;){
      if(stopError)throw stopError;
      if(queue.length){
        const value=JSON.parse(queue.shift());
        if(value.type==='error')throw new Error(`SSH runtime unavailable (${String(value.errorType).slice(0,60)})`);
        return value;
      }
      if(ended||closed){await Promise.race([done,stopped]);throw new Error('SSH worker unavailable or relay interrupted; verify trusted host key and Remote Login');}
      await Promise.race([new Promise(resolve=>{wake=resolve;}),stopped]);wake=undefined;
    }
  }
  try{
    const first=await frame();
    if(first.type!=='headers'||first.status!==200)throw new Error('Invalid SSH runtime response');
    workerResources.before=first.before;
    let consumed=false;
    const body={async *[Symbol.asyncIterator](){
      if(consumed)throw new Error('Response already consumed');consumed=true;
      let size=0;
      try{
        for(;;){const value=await frame();
          if(value.type==='end'){workerResources.after=value.after;break;}
          if(value.type!=='chunk'||typeof value.data!=='string')throw new Error('Invalid SSH relay frame');
          const chunk=Buffer.from(value.data,'base64');size+=chunk.length;
          if(size>8000000)throw new Error('SSH response size limit exceeded');
          yield chunk;
        }
        const code=await Promise.race([done,stopped]);if(code!==0||spawnError)throw new Error('SSH relay did not exit successfully');
      }finally{await cleanup();}
    }};
    const text=async()=>{const chunks=[];for await(const chunk of body)chunks.push(chunk);return Buffer.concat(chunks).toString('utf8');};
    return {ok:true,status:200,body,workerResources,text,json:async()=>JSON.parse(await text())};
  }catch(error){await cleanup();throw error;}
}

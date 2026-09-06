import { performance } from 'node:perf_hooks';
export function assertLocalEndpoint(value) {
  const u = new URL(value);
  if (!['127.0.0.1','[::1]','localhost'].includes(u.hostname) || u.protocol !== 'http:' || u.username || u.password || u.search || u.hash) throw new Error('Only HTTP loopback inference endpoints are permitted');
  if (u.hostname === 'localhost') u.hostname = '127.0.0.1';
  return u.toString().replace(/\/$/, '');
}
export function validateProfile(p) {
  if (p?.kind !== 'local' || !['ollama','lmstudio'].includes(p.adapter)) throw new Error('Cloud/Codex/API-key providers are unavailable');
  if (!p.enabled) throw new Error('Profile disabled; qualify and enable it first');
  if (!p.model || /cloud|https?:\/\//i.test(p.model)) throw new Error('A local model artifact is required');
  assertLocalEndpoint(p.baseUrl);
  if (!Number.isInteger(p.context) || p.context < 1024 || p.context > 32768) throw new Error('Context must be between 1024 and 32768');
}
async function localFetch(url, options = {}) {
  const r = await fetch(url, { ...options, redirect: 'error' });
  if (!r.ok) throw new Error(`Local runtime HTTP ${r.status}: ${(await r.text()).slice(0,300)}`);
  return r;
}
export function listProviderNames(c) { return Object.keys(c.providers); }
export function checkPromptBudget(profile,{system,prompt,schema,maxTokens}) {
  // UTF-8 bytes conservatively bound content tokens for the supported local
  // tokenizers. Reserve a further 1024 tokens for chat/template overhead.
  const bytes=Buffer.byteLength(system)+Buffer.byteLength(prompt)+Buffer.byteLength(JSON.stringify(schema??{}));
  const output=maxTokens??profile.maxTokens;
  if(!Number.isInteger(output)||output<1||bytes+output+1024>profile.context)throw new Error('Request exceeds conservative context budget; split the source or qualify a larger context. No request dispatched.');
  return {contentBytes:bytes,outputTokens:output,templateReserveTokens:1024};
}
export function getProvider(c, name = c.defaultProvider) {
  const p = c.providers[name]; validateProfile(p);
  const base = assertLocalEndpoint(p.baseUrl); let fingerprint;
  return {
    name, kind:'local', model:p.model, adapter:p.adapter,
    async describe() {
      if (fingerprint) return fingerprint;
      const signal = AbortSignal.timeout(10000);
      if (p.adapter === 'ollama') {
        const tags = await (await localFetch(`${base}/api/tags`, {signal})).json();
        const m = tags.models?.find(m => m.name === p.model || m.model === p.model || `${m.name}:latest` === p.model);
        if (!m) throw new Error(`Model ${p.model} is not installed; no automatic download`);
        const info = await (await localFetch(`${base}/api/show`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:p.model}),signal})).json();
        if (info.remote_host || info.remote_model || m.remote_host || m.remote_model) throw new Error('Remote-backed models are prohibited');
        const v = await (await localFetch(`${base}/api/version`,{signal})).json();
        fingerprint = {profile:name,model:p.model,modelDigest:m.digest,artifactBytes:m.size,engine:`ollama/${v.version}`,quantization:info.details?.quantization_level,architecture:info.details?.family,parameters:info.details?.parameter_size,advertisedCapabilities:info.capabilities,context:p.context,evidence:'advertised'};
      } else {
        const info = await (await localFetch(`${base}/v1/models`,{signal})).json();
        if (!info.data?.some(m=>m.id===p.model)) throw new Error(`LM Studio model ${p.model} unavailable`);
        fingerprint={profile:name,model:p.model,modelDigest:null,engine:'lmstudio',context:p.context,evidence:'advertised'};
      }
      return fingerprint;
    },
    async generate({system,prompt,schema,signal,maxTokens,onToken}) {
      checkPromptBudget(p,{system,prompt,schema,maxTokens});
      const identity=await this.describe(), started=performance.now();
      let text='',ttftMs=null,final={},finishReason=null;
      const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(new Error('Inference timeout')),c.limits.requestTimeoutMs);
      const combined=signal?AbortSignal.any([signal,ctl.signal]):ctl.signal;
      const messages=[{role:'system',content:system},{role:'user',content:prompt}];
      const body=p.adapter==='ollama'?{model:p.model,messages,stream:true,format:schema??'json',think:false,keep_alive:'2m',options:{num_ctx:p.context,num_predict:maxTokens??p.maxTokens,temperature:0}}:{model:p.model,messages,stream:true,stream_options:{include_usage:true},max_tokens:maxTokens??p.maxTokens,temperature:0,response_format:schema?{type:'json_schema',json_schema:{name:'work_result',strict:true,schema}}:{type:'json_object'}};
      const accept=data=>{
        const token=p.adapter==='ollama'?data.message?.content:data.choices?.[0]?.delta?.content;
        if(token){if(ttftMs===null)ttftMs=performance.now()-started;text+=token;onToken?.(token);}
        if(Buffer.byteLength(text)>c.limits.maxOutputBytes)throw new Error('Output size limit exceeded');
        if(data.done||data.usage)final=data;
        finishReason=data.done_reason??data.choices?.[0]?.finish_reason??finishReason;
      };
      try {
        const r=await localFetch(`${base}${p.adapter==='ollama'?'/api/chat':'/v1/chat/completions'}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:combined});
        let pending='';const decoder=new TextDecoder();
        for await(const chunk of r.body){
          pending+=decoder.decode(chunk,{stream:true});
          if(pending.length>c.limits.maxOutputBytes)throw new Error('Frame size limit exceeded');
          const lines=pending.split('\n');pending=lines.pop();
          for(let line of lines){line=line.trim();if(!line||line.startsWith(':'))continue;
            if(p.adapter==='lmstudio'){if(!line.startsWith('data:'))continue;line=line.slice(5).trim();if(line==='[DONE]')continue;}
            const data=JSON.parse(line);if(data.error)throw new Error(String(data.error));accept(data);
          }
        }
        if(pending.trim()&&p.adapter==='ollama')accept(JSON.parse(pending));
        if(finishReason==='length')throw new Error('Model output truncated at token limit');
        if(p.adapter==='ollama'&&!final.done)throw new Error('Incomplete runtime stream');
        if(p.adapter==='lmstudio'&&!finishReason)throw new Error('Incomplete runtime stream');
        const ns=k=>typeof final[k]==='number'?final[k]/1e6:null;
        return {text,metrics:{...identity,durationMs:performance.now()-started,ttftMs,inputTokens:final.prompt_eval_count??final.usage?.prompt_tokens??null,outputTokens:final.eval_count??final.usage?.completion_tokens??null,cachedTokens:final.prompt_eval_cached_count??null,loadMs:ns('load_duration'),prefillMs:ns('prompt_eval_duration'),decodeMs:ns('eval_duration'),finishReason}};
      } catch(error){error.metrics={...identity,durationMs:performance.now()-started,ttftMs,inputTokens:final.prompt_eval_count??final.usage?.prompt_tokens??null,outputTokens:final.eval_count??final.usage?.completion_tokens??null,partialOutputChars:text.length,cancelled:signal?.aborted??false};throw error;}finally{clearTimeout(timer);}
    },
    async complete(args){return(await this.generate(args)).text;}
  };
}
export async function testProvider(c,name){
  const result=await getProvider(c,name).generate({system:'Return requested JSON.',prompt:'Return {"ok":true}.',schema:{type:'object',properties:{ok:{const:true}},required:['ok'],additionalProperties:false},maxTokens:64});
  try{const value=JSON.parse(result.text);if(value.ok!==true||Object.keys(value).length!==1)throw new Error('Unexpected structured probe response');}
  catch(error){error.metrics=result.metrics;throw error;}
  return result;
}

import {CoordinatorLeases} from '../../src/fleet/leases.js';
const [file,workerId,runId,timeout='3000']=process.argv.slice(2);
const store=new CoordinatorLeases(file),ctl=new AbortController();let lease;
process.on('message',async message=>{
 if(message==='abort')ctl.abort();
 if(message==='release'){process.send?.({released:store.release(lease)});store.close();process.exit(0);}
});
try{lease=await store.acquire({resource:`worker:${workerId}`,workerId,runId,timeoutMs:Number(timeout),signal:ctl.signal});process.send?.({acquired:true,lease});}
catch(error){process.send?.({error:error.message});store.close();process.exit(2);}

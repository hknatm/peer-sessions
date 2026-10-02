import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { requestLocal } from '../src/client.mjs';

test('SIGKILL service recovery: stale socket, durable inbox/outbox and uncertain turn',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps-kill-'));fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({version:1,machine:'host',listen:null,peers:{}}),{mode:0o600});
 let child;
 async function boot(){child=spawn(process.execPath,[new URL('../src/cli.mjs',import.meta.url).pathname,'serve'],{env:{...process.env,PI_PEERS_DIR:dir},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',()=>reject(new Error('Service exited before ready')));child.stderr.once('data',d=>reject(new Error(String(d))));});}
 try{
  await boot();for(const session of['a','b'])await requestLocal(dir,'configure',{session,settings:{enabled:true,project:{id:'p',label:'Project'},peers:['local'],auto:[]}});
  const a=(await requestLocal(dir,'attach',{session:'a',owner:'a'})).token,b=(await requestLocal(dir,'attach',{session:'b',owner:'b'})).token;
  const msg=await requestLocal(dir,'send',{session:'a',token:a,to:'host/b',body:'crash recovery',requestId:'kill-test'});
  // Wait for actual receipt, bounded by test deadline (not a production polling loop).
  for(let i=0;i<30;i++){const status=await requestLocal(dir,'delivery',{session:'a',token:a,id:msg.id});if(status.state==='received')break;await new Promise(r=>setTimeout(r,100));}
  const inbox=await requestLocal(dir,'inbox',{session:'b',token:b});assert.equal(inbox.length,1);
  await requestLocal(dir,'claim',{session:'b',token:b,id:inbox[0].id,manual:true});await requestLocal(dir,'presented',{session:'b',token:b,id:inbox[0].id});
  const dead=once(child,'exit');child.kill('SIGKILL');await dead;await boot();
  const resumed=(await requestLocal(dir,'attach',{session:'b',owner:'resumed'})).token;
  const after=await requestLocal(dir,'inbox',{session:'b',token:resumed});assert.equal(after[0].state,'uncertain');assert.equal(after[0].autoEligible,false);
  await assert.rejects(requestLocal(dir,'claim',{session:'b',token:resumed,id:after[0].id}),/Manual acceptance/);
 }finally{if(child?.exitCode===null&&child?.signalCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}fs.rmSync(dir,{recursive:true,force:true});}
});

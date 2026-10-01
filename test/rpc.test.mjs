import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { loadHostRuntime } from './host-runtime.mjs';
import { startService } from '../src/service.mjs';

test('fresh real Pi RPC session enables/lists/disables peers without model calls',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps-rpc-'));const state=path.join(dir,'state');fs.mkdirSync(state,{mode:0o700});
 const service=await startService(state,{config:{version:1,machine:'host',peers:{},listen:null},interval:60000});
 try{
  const isolated=path.join(dir,'agent');fs.mkdirSync(isolated,{mode:0o700});
  const settings={};fs.writeFileSync(path.join(isolated,'settings.json'),JSON.stringify(settings));
  const {cli}=await loadHostRuntime();const messages=['/peer help','/peers on','/peers allow local','/peer status','/peer list','/peer disable'];
  const child=spawn(process.execPath,[cli,'-e',new URL('../extensions/peer.ts',import.meta.url).pathname,'--mode','rpc','--offline','--no-approve','--session-dir',path.join(dir,'sessions')],{cwd:dir,env:{...process.env,PI_PEERS_DIR:state,PI_CODING_AGENT_DIR:isolated},stdio:['pipe','pipe','pipe']});
  const records=[],pending=new Map();let stderr='';child.stderr.on('data',c=>stderr+=c);
  const lines=createInterface({input:child.stdout});lines.on('line',line=>{const r=JSON.parse(line);records.push(r);if(r.type==='response')pending.get(r.id)?.(r);});
  try {
   for(const [i,message]of messages.entries()) {
    const reply=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('RPC timeout: '+stderr+' '+JSON.stringify(records))),10000);pending.set(String(i),r=>{clearTimeout(timeout);resolve(r);});});
    child.stdin.write(JSON.stringify({type:'prompt',id:String(i),message})+'\n');assert.ok((await reply).success);
   }
  } finally {const exit=once(child,'exit');child.stdin.end();const killer=setTimeout(()=>child.kill('SIGKILL'),5000);await exit;clearTimeout(killer);lines.close();}
  assert.equal(stderr.trim(),'');
  assert.equal(records.filter(r=>r.type==='response'&&r.command==='prompt'&&r.success).length,messages.length,JSON.stringify(records.filter(r=>r.type==='response')));
  const errors=records.filter(r=>r.type==='extension_ui_request'&&r.method==='notify'&&r.notifyType==='error');assert.deepEqual(errors,[]);
  assert.ok(records.some(r=>r.method==='notify'&&String(r.message).includes('Session permissions updated')));
  assert.ok(records.some(r=>r.method==='notify'&&String(r.message).includes('Connection & authentication')));
  assert.ok(records.some(r=>r.method==='notify'&&String(r.message).includes('enabled · attached')));
  const rows=service.store.db.prepare('SELECT * FROM sessions').all();assert.equal(rows.length,1);assert.equal(rows[0].enabled,0);assert.deepEqual(JSON.parse(rows[0].peers),['local']);
 }finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {startService} from '../src/service.mjs';
import {loadHostRuntime} from './host-runtime.mjs';

test('three real Pi sessions: same-checkout discovery, cross-project isolation and peer presence without provider calls',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-prpc-')),state=path.join(dir,'state');fs.mkdirSync(state,{mode:0o700});
 const service=await startService(state,{config:{version:1,machine:'host',peers:{},listen:null},interval:60000});const clients=[];
 try{
  const repo=path.join(dir,'repo'),other=path.join(dir,'other'),agent=path.join(dir,'agent');
  for(const root of [repo,other]){fs.mkdirSync(root);execFileSync('git',['init',root],{stdio:'ignore'});}fs.mkdirSync(path.join(repo,'sub'));fs.mkdirSync(agent);
  const {cli}=await loadHostRuntime();
  for(const [index,cwd]of [repo,path.join(repo,'sub'),other].entries()){
   const child=spawn(process.execPath,[cli,'-e',new URL('../extensions/peer.ts',import.meta.url).pathname,'--mode','rpc','--offline','--no-approve','--session-dir',path.join(dir,`sessions-${index}`)],{cwd,env:{...process.env,PI_PEERS_DIR:state,PI_CODING_AGENT_DIR:agent},stdio:['pipe','pipe','pipe']});
   const records=[],pending=new Map();let stderr='',sequence=0;child.stderr.on('data',c=>stderr+=c);
   const lines=createInterface({input:child.stdout});lines.on('line',line=>{const row=JSON.parse(line);records.push(row);if(row.type==='response')pending.get(row.id)?.(row);});
   const client={child,lines,records,get stderr(){return stderr;},async command(message){const id=String(sequence++);const reply=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('RPC command timed out'));},10000);pending.set(id,row=>{clearTimeout(timeout);pending.delete(id);resolve(row);});});child.stdin.write(JSON.stringify({type:'prompt',id,message})+'\n');assert.ok((await reply).success);}};
   clients.push(client);await client.command('/peer enable');
  }
  const sessions=service.store.db.prepare('SELECT id FROM sessions ORDER BY rowid').all().map(r=>r.id);assert.equal(sessions.length,3);
  assert.equal(service.store.session(sessions[0]).project.id,service.store.session(sessions[1]).project.id);assert.notEqual(service.store.session(sessions[0]).project.id,service.store.session(sessions[2]).project.id);
  for(const [index,client]of clients.entries()){
   const start=client.records.length;await client.command('/peer list');
   const data=client.records.slice(start).find(r=>r.method==='notify');const rows=JSON.parse(data.message);
   assert.deepEqual(rows.map(r=>r.address),index===2?[]:[`host/${sessions[index===0?1:0]}`]);
   assert.equal(client.stderr,'');assert.ok(!client.records.some(r=>r.type==='agent_start'));
   assert.ok(!client.records.some(r=>r.method==='notify'&&r.notifyType==='error'));
  }
 }finally{
  for(const {child,lines}of clients){if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.stdin.end();const killer=setTimeout(()=>child.kill('SIGKILL'),5000);await exit;clearTimeout(killer);}lines.close();}
  await service.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});

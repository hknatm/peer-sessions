import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Store} from '../src/store.mjs';
import {startService} from '../src/service.mjs';
const uid=()=>crypto.randomUUID();
function setup(s){for(const id of ['a','b','c'])s.configure(id,{enabled:true,project:{id:'p',label:'P'},peers:['local'],auto:['host/a','host/b']});return Object.fromEntries(['a','b','c'].map(id=>[id,s.attach(id,id).token]));}
function send(s,t,from='a',to='b'){return s.send(from,t[from],{to:`host/${to}`,toProject:'p',body:'brief result',requestId:uid()});}
test('40/hour per session across peers/directions, dedup, cancellation, rolling boundary and restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-hour-')),file=path.join(dir,'db');let s=new Store(file,'host');let t=setup(s);
 try{
  for(let i=0;i<20;i++){const a=send(s,t);s.receive(a.message,'host');const b=send(s,t,'b','a');s.receive(b.message,'host');}
  assert.deepEqual(s.usage('a').remaining,0);assert.equal(s.usage('b').used,40);assert.equal(s.usage('c').used,0);
  const first=s.db.prepare("SELECT id FROM messages WHERE session='a' AND direction='out' ORDER BY received LIMIT 1").get();const row=s.get(first.id);
  assert.equal(s.send('a',t.a,{to:'host/b',toProject:'p',body:row.message.body,requestId:row.id}).id,row.id);s.receive(row.message,'host');assert.equal(s.usage('a').used,40);
  s.queueControl('a','cancel',row.id);assert.equal(s.usage('a').used,40);assert.throws(()=>send(s,t,'a','c'),/allowance exhausted/);
  const incoming=send(s,t,'c','a');assert.throws(()=>s.receive(incoming.message,'host'),/allowance exhausted/);assert.equal(s.usage('c').used,1);
  s.close();s=new Store(file,'host');t=setup(s);assert.equal(s.usage('a').used,40);assert.throws(()=>send(s,t,'a','c'),/allowance exhausted/);
  const now=Date.now();s.db.prepare("UPDATE messages SET received=? WHERE id=?").run(now-3600000,row.id);
  assert.equal(s.usage('a',now).used,39);s.receive(incoming.message,'host');assert.equal(s.usage('a').used,40);
 }finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('recipient hourly limit retains sender queue and retries after capacity frees',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-hour-service-'));const service=await startService(dir,{config:{version:1,machine:'host',peers:{},limits:{messagesPerHour:1}},interval:60000});
 try{const s=service.store,t=setup(s);const first=send(s,t,'a','b');await service.flush();assert.equal(s.get(first.id).state,'received');
 const second=send(s,t,'c','b');await service.flush();assert.equal(s.get(second.id).state,'queued');assert.match(s.get(second.id).error,/rate limited/);assert.equal(s.inbox('b',t.b).length,1);
 s.db.prepare("UPDATE messages SET received=? WHERE session='b'").run(Date.now()-3600000);s.db.prepare('UPDATE messages SET next=0 WHERE id=?').run(second.id);await service.flush();assert.equal(s.get(second.id).state,'received');assert.equal(s.inbox('b',t.b).length,2);
 }finally{await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('unpresented claim release restores automatic eligibility and does not consume wake budget',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-release-')),s=new Store(path.join(dir,'db'),'host');try{
 const t=setup(s),row=send(s,t);s.receive(row.message,'host');const mid=`local_${row.id}`;s.claim('b',t.b,mid);s.release('b',t.b,mid);assert.equal(s.get(mid).eligible,t.b);assert.equal(s.db.prepare('SELECT wakes FROM conversations').get().wakes,0);
 s.claim('b',t.b,mid);s.configure('b',{...s.session('b'),enabled:true,auto:[]});s.configure('b',{...s.session('b'),enabled:true,auto:['host/a']});s.release('b',t.b,mid);assert.equal(s.get(mid).eligible,null);
 s.claim('b',t.b,mid,true);s.presented('b',t.b,mid);assert.throws(()=>s.release('b',t.b,mid),/unpresented/);
 }finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
});

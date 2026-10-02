import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
const uid=()=>crypto.randomUUID();
function fixture(limits={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps-store-')); const file=path.join(dir,'db'); const s=new Store(file,'host',limits);
 s.configure('a',{enabled:true,project:{id:'p',label:'Project'},allowedProjects:['remote/rp'],peers:['local','remote']});s.configure('b',{enabled:true,project:{id:'p',label:'Project'},allowedProjects:['remote/rp'],peers:['local','remote'],auto:['host/a','remote/x']});
 const a=s.attach('a','a').token,b=s.attach('b','b').token;
 return {s,file,a,b,close(){s.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function remote(overrides={}) {return {version:2,fromProject:'rp',toProject:'p',id:uid(),conversation:uid(),fromMachine:'remote',fromSession:'x',toMachine:'host',toSession:'b',body:'message',depth:1,maxDepth:4,expires:Date.now()+60000,...overrides};}
test('opt-in, exclusive leases, revocation, new identities',()=>{
 const f=fixture();try{
 assert.throws(()=>f.s.attach('new','owner'),/not enabled/);
 assert.throws(()=>f.s.attach('a','other'),/already attached/);
 assert.equal(f.s.attach('a','a').token,f.a);
 assert.equal(f.s.listing('unknown',{session:'a',project:{id:'p',label:'Project'}}).length,0);
 f.s.configure('b',{enabled:false,peers:['local']});assert.throws(()=>f.s.inbox('b',f.b),/expired or disabled/);
 assert.equal(f.s.listing('remote',{session:'x',project:{id:'rp',label:'Remote'}}).length,1);
 }finally{f.close();}
});
test('durable deduplication and conflicting duplicates',()=>{
 const f=fixture();try{const m=remote();f.s.receive(m,'remote');f.s.receive(m,'remote');assert.equal(f.s.inbox('b',f.b).length,1);
 f.s.claim('b',f.b,m.id);f.s.presented('b',f.b,m.id);f.s.settled('b',f.b,m.id,false);assert.equal(f.s.get(m.id).state,'uncertain');
 assert.throws(()=>f.s.receive({...m,body:'changed'},'remote'),/Conflicting/);
 assert.throws(()=>f.s.receive({...m,id:uid(),fromMachine:'spoof'},'remote'),/identity mismatch/);
 }finally{f.close();}
});
test('local messages, reply depth, retry ID, persisted conversation budgets',()=>{
 const f=fixture({maxDepth:2,maxMessages:2});try{
 const requestId=uid(),args={to:'host/b',toProject:'p',body:'hello',requestId};const out=f.s.send('a',f.a,args);assert.equal(f.s.send('a',f.a,args).id,requestId);
 f.s.receive(out.message,'host');const inbox=f.s.inbox('b',f.b)[0];assert.equal(inbox.id,`local_${requestId}`);
 const reply=f.s.send('b',f.b,{to:'host/a',toProject:'p',body:'reply',parent:inbox.id,requestId:uid()});assert.equal(reply.message.depth,2);assert.equal(reply.message.expires,out.message.expires);
 f.s.receive(reply.message,'host');assert.throws(()=>f.s.send('a',f.a,{to:'host/b',toProject:'p',body:'again',parent:f.s.inbox('a',f.a)[0].id,requestId:uid()}),/Chain depth/);
 assert.throws(()=>f.s.send('a',f.a,{...args,body:'other'}),/Conflicting/);
 }finally{f.close();}
});
test('closed session and lease expiry backlog is manual; auto-start only new arrival',()=>{
 const f=fixture();try{
 f.s.detach('b',f.b);const old=remote();f.s.receive(old,'remote');const token=f.s.attach('b','again').token;
 assert.throws(()=>f.s.claim('b',token,old.id),/Manual acceptance/);
 const fresh=remote();f.s.receive(fresh,'remote');f.s.claim('b',token,fresh.id);f.s.presented('b',token,fresh.id);f.s.settled('b',token,fresh.id);assert.equal(f.s.get(fresh.id).state,'handled');
 f.s.attachments.get('b').expires=0;const next=f.s.attach('b','new-owner').token;assert.equal(f.s.get(old.id).eligible,null);assert.throws(()=>f.s.claim('b',next,old.id),/Manual/);
 f.s.claim('b',next,old.id,true);
 }finally{f.close();}
});
test('crash recovery: presented processing is uncertain and never auto replayed',()=>{
 const f=fixture();const m=remote();f.s.receive(m,'remote');f.s.claim('b',f.b,m.id);f.s.presented('b',f.b,m.id);f.s.close();
 const recovered=new Store(f.file,'host');try{const token=recovered.attach('b','resumed').token;assert.equal(recovered.get(m.id).state,'uncertain');assert.throws(()=>recovered.claim('b',token,m.id),/Manual acceptance/);recovered.claim('b',token,m.id,true);}
 finally{recovered.close();fs.rmSync(path.dirname(f.file),{recursive:true,force:true});}
});
test('wake budget, permission revoked, expiry, capacity and unsupported version',()=>{
 const f=fixture({maxWakes:1,mailboxRows:1});try{
 const m=remote();f.s.receive(m,'remote');assert.throws(()=>f.s.receive(remote(),'remote'),/Mailbox full/);f.s.claim('b',f.b,m.id);f.s.detach('b',f.b);const token=f.s.attach('b','new').token;assert.throws(()=>f.s.claim('b',token,m.id,true),/wake budget/);
 f.s.configure('b',{enabled:true,project:{id:'p',label:'Project'},allowedProjects:['remote/rp'],peers:['local']});assert.throws(()=>f.s.claim('b',token,m.id,true),/revoked/);
 assert.throws(()=>f.s.receive(remote({expires:Date.now()-1}),'remote'),/expired/);
 }finally{f.close();}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps-version-')),file=path.join(dir,'db');const db=new DatabaseSync(file);db.exec('PRAGMA user_version=99');db.close();assert.throws(()=>new Store(file,'host'),/Unsupported/);const after=new DatabaseSync(file);assert.equal(after.prepare('PRAGMA user_version').get().user_version,99);after.close();fs.rmSync(dir,{recursive:true,force:true});
});

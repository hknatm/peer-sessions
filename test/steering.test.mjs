import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Store} from '../src/store.mjs';
const uid=()=>crypto.randomUUID();
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-steer-')),file=path.join(dir,'db'),s=new Store(file,'host');for(const sid of ['a','b'])s.configure(sid,{enabled:true,project:{id:'p',label:'P'},peers:['local'],auto:['host/a']});const a=s.attach('a','a').token,b=s.attach('b','b',{busy:true,running:true,steering:true}).token;return {dir,file,s,a,b,close(){this.s.close();fs.rmSync(dir,{recursive:true,force:true});}};}
function send(f,options={}){const out=f.s.send('a',f.a,{to:'host/b',toProject:'p',body:'Stop API changes; proposal unresolved',requestId:uid(),...options});f.s.receive(out.message,'host');return `local_${out.id}`;}
test('urgent permission is separate, arrival-bound, revocable and not inherited from auto-start',()=>{
 const f=fixture();try{
 const old=send(f,{mode:'urgent',kind:'blocker'});assert.equal(f.s.get(old).eligible,null);assert.throws(()=>f.s.claim('b',f.b,old,false,true),/Steering permission/);
 f.s.configure('b',{...f.s.session('b'),enabled:true,steer:['host/a']});assert.equal(f.s.get(old).eligible,null);
 const fresh=send(f,{mode:'urgent',kind:'proposal'});f.s.heartbeat('b',f.b,{busy:true,steering:true,running:false});assert.throws(()=>f.s.claim('b',f.b,fresh,false,true),/Steering permission/);f.s.heartbeat('b',f.b,{busy:true,steering:true,running:true});assert.equal(f.s.get(fresh).eligible,f.b);const c=f.s.claim('b',f.b,fresh,false,true);assert.equal(c.state,'processing');
 f.s.configure('b',{...f.s.session('b'),enabled:true,steer:[]});f.s.configure('b',{...f.s.session('b'),enabled:true,steer:['host/a']});f.s.release('b',f.b,fresh);assert.equal(f.s.get(fresh).eligible,null);
 f.s.configure('b',{...f.s.session('b'),enabled:true,auto:[],steer:[]});assert.throws(()=>f.s.configure('b',{...f.s.session('b'),enabled:true,steer:['host/a']}),/auto-start/);
 }finally{f.close();}
});
test('urgent can join active work; normal cannot; consumption and settlement are distinct',()=>{
 const f=fixture();try{
 f.s.configure('b',{...f.s.session('b'),enabled:true,steer:['host/a']});f.s.heartbeat('b',f.b,{busy:false,steering:true});const normal=send(f),urgent=send(f,{mode:'urgent',kind:'blocker'});
 assert.equal(f.s.inbox('b',f.b)[0].id,urgent);f.s.claim('b',f.b,normal);f.s.presented('b',f.b,normal);f.s.heartbeat('b',f.b,{busy:true,running:true,steering:true});f.s.claim('b',f.b,urgent,false,true);f.s.presented('b',f.b,urgent);
 const another=send(f);assert.throws(()=>f.s.claim('b',f.b,another),/Manual acceptance/);assert.throws(()=>f.s.claim('b',f.b,another,true),/already processing/);
 assert.equal(f.s.get(urgent).state,'presented');f.s.settled('b',f.b,urgent,true);assert.equal(f.s.get(urgent).state,'uncertain');f.s.settled('b',f.b,normal,true);
 const consumed=send(f,{mode:'urgent',kind:'result'});f.s.claim('b',f.b,consumed,false,true);f.s.consumed('b',f.b,consumed);f.s.presented('b',f.b,consumed);assert.equal(f.s.get(consumed).state,'consumed');f.s.settled('b',f.b,consumed,true);assert.equal(f.s.get(consumed).state,'handled');
 assert.equal(f.s.usage('b').used,4);assert.throws(()=>f.s.release('b',f.b,consumed),/unpresented/);
 }finally{f.close();}
});
test('older adapters and reattached sessions cannot automatically steer; interrupted consumed messages are uncertain',()=>{
 const f=fixture();try{
 f.s.configure('b',{...f.s.session('b'),enabled:true,steer:['host/a']});f.s.heartbeat('b',f.b,{busy:true});const old=send(f,{mode:'urgent'});assert.equal(f.s.get(old).eligible,null);
 f.s.heartbeat('b',f.b,{busy:true,running:true,steering:true});const fresh=send(f,{mode:'urgent'});f.s.claim('b',f.b,fresh,false,true);f.s.consumed('b',f.b,fresh);f.s.detach('b',f.b);assert.equal(f.s.get(fresh).state,'uncertain');const closed=send(f,{mode:'urgent'});const token=f.s.attach('b','new',{steering:true}).token;assert.equal(f.s.get(closed).eligible,null);assert.throws(()=>f.s.claim('b',token,closed,false,true),/Steering permission/);
 const crashed=send(f,{mode:'urgent'});f.s.claim('b',token,crashed,false,true);f.s.consumed('b',token,crashed);
 f.s.close();const recovered=new Store(f.file,'host');try{assert.deepEqual(recovered.session('b').steer,['host/a']);assert.equal(recovered.get(fresh).state,'uncertain');assert.equal(recovered.get(crashed).state,'uncertain');}finally{recovered.close();}
 f.s=new Store(f.file,'host');
 }finally{f.close();}
});
test('mode/kind validated; duplicate IDs cannot change urgency/intent; plain messages remain compatible',()=>{
 const f=fixture();try{
 const args={to:'host/b',toProject:'p',body:'Proposal',requestId:uid(),mode:'urgent',kind:'proposal'};const row=f.s.send('a',f.a,args);assert.equal(f.s.send('a',f.a,args).id,row.id);assert.throws(()=>f.s.send('a',f.a,{...args,mode:'normal'}),/Conflicting/);assert.throws(()=>f.s.send('a',f.a,{...args,kind:'decision'}),/Conflicting/);
 for(const options of [{mode:'abort'},{kind:'system'},{kind:''}])assert.throws(()=>f.s.send('a',f.a,{...args,requestId:uid(),...options}),/Invalid/);
 const plain=f.s.send('a',f.a,{to:'host/b',toProject:'p',body:'plain',requestId:uid()});const legacy={...plain.message};delete legacy.mode;f.s.receive(legacy,'host');assert.equal(f.s.get(`local_${plain.id}`).message.mode,undefined);
 }finally{f.close();}
});

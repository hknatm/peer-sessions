import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { startService, requestLocal } from '../src/service.mjs';
const uid=()=>crypto.randomUUID();
function identity(dir,machine){fs.mkdirSync(dir,{mode:0o700});execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-days','1','-subj',`/CN=${machine}`,'-keyout',path.join(dir,'identity.key'),'-out',path.join(dir,'identity.crt')],{stdio:'ignore'});fs.chmodSync(path.join(dir,'identity.key'),0o600);}
function rawRequest(port,body,headers={},cert,key){return new Promise((resolve,reject)=>{const r=https.request({hostname:'127.0.0.1',port,path:'/v1',method:'POST',rejectUnauthorized:false,cert,key,headers:{...headers,'content-type':'application/json'}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(s)}));});r.on('error',reject);r.end(JSON.stringify(body));});}
test('real mutual TLS: delivery, offline sender queue, receiver restart, revocation, identity rejection',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ps-lan-'));const a=path.join(root,'a'),b=path.join(root,'b');identity(a,'a');identity(b,'b');
 const secret=crypto.randomBytes(32).toString('hex');for(const dir of[a,b])fs.writeFileSync(path.join(dir,'pair.secret'),secret,{mode:0o600});
 const ca={version:1,machine:'a',listen:{host:'127.0.0.1',port:0},peers:{b:{url:'https://127.0.0.1:1',certificate:path.join(b,'identity.crt'),secretFile:path.join(a,'pair.secret')}}};
 const cb={version:1,machine:'b',listen:{host:'127.0.0.1',port:0},peers:{a:{url:'https://127.0.0.1:1',certificate:path.join(a,'identity.crt'),secretFile:path.join(b,'pair.secret')}}};
 fs.writeFileSync(path.join(a,'config.json'),JSON.stringify(ca),{mode:0o600});fs.writeFileSync(path.join(b,'config.json'),JSON.stringify(cb),{mode:0o600});
 let sa,sb;
 try{
  sb=await startService(b,{config:cb,interval:60000});ca.peers.b.url=`https://127.0.0.1:${sb.address.port}`;
  sa=await startService(a,{config:ca,interval:60000});
  await requestLocal(a,'configure',{session:'s1',settings:{enabled:true,peers:['b']}});await requestLocal(b,'configure',{session:'s2',settings:{enabled:true,peers:['a'],auto:['a/s1']}});
  const token=(await requestLocal(a,'attach',{session:'s1',owner:'test'})).token;
  const list=await requestLocal(a,'list',{session:'s1',token});assert.equal(list[0].address,'b/s2');assert.equal(list[0].state,'session-closed');
  const args={session:'s1',token,to:'b/s2',body:'offline backlog',requestId:uid()};await requestLocal(a,'send',args);await sa.flush();assert.equal(sa.store.get(args.requestId).state,'received');
  const bt=(await requestLocal(b,'attach',{session:'s2',owner:'b-owner',info:{model:'private-provider/model'}})).token;
  const inbox=await requestLocal(b,'inbox',{session:'s2',token:bt});assert.equal(inbox[0].autoEligible,false);assert.equal(inbox[0].eligible,undefined);
  const next={...args,body:'new message',requestId:uid()};await requestLocal(a,'send',next);await sa.flush();assert.equal(sb.store.get(next.requestId).eligible,bt);
  const cert=fs.readFileSync(path.join(a,'identity.crt')),key=fs.readFileSync(path.join(a,'identity.key'));
  assert.equal((await rawRequest(sb.address.port,{version:1,action:'list'},{'x-peer-machine':'a',authorization:`Bearer ${secret}`})).status,403);
  assert.equal((await rawRequest(sb.address.port,{version:1,action:'list'},{'x-peer-machine':'a',authorization:'Bearer wrong'},cert,key)).status,403);
  assert.equal((await rawRequest(sb.address.port,{version:99,action:'list'},{'x-peer-machine':'a',authorization:`Bearer ${secret}`},cert,key)).status,409);
  assert.equal((await rawRequest(sb.address.port,{version:1,action:'configure'},{'x-peer-machine':'a',authorization:`Bearer ${secret}`},cert,key)).status,403);
  const port=sb.address.port;await sb.close();sb=null;
  const offline={...args,body:'while host down',requestId:uid()};await requestLocal(a,'send',offline);await sa.flush();assert.equal(sa.store.get(offline.requestId).state,'queued');
  await sa.close();sa=null;
  cb.listen.port=port;sb=await startService(b,{config:cb,interval:60000});sa=await startService(a,{config:ca,interval:60000});sa.store.db.prepare('UPDATE messages SET next=0').run();await sa.flush();assert.equal(sa.store.get(offline.requestId).state,'received');assert.equal(sb.store.get(next.requestId).eligible,null);
  const resumed=(await requestLocal(b,'attach',{session:'s2',owner:'resumed'})).token;assert.throws(()=>sb.store.claim('s2',resumed,next.requestId),/Manual acceptance/);
  const revoked={...cb,peers:{}};fs.writeFileSync(path.join(b,'config.json'),JSON.stringify(revoked));await requestLocal(b,'reload-trust');
  await assert.rejects(requestLocal(b,'claim',{session:'s2',token:resumed,id:offline.requestId,manual:true}),/revoked/);
  assert.equal((await rawRequest(sb.address.port,{version:1,action:'list'},{'x-peer-machine':'a',authorization:`Bearer ${secret}`},cert,key)).status,403);
 }finally{await sa?.close();await sb?.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('private local socket ownership and duplicate service protection',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps-sock-'));const config={version:1,machine:'solo',peers:{},listen:null};let s;
 try{s=await startService(dir,{config,interval:60000});assert.equal(fs.statSync(path.join(dir,'service.sock')).mode&0o777,0o600);await assert.rejects(startService(dir,{config}),/already running/);assert.equal((await requestLocal(dir,'health')).machine,'solo');
 const attempts=await Promise.allSettled([startService(dir,{config}),startService(dir,{config})]);assert.ok(attempts.every(r=>r.status==='rejected'));assert.equal((await requestLocal(dir,'health')).machine,'solo');await assert.rejects(requestLocal(dir,'configure',{session:'s',settings:{enabled:true,peers:['unpaired']}}),/paired/);}
 finally{await s?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

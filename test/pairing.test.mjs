import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initialize,identity,readConfig} from '../src/config.mjs';
import {startService} from '../src/service.mjs';
import {requestLocal} from '../src/client.mjs';
import {join,parseInvitation,pairingRequest,origin} from '../src/pairing.mjs';

test('guided pairing: verified TLS invitation, reciprocal approval, replay/expiry rejection',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'peer-pair-')),a=path.join(base,'a'),b=path.join(base,'b');initialize(a);initialize(b);let service;
 try{
 const ca=readConfig(a);service=await startService(a,{config:{...ca,listen:{host:'127.0.0.1',port:0}},interval:60000});
 const url=`https://127.0.0.1:${service.address.port}`,other='https://127.0.0.1:7444';
 const {invitation}=await requestLocal(a,'pair-invite',{url});const invite=parseInvitation(invitation);assert.equal(invite.peer.machine,ca.machine);
 const promise=join(b,invitation,other,{confirm:async peer=>peer.fingerprint===identity(a).fingerprint,onWaiting:()=>{}});
 let pending=[];for(let i=0;i<30&&!pending.length;i++){pending=await requestLocal(a,'pair-pending');if(!pending.length)await new Promise(r=>setTimeout(r,20));}
 assert.equal(pending.length,1);assert.equal(pending[0].peer.machine,readConfig(b).machine);assert.equal(pending[0].peer.fingerprint,identity(b).fingerprint);
 await requestLocal(a,'pair-approve',{request:pending[0].request,accepted:true});const paired=await promise;assert.equal(paired.machine,ca.machine);
 const aPeer=readConfig(a).peers[readConfig(b).machine],bPeer=readConfig(b).peers[ca.machine];assert.equal(fs.readFileSync(aPeer.secretFile,'utf8'),fs.readFileSync(bPeer.secretFile,'utf8'));
 await assert.rejects(pairingRequest(invite,{action:'request',token:invite.token,peer:{...identity(b),url:other}}),/Invitation/);
 const expired=Buffer.from(JSON.stringify({...invite,expires:Date.now()-1})).toString('base64url');assert.throws(()=>parseInvitation(expired),/Expired/);
 assert.throws(()=>origin('http://127.0.0.1:1'),/HTTPS/);assert.throws(()=>origin('https://example.com'),/LAN IP/);
 }finally{await service?.close();fs.rmSync(base,{recursive:true,force:true});}
});

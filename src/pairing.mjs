import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import { identity, addPeer } from './config.mjs';
import { ensure, text, id, fingerprint, equalSecret, VERSION } from './protocol.mjs';
import { jsonRequest } from './client.mjs';

export function origin(value) {
 const url=new URL(value);ensure(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'Use an HTTPS machine address without path or credentials');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 ensure(net.isIP(host)!==0,'Pairing currently requires an explicit LAN IP');
 return url.origin;
}
function descriptor(value){id(value.machine);text(value.label,100);origin(value.url);ensure(typeof value.certificate==='string'&&value.certificate.length<8192,'Invalid certificate');const cert=new crypto.X509Certificate(value.certificate);ensure(Date.parse(cert.validTo)>Date.now()&&Date.parse(cert.validFrom)<=Date.now(),'Certificate invalid/expired');return {...value,fingerprint:fingerprint(cert.raw)};}
export class Pairing {
 constructor(dir){this.dir=dir;this.invitation=null;this.requests=new Map();}
 invite(url){this.requests.clear();const peer={...identity(this.dir),url:origin(url)};this.invitation={token:crypto.randomBytes(32).toString('hex'),expires:Date.now()+300000,peer};return Buffer.from(JSON.stringify({version:VERSION,...this.invitation})).toString('base64url');}
 pending(){this.expire();return [...this.requests.values()].filter(r=>r.state==='pending').map(({request,peer})=>({request,peer:{machine:peer.machine,label:peer.label,url:peer.url,fingerprint:peer.fingerprint}}));}
 expire(){if(this.invitation?.expires<=Date.now())this.invitation=null;for(const [key,r]of this.requests)if(r.expires<=Date.now())this.requests.delete(key);}
 remote(body){
  this.expire();ensure(body.version===VERSION,'Unsupported pairing version',409);
  if(body.action==='request'){
   ensure(this.invitation&&equalSecret(body.token,this.invitation.token),'Invitation expired or invalid',403);
   ensure(this.requests.size===0,'Invitation already in use',409);
   const peer=descriptor(body.peer);ensure(peer.machine!==this.invitation.peer.machine,'Cannot pair self');
   const request=crypto.randomUUID(),pollToken=crypto.randomBytes(32).toString('hex');
   this.requests.set(request,{request,pollToken,peer,state:'pending',expires:this.invitation.expires});
   return {request,pollToken};
  }
  const r=this.requests.get(body.request);ensure(r&&equalSecret(r.pollToken,body.pollToken),'Pair request expired',403);
  if(r.state==='approved')return {state:r.state,secret:r.secret};
  return {state:r.state};
 }
 approve(request,accepted){this.expire();const r=this.requests.get(request);ensure(r?.state==='pending','No pending pairing request',404);this.invitation=null;
  if(!accepted){r.state='rejected';return;}
  r.secret=crypto.randomBytes(32).toString('hex');addPeer(this.dir,{...r.peer,secret:r.secret});r.state='approved';
 }
 cancel(){this.invitation=null;this.requests.clear();}
}
export function parseInvitation(code){ensure(typeof code==='string'&&code.length<20000,'Invalid invitation');const invite=JSON.parse(Buffer.from(code,'base64url').toString());ensure(invite.version===VERSION&&invite.expires>Date.now()&&invite.expires<=Date.now()+360000&&/^[a-f0-9]{64}$/.test(invite.token),'Expired or invalid invitation');invite.peer=descriptor(invite.peer);return invite;}
export function pairingRequest(invite,body){const url=new URL(invite.peer.url);return jsonRequest(https,{hostname:url.hostname.replace(/^\[|\]$/g,''),port:url.port||443,path:'/pair',method:'POST',ca:invite.peer.certificate,rejectUnauthorized:true,checkServerIdentity:(_host,cert)=>fingerprint(cert.raw)===invite.peer.fingerprint?undefined:new Error('Pairing identity mismatch'),agent:false},{version:VERSION,...body});}
export async function join(dir,code,ownUrl,{confirm,signal,onWaiting=()=>{}}){
 const invite=parseInvitation(code);ensure(await confirm(invite.peer),'Pairing cancelled');
 const peer={...identity(dir),url:origin(ownUrl)};const pending=await pairingRequest(invite,{action:'request',token:invite.token,peer});onWaiting();
 while(Date.now()<invite.expires){
  if(signal?.aborted)throw new Error('Pairing cancelled');
  const reply=await pairingRequest(invite,{action:'poll',request:pending.request,pollToken:pending.pollToken});
  if(reply.state==='approved'){ensure(/^[a-f0-9]{64}$/.test(reply.secret),'Invalid pairing response');addPeer(dir,{...invite.peer,secret:reply.secret});return {machine:invite.peer.machine,label:invite.peer.label};}
  ensure(reply.state==='pending','Pairing rejected',403);await new Promise(r=>setTimeout(r,1000));
 }
 throw new Error('Pairing expired. Create a new invitation on the other machine.');
}

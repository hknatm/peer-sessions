import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startService } from '../src/service.mjs';
import { loadHostRuntime } from './host-runtime.mjs';

test('Pi adapter: no default participation, preserves model, closed backlog/manual accept, busy queue, lifecycle detach',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps-adapter-')); const old=process.env.PI_PEERS_DIR;process.env.PI_PEERS_DIR=dir;
 const service=await startService(dir,{config:{version:1,machine:'host',peers:{},listen:null},interval:60000});
 const {jiti}=await loadHostRuntime();const {default:extension}=await jiti.import(new URL('../extensions/peer.ts',import.meta.url).pathname);
 const events=new Map(),commands=new Map(),tools=new Map(),sent=[],notices=[];let active=['read'],busy=false;
 const ctx={sessionManager:{getSessionId:()=> 'receiver',getSessionFile:()=>'/private/session'},model:{provider:'original',id:'selected'},thinkingLevel:'high',isIdle:()=>!busy,hasPendingMessages:()=>false,hasUI:true,ui:{notify:(...a)=>notices.push(a),setStatus(){},confirm:async()=>true}};
 const pi={on:(n,h)=>events.set(n,h),registerCommand:(n,h)=>commands.set(n,h),registerTool:t=>{tools.set(t.name,t);active.push(t.name);},getActiveTools:()=>active,setActiveTools:n=>active=n,getSessionName:()=> 'Receiver',sendMessage:(m,o)=>{sent.push({m,o});busy=true;}};
 try{
  extension(pi);await events.get('session_start')({reason:'startup'},ctx);assert.equal(service.store.session('receiver'),undefined);assert.deepEqual(active,['read']);
  await commands.get('peers').handler('on',ctx);await commands.get('peers').handler('allow local',ctx);assert.ok(active.includes('peer_send'));
  service.store.configure('sender',{enabled:true,peers:['local']});const st=service.store.attach('sender','sender-owner').token;
  function send(body){const out=service.store.send('sender',st,{to:'host/receiver',body,requestId:crypto.randomUUID()});service.store.receive(out.message,'host');return `local_${out.id}`;}
  const stored=send('store only');await events.get('agent_settled')();await new Promise(r=>setTimeout(r,20));assert.equal(sent.length,0);
  await commands.get('peers').handler(`auto host/sender on`,ctx);await commands.get('peers').handler(`accept ${stored}`,ctx);assert.equal(sent.length,1);assert.equal(sent[0].o.triggerTurn,true);assert.equal(sent[0].o.deliverAs,'followUp');assert.deepEqual(ctx.model,{provider:'original',id:'selected'});assert.equal(ctx.thinkingLevel,'high');
  busy=false;events.get('agent_before_settle')({outcome:'completed'});await events.get('agent_settled')();await new Promise(r=>setTimeout(r,20));assert.equal(service.store.get(stored).state,'handled');
  busy=true;const queued=send('busy queue');await events.get('agent_settled')();await new Promise(r=>setTimeout(r,20));assert.equal(sent.length,1);
  busy=false;await events.get('agent_settled')();await new Promise(r=>setTimeout(r,30));assert.equal(sent.length,2);assert.equal(service.store.get(queued).state,'presented');
  await events.get('session_shutdown')({reason:'reload'});assert.equal(service.store.get(queued).state,'uncertain');const backlog=send('while closed');
  busy=false;await events.get('session_start')({reason:'reload'},ctx);assert.equal(sent.length,2);assert.equal(service.store.get(backlog).eligible,null);assert.equal(service.store.get(queued).eligible,null);
  await commands.get('peers').handler('off',ctx);assert.equal(service.store.session('receiver').enabled,0);assert.ok(!active.includes('peer_send'));
  const fork={...ctx,sessionManager:{getSessionId:()=> 'fork-id',getSessionFile:()=>'/fork'}};await events.get('session_shutdown')({reason:'fork'});await events.get('session_start')({reason:'fork'},fork);assert.equal(service.store.session('fork-id'),undefined);assert.ok(notices.length>0);
 }finally{await events.get('session_shutdown')?.({reason:'quit'});await service.close();if(old===undefined)delete process.env.PI_PEERS_DIR;else process.env.PI_PEERS_DIR=old;fs.rmSync(dir,{recursive:true,force:true});}
});

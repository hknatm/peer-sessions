import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import { startService } from '../src/service.mjs';
import { loadHostRuntime } from './host-runtime.mjs';

test('Pi adapter: no default participation, preserves model, closed backlog/manual accept, busy queue, lifecycle detach',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps-adapter-')); const old=process.env.PI_PEERS_DIR;process.env.PI_PEERS_DIR=dir;
 execFileSync('git',['init',dir],{stdio:'ignore'});
 const service=await startService(dir,{config:{version:1,machine:'host',peers:{},listen:null},interval:60000});
 const {jiti}=await loadHostRuntime();const {default:extension}=await jiti.import(new URL('../extensions/peer.ts',import.meta.url).pathname);
 const events=new Map(),commands=new Map(),tools=new Map(),sent=[],notices=[];let active=['read'],busy=false;
 const ctx={cwd:dir,sessionManager:{getSessionId:()=> 'receiver',getSessionFile:()=>'/private/session'},model:{provider:'original',id:'selected'},thinkingLevel:'high',isIdle:()=>!busy,hasPendingMessages:()=>false,hasUI:true,ui:{notify:(...a)=>notices.push(a),setStatus(){},confirm:async()=>true}};
 const pi={on:(n,h)=>events.set(n,h),registerCommand:(n,h)=>commands.set(n,h),registerTool:t=>{tools.set(t.name,t);active.push(t.name);},getActiveTools:()=>active,setActiveTools:n=>active=n,getSessionName:()=> 'Receiver',sendMessage:(m,o)=>{sent.push({m,o});busy=true;}};
 try{
  extension(pi);await events.get('session_start')({reason:'startup'},ctx);assert.equal(service.store.session('receiver'),undefined);assert.deepEqual(active,['read']);
  await commands.get('peers').handler('on',ctx);await commands.get('peers').handler('allow local',ctx);assert.ok(active.includes('peer_send'));
  service.store.configure('other',{enabled:true,project:{id:'other',label:'Other project'},peers:['local']});service.store.attach('other','other-owner');
  service.store.configure('sender',{enabled:true,project:service.store.session('receiver').project,peers:['local']});const st=service.store.attach('sender','sender-owner').token;
  function send(body){const out=service.store.send('sender',st,{to:'host/receiver',toProject:service.store.session('receiver').project.id,body,requestId:crypto.randomUUID()});service.store.receive(out.message,'host');return `local_${out.id}`;}
  const awareness=await events.get('context')({messages:[]});assert.ok(awareness.messages[0].content.includes('sender'));assert.ok(!awareness.messages[0].content.includes('Other project'));assert.equal(sent.length,0);
  assert.equal(awareness.messages[0].display,false);assert.deepEqual((await tools.get('peer_list').execute()).content[0].type,'text');
  const again=await events.get('context')({messages:awareness.messages});assert.equal(again.messages.filter(m=>m.customType==='peer-presence').length,1);
  const stored=send('store only');await events.get('agent_settled')();await new Promise(r=>setTimeout(r,20));assert.equal(sent.length,0);
  await commands.get('peers').handler(`auto host/sender on`,ctx);await commands.get('peers').handler(`accept ${stored}`,ctx);assert.equal(sent.length,1);assert.equal(sent[0].o.triggerTurn,true);assert.equal(sent[0].o.deliverAs,'followUp');assert.deepEqual(ctx.model,{provider:'original',id:'selected'});assert.equal(ctx.thinkingLevel,'high');
  busy=false;events.get('agent_before_settle')({outcome:'completed'});await events.get('agent_settled')();await new Promise(r=>setTimeout(r,20));assert.equal(service.store.get(stored).state,'handled');
  busy=true;const queued=send('busy queue');await events.get('agent_settled')();await new Promise(r=>setTimeout(r,20));assert.equal(sent.length,1);
  busy=false;await events.get('agent_settled')();await new Promise(r=>setTimeout(r,30));assert.equal(sent.length,2);assert.equal(service.store.get(queued).state,'presented');
  busy=false;events.get('agent_before_settle')({outcome:'completed'});await events.get('agent_settled')();await new Promise(r=>setTimeout(r,30));
  const denied=send('transient claim refusal'),attachment=service.store.attachments.get('receiver').token,claim=service.store.claim.bind(service.store);let refuse=true;
  service.store.claim=(...args)=>{if(refuse){refuse=false;throw Object.assign(new Error('Manual acceptance required'),{status:403});}return claim(...args);};
  await events.get('agent_settled')();await new Promise(r=>setTimeout(r,30));assert.equal(service.store.get(denied).state,'pending');assert.equal(service.store.get(denied).eligible,attachment);assert.equal(service.store.attachments.get('receiver').token,attachment);
  await events.get('agent_settled')();await new Promise(r=>setTimeout(r,30));assert.equal(service.store.get(denied).state,'presented');assert.equal(sent.length,3);
  const compactSend=await tools.get('peer_send').execute('id',{to:'host/sender',body:'done',parent:denied});assert.deepEqual(Object.keys(JSON.parse(compactSend.content[0].text)),['id','state']);assert.ok(compactSend.content[0].text.length<100);
  const compactInbox=await tools.get('peer_inbox').execute('id',{});assert.ok(!compactInbox.content[0].text.includes('"envelope"'));assert.ok(!compactInbox.content[0].text.includes('"fromProject"'));
  assert.ok(sent[2].m.content.length<260);assert.ok(again.messages[0].content.length<600);
  busy=false;events.get('agent_before_settle')({outcome:'completed'});await events.get('agent_settled')();await new Promise(r=>setTimeout(r,30));
  const raced=send('idle changed while claiming');let changeBusy=true;
  service.store.claim=(...args)=>{const row=claim(...args);if(changeBusy){changeBusy=false;busy=true;}return row;};
  await events.get('agent_settled')();await new Promise(r=>setTimeout(r,30));assert.equal(service.store.get(raced).state,'pending');assert.equal(service.store.get(raced).eligible,attachment);assert.equal(sent.length,3);
  busy=false;await events.get('agent_settled')();await new Promise(r=>setTimeout(r,30));assert.equal(service.store.get(raced).state,'presented');assert.equal(sent.length,4);
  busy=false;events.get('agent_before_settle')({outcome:'completed'});await events.get('agent_settled')();await new Promise(r=>setTimeout(r,30));
  const simultaneous=send('concurrent acceptance');await Promise.all([commands.get('peer').handler('accept '+simultaneous,ctx),commands.get('peer').handler('accept '+simultaneous,ctx)]);assert.equal(sent.length,5);assert.equal(service.store.get(simultaneous).state,'presented');
  await events.get('session_shutdown')({reason:'reload'});assert.equal(service.store.get(simultaneous).state,'uncertain');const backlog=send('while closed');
  busy=false;await events.get('session_start')({reason:'reload'},ctx);assert.equal(sent.length,5);assert.equal(service.store.get(backlog).eligible,null);assert.equal(service.store.get(queued).eligible,null);
  await commands.get('peers').handler('off',ctx);assert.equal(service.store.session('receiver').enabled,0);assert.ok(!active.includes('peer_send'));
  const disabled=await events.get('context')({messages:awareness.messages});assert.equal(disabled.messages.length,0);
  const fork={...ctx,sessionManager:{getSessionId:()=> 'fork-id',getSessionFile:()=>'/fork'}};await events.get('session_shutdown')({reason:'fork'});await events.get('session_start')({reason:'fork'},fork);assert.equal(service.store.session('fork-id'),undefined);assert.ok(notices.length>0);
 }finally{await events.get('session_shutdown')?.({reason:'quit'});await service.close();if(old===undefined)delete process.env.PI_PEERS_DIR;else process.env.PI_PEERS_DIR=old;fs.rmSync(dir,{recursive:true,force:true});}
});

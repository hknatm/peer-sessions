import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import { startService } from '../src/service.mjs';
import { loadHostRuntime } from './host-runtime.mjs';

// Provider prompt caches reuse only an unchanged *prefix*. The presence snapshot must therefore never move, change or vanish once
// it has been placed: each request's context must equal the previous request's context followed only by new items.
test('peer presence keeps the provider-visible history append-only (user turns, peer turns, compaction, no-user transcripts)',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps-cache-')); const old=process.env.PI_PEERS_DIR;process.env.PI_PEERS_DIR=dir;
 execFileSync('git',['init',dir],{stdio:'ignore'});
 const service=await startService(dir,{config:{version:1,machine:'host',peers:{},listen:null},interval:60000});
 const {jiti}=await loadHostRuntime();const {default:extension}=await jiti.import(new URL('../extensions/peer.ts',import.meta.url).pathname);
 const events=new Map(),commands=new Map(),notices=[];let active=['read'];
 const ctx={cwd:dir,sessionManager:{getSessionId:()=> 'receiver',getSessionFile:()=>'/private/session'},model:{provider:'p',id:'m'},thinkingLevel:'high',isIdle:()=>true,hasPendingMessages:()=>false,hasUI:true,ui:{notify:(...a)=>notices.push(a),setStatus(){},confirm:async()=>true}};
 const pi={on:(n,h)=>events.set(n,h),registerCommand:(n,h)=>commands.set(n,h),registerTool(t){active.push(t.name);},getActiveTools:()=>active,setActiveTools:n=>active=n,getSessionName:()=> 'Receiver',sendMessage(){}};
 try{
  extension(pi);await events.get('session_start')({reason:'startup'},ctx);
  await commands.get('peers').handler('on',ctx);
  service.store.configure('sender',{enabled:true,project:service.store.session('receiver').project,peers:['local']});service.store.attach('sender','sender-owner');
  const run=async messages=>(await events.get('context')({messages:structuredClone(messages)})).messages;
  const render=m=>JSON.stringify(m);
  const presenceOf=out=>out.filter(m=>m.customType==='peer-presence');
  // Every request must start with the whole previous request, byte for byte; only the end may differ.
  const assertAppendOnly=(prev,next,label)=>{assert.ok(next.length>=prev.length,`${label}: context shrank`);for(let i=0;i<prev.length;i++)assert.equal(render(next[i]),render(prev[i]),`${label}: item ${i} changed or moved`);};
  const u=(text,t)=>({role:'user',content:text,timestamp:t});
  const a=(text,t)=>({role:'assistant',content:text,timestamp:t});
  const tr=(text,t)=>({role:'toolResult',content:text,timestamp:t});
  const peer=(id,t)=>({role:'custom',customType:'peer-message',content:`Peer message ${id}`,display:true,details:{id},timestamp:t});
  const summary=(t,s='S')=>({role:'compactionSummary',summary:s,tokensBefore:1,timestamp:t});

  // 1. Ordinary user turn with a tool loop: one snapshot, placed right after the user message, never moved.
  let history=[u('task',100)];let prev=await run(history);assert.equal(presenceOf(prev).length,1);assert.equal(prev[1].customType,'peer-presence');
  for(let i=0;i<5;i++){history=[...history,a(`a${i}`,110+i),tr(`r${i}`,111+i)];const next=await run(history);assertAppendOnly(prev,next,`tool loop ${i}`);assert.equal(presenceOf(next).length,1);prev=next;}
  // Peers coming and going between requests of the same turn must not rewrite the snapshot.
  service.store.configure('late',{enabled:true,project:service.store.session('receiver').project,peers:['local']});service.store.attach('late','late-owner');
  history=[...history,a('more',200)];let next=await run(history);assertAppendOnly(prev,next,'presence change inside a turn');prev=next;

  // 2. A new user turn adds exactly one more snapshot after itself.
  history=[...history,u('second task',300)];next=await run(history);assertAppendOnly(prev,next,'new user turn');assert.equal(presenceOf(next).length,2);prev=next;

  // 3. Post-compaction transcript with NO real user message: the failing production shape.
  history=[summary(1000),peer('p1',1001)];prev=await run(history);assert.ok(presenceOf(prev).length>=1);
  for(let i=0;i<20;i++){history=[...history,a(`pa${i}`,1100+i),tr(`pr${i}`,1100+i)];if(i%3===0)history=[...history,peer(`p${i+2}`,1200+i)];next=await run(history);assertAppendOnly(prev,next,`peer-only transcript step ${i}`);prev=next;}
  // Snapshot growth is bounded: at most one per anchor message, never one per request.
  assert.ok(presenceOf(prev).length<=1+history.filter(m=>m.customType==='peer-message').length);

  // 4. Losing the lease for a moment (presence socket failure) must not delete placed snapshots.
  service.store.detach('sender');service.store.detach('late');
  history=[...history,a('after detach',2000)];next=await run(history);assertAppendOnly(prev,next,'peers gone');prev=next;
  history=[...history,u('third task',3000)];next=await run(history);assertAppendOnly(prev,next,'new turn after peers gone');

  // 5. Explicit disable still removes presence entirely.
  await commands.get('peers').handler('off',ctx);
  const off=await run(history);assert.equal(presenceOf(off).length,0);
 }finally{await events.get('session_shutdown')?.({reason:'quit'});await service.close();if(old===undefined)delete process.env.PI_PEERS_DIR;else process.env.PI_PEERS_DIR=old;fs.rmSync(dir,{recursive:true,force:true});}
});

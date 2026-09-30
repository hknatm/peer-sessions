import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startService} from '../src/service.mjs';
import {loadHostRuntime} from './host-runtime.mjs';

test('management menu: cancellation, empty sessions, local default, queue controls; no service creation without confirmation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-menu-')),old=process.env.PI_PEERS_DIR;process.env.PI_PEERS_DIR=dir;
 const service=await startService(dir,{config:{version:1,machine:'host',peers:{},listen:null}});
 const {jiti}=await loadHostRuntime(),extension=(await jiti.import(new URL('../extensions/peer.ts',import.meta.url).pathname)).default;
 const events={},commands={},notices=[];let active=[],choices=[];
 const ctx={hasUI:true,mode:'tui',sessionManager:{getSessionId:()=> 's',getSessionFile:()=>'/s'},isIdle:()=>true,hasPendingMessages:()=>false,model:{provider:'p',id:'m'},ui:{setStatus(){},notify:(...args)=>notices.push(args),select:async()=>choices.shift(),editor:async()=>undefined,confirm:async()=>false}};
 try{
 extension({on:(n,h)=>events[n]=h,registerCommand:(n,c)=>commands[n]=c,registerTool(){},getActiveTools:()=>active,setActiveTools:n=>active=n,getSessionName:()=> 'Session'});
 await events.session_start({reason:'startup'},ctx);choices=['Enable this session'];await commands.peer.handler('',ctx);assert.deepEqual(service.store.session('s').peers,['local']);
 choices=['Sessions'];await commands.peer.handler('',ctx);assert.ok(!notices.some(n=>n[1]==='error'));
 choices=['Outbox','Pause pending sends','Back'];await commands.peer.handler('',ctx);choices=['Inbox',undefined];await commands.peer.handler('',ctx);
 choices=[undefined];await commands.peer.handler('',ctx);await commands.peer.handler('disable',ctx);assert.equal(service.store.session('s').enabled,0);
 }finally{await events.session_shutdown?.();await service.close();if(old===undefined)delete process.env.PI_PEERS_DIR;else process.env.PI_PEERS_DIR=old;fs.rmSync(dir,{recursive:true,force:true});}
});

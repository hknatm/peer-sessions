import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serviceSpec,stageRuntime,installService } from '../src/setup.mjs';
import {execFileSync} from 'node:child_process';
import { initialize,readConfig } from '../src/config.mjs';
import { startService } from '../src/service.mjs';
const root=new URL('..',import.meta.url).pathname;

test('service specifications escape OS arguments and preserve private state',()=>{
 const mac=serviceSpec({platform:'darwin',home:'/tmp/home',dir:'/private/a&b',entry:'/runtime/<test>/cli.mjs',node:'/node',uid:100});assert.ok(mac.content.includes('/private/a&amp;b'));assert.ok(mac.content.includes('&lt;test&gt;'));assert.equal(mac.target,'gui/100/dev.pi.peer-sessions');assert.ok(mac.content.includes('<integer>63</integer>'));
 const linux=serviceSpec({platform:'linux',home:'/tmp/home',dir:'/private/with space/%state',entry:'/runtime/cli.mjs',node:'/node'});assert.ok(linux.content.includes('%%state'));assert.ok(linux.content.includes('UMask=0077'));assert.throws(()=>serviceSpec({platform:'win32'}),/Supported/);
});
test('stage immutable service runtime without any state or credentials',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-stage-'));
 try{const first=stageRuntime(dir,root),next=stageRuntime(dir,root);assert.equal(first.entry,next.entry);assert.ok(fs.existsSync(first.entry));const names=fs.readdirSync(path.dirname(first.entry));assert.ok(!names.includes('identity.key')&&!names.includes('config.json'));assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(first.entry),'package.json'))).type,'module');}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('setup uses copied runtime and OS manager; repeat update, state retained',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'peer-setup-')),dir=path.join(base,'state'),home=path.join(base,'home');let service;const calls=[];
 try{
 initialize(dir);const machine=readConfig(dir).machine;
 // Real socket/server, fake OS manager so this test never installs host service jobs.
 service=await startService(dir);const out=await installService(dir,{verifyRuntime:false,root,home,run:(cmd,args)=>calls.push({cmd,args})});assert.equal(out.machine,machine);
 const file=serviceSpec({home,dir,entry:''}).file;assert.ok(fs.existsSync(file));const content=fs.readFileSync(file,'utf8');assert.ok(content.includes('/runtime/'));assert.ok(!content.includes(root));
 await installService(dir,{verifyRuntime:false,root,home,run:(cmd,args)=>calls.push({cmd,args})});assert.equal(readConfig(dir).machine,machine);assert.ok(calls.length>=3);if(process.platform==='darwin')assert.ok(execFileSync('/usr/bin/plutil',['-lint',file],{encoding:'utf8'}).includes('OK'));
 }finally{await service?.close();fs.rmSync(base,{recursive:true,force:true});}
});
test('activation failure restores previous unit without leaking errors or replacing identity',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'peer-rollback-')),dir=path.join(base,'state'),home=path.join(base,'home');
 try{initialize(dir);const machine=readConfig(dir).machine,spec=serviceSpec({home,dir,entry:'/old/cli.mjs'});fs.mkdirSync(path.dirname(spec.file),{recursive:true});fs.writeFileSync(spec.file,spec.content);let starts=0;
 await assert.rejects(installService(dir,{root,home,run:(cmd,args)=>{if(args.includes('bootstrap')||args.includes('enable')){if(++starts===1)throw new Error('activation failed');}}}),/previous service restored/);
 assert.equal(fs.readFileSync(spec.file,'utf8'),spec.content);assert.equal(readConfig(dir).machine,machine);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

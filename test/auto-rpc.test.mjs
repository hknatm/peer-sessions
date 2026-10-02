import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {startService} from '../src/service.mjs';
import {loadHostRuntime} from './host-runtime.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,attempts=250){for(let i=0;i<attempts;i++){if(check())return;await sleep(20);}throw new Error('Timed out waiting for real Pi queue flow');}

test('real Pi lifecycle: busy auto messages drain one at a time after settlement with a local zero-cost provider',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-auto-')),state=path.join(dir,'state'),agent=path.join(dir,'agent');fs.mkdirSync(state,{mode:0o700});fs.mkdirSync(agent);
 execFileSync('git',['init',dir],{stdio:'ignore'});
 const provider=path.join(dir,'provider.ts');
 fs.writeFileSync(provider,`import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
 export default function(pi){pi.registerProvider('peer-test',{api:'peer-test',baseUrl:'http://unused.invalid',apiKey:'local-test-only',models:[{id:'stub',name:'Local stub',reasoning:false,input:['text'],contextWindow:100000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(model,context){
 const stream=createAssistantMessageEventStream();const message={role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};
 setTimeout(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:'stop',message});stream.end();},300);return stream;
 }});}`);
 const service=await startService(state,{config:{version:1,machine:'host',peers:{},listen:null},interval:60000});let child,lines;
 try{
 const {cli}=await loadHostRuntime();child=spawn(process.execPath,[cli,'-e',provider,'-e',new URL('../extensions/peer.ts',import.meta.url).pathname,'--mode','rpc','--provider','peer-test','--model','stub','--no-approve','--session-dir',path.join(dir,'sessions')],{cwd:dir,env:{...process.env,PI_PEERS_DIR:state,PI_CODING_AGENT_DIR:agent},stdio:['pipe','pipe','pipe']});
 const records=[];let stderr='';child.stderr.on('data',c=>stderr+=c);lines=createInterface({input:child.stdout});lines.on('line',line=>records.push(JSON.parse(line)));
 child.stdin.write(JSON.stringify({type:'prompt',id:'enable',message:'/peer enable'})+'\n');await until(()=>records.some(r=>r.id==='enable'&&r.success));
 const s=service.store,sid=s.db.prepare('SELECT id FROM sessions').get().id,c=s.session(sid);
 s.configure('sender',{enabled:true,project:c.project,peers:['local']});const sender=s.attach('sender','sender').token;s.configure(sid,{...c,enabled:true,auto:['host/sender']});
 child.stdin.write(JSON.stringify({type:'prompt',id:'work',message:'Local test only'})+'\n');await until(()=>records.some(r=>r.type==='agent_start'));
 const attachment=s.attachments.get(sid).token;const ids=[];for(let i=0;i<2;i++){const out=s.send('sender',sender,{to:`host/${sid}`,toProject:c.project.id,body:`Result ${i}; no reply needed`,requestId:crypto.randomUUID()});s.receive(out.message,'host');ids.push(`local_${out.id}`);assert.ok(s.get(ids[i]).eligible);}
 await until(()=>ids.every(id=>s.get(id).state==='handled')&&records.filter(r=>r.type==='agent_settled').length===3);
 assert.equal(records.filter(r=>r.type==='agent_start').length,3);assert.equal(records.filter(r=>r.type==='agent_settled').length,3);
 assert.equal(s.usage(sid).used,2);assert.equal(s.attachments.get(sid).token,attachment);
 const idle=s.send('sender',sender,{to:`host/${sid}`,toProject:c.project.id,body:'Idle arrival; no reply needed',requestId:crypto.randomUUID()});s.receive(idle.message,'host');
 await until(()=>s.get(`local_${idle.id}`).state==='handled'&&records.filter(r=>r.type==='agent_settled').length===4,900);assert.equal(records.filter(r=>r.type==='agent_start').length,4);assert.equal(s.usage(sid).used,3);
 assert.equal(stderr,'');assert.ok(!records.some(r=>r.type==='extension_error'));assert.ok(!records.some(r=>r.method==='notify'&&r.notifyType==='error'));
 const messages=records.filter(r=>r.type==='message_end'&&r.message?.customType==='peer-message');assert.equal(messages.length,3);assert.ok(messages.every(r=>r.message.content.includes('reply parent=')));
 }finally{if(child?.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.stdin.end();const killer=setTimeout(()=>child.kill('SIGKILL'),5000);await exit;clearTimeout(killer);}lines?.close();await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});

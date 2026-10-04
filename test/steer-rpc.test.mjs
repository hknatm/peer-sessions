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
async function until(check){for(let i=0;i<1000;i++){if(check())return;await sleep(20);}throw new Error('Timed out in real Pi steering flow');}
test('real Pi steering: two urgent updates consumed inside active run; normal message waits for settlement; no abort/extra acknowledgements',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-srpc-')),state=path.join(dir,'state'),agent=path.join(dir,'agent'),calls=path.join(dir,'calls');fs.mkdirSync(state,{mode:0o700});fs.mkdirSync(agent);execFileSync('git',['init',dir],{stdio:'ignore'});
 const provider=path.join(dir,'provider.ts');fs.writeFileSync(provider,`import fs from 'node:fs';import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
 let count=0;export default function(pi){pi.registerProvider('peer-steer-test',{api:'peer-steer-test',baseUrl:'http://unused.invalid',apiKey:'local-test-only',models:[{id:'stub',name:'Local stub',reasoning:false,input:['text'],contextWindow:100000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(model,context){
 fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(context.messages)+'\\n');const stream=createAssistantMessageEventStream(),message={role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};setTimeout(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:'stop',message});stream.end();},++count===1?3500:400);return stream;
 }});}`);
 const service=await startService(state,{config:{version:1,machine:'host',peers:{},listen:null},interval:60000});let child,lines;
 try{
 const {cli}=await loadHostRuntime();child=spawn(process.execPath,[cli,'-e',provider,'-e',new URL('../extensions/peer.ts',import.meta.url).pathname,'--mode','rpc','--provider','peer-steer-test','--model','stub','--no-approve','--session-dir',path.join(dir,'sessions')],{cwd:dir,env:{...process.env,PI_PEERS_DIR:state,PI_CODING_AGENT_DIR:agent},stdio:['pipe','pipe','pipe']});
 const records=[];let stderr='';child.stderr.on('data',c=>stderr+=c);lines=createInterface({input:child.stdout});lines.on('line',line=>records.push(JSON.parse(line)));
 child.stdin.write(JSON.stringify({type:'prompt',id:'enable',message:'/peer enable'})+'\n');await until(()=>records.some(r=>r.id==='enable'&&r.success));
 const s=service.store,sid=s.db.prepare('SELECT id FROM sessions').get().id,c=s.session(sid);s.configure('sender',{enabled:true,project:c.project,peers:['local']});const sender=s.attach('sender','sender').token;s.configure(sid,{...c,enabled:true,auto:['host/sender'],steer:['host/sender']});
 child.stdin.write(JSON.stringify({type:'prompt',id:'work',message:'Local work'})+'\n');await until(()=>fs.existsSync(calls));const ids=[];
 for(const [mode,kind,body]of [['urgent','blocker','Pause API change'],['urgent','proposal','Confirm approach B first'],['normal','result','Independent result']]){const row=s.send('sender',sender,{to:`host/${sid}`,toProject:c.project.id,body,mode,kind,requestId:crypto.randomUUID()});s.receive(row.message,'host');ids.push(`local_${row.id}`);}
 await until(()=>s.get(ids[0]).state==='presented');assert.equal(fs.readFileSync(calls,'utf8').trim().split('\n').length,1);assert.equal(s.get(ids[2]).state,'pending');assert.equal(records.filter(r=>r.type==='agent_settled').length,0);
 await until(()=>ids.every(id=>s.get(id).state==='handled')&&records.filter(r=>r.type==='agent_settled').length===2);
 assert.equal(records.filter(r=>r.type==='agent_start').length,2);assert.equal(s.usage(sid).used,3);
 const requests=fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);assert.equal(requests.length,4);assert.ok(JSON.stringify(requests[1]).includes('Pause API change'));assert.ok(JSON.stringify(requests[2]).includes('Confirm approach B first'));assert.ok(!JSON.stringify(requests[2]).includes('Independent result'));
 const firstSettle=records.findIndex(r=>r.type==='agent_settled');for(const id of ids.slice(0,2))assert.ok(records.findIndex(r=>r.type==='message_end'&&r.message?.details?.id===id)<firstSettle);
 assert.ok(records.findIndex(r=>r.type==='message_end'&&r.message?.details?.id===ids[2])>firstSettle);assert.equal(stderr,'');assert.ok(!records.some(r=>r.type==='extension_error'));
 }finally{if(child?.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.stdin.end();const killer=setTimeout(()=>child.kill('SIGKILL'),5000);await exit;clearTimeout(killer);}lines?.close();await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});

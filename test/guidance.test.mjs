import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {startService} from '../src/service.mjs';
import {initialize,readConfig} from '../src/config.mjs';
import {requestLocal} from '../src/client.mjs';
import {loadHostRuntime} from './host-runtime.mjs';

async function menuFixture(run,{running=true,pairing=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-ui-')),old=process.env.PI_PEERS_DIR;process.env.PI_PEERS_DIR=dir;
 execFileSync('git',['init',dir],{stdio:'ignore'});
 if(pairing)initialize(dir);
 const service=running?await startService(dir,{config:pairing?{...readConfig(dir),listen:{host:'127.0.0.1',port:0}}:{version:1,machine:'host',peers:{},listen:null},interval:60000}):undefined;
 const {jiti}=await loadHostRuntime(),extension=(await jiti.import(new URL('../extensions/peer.ts',import.meta.url).pathname)).default;
 const events={},commands={},notices=[],screens=[];let active=[],choices=[],inputs=[],confirmations=0,presented=0,confirmResult=false;
 const ctx={cwd:dir,hasUI:true,mode:'tui',sessionManager:{getSessionId:()=> 's',getSessionFile:()=>'/s'},isIdle:()=>true,hasPendingMessages:()=>false,model:{provider:'p',id:'m'},ui:{setStatus(){},notify:(...args)=>notices.push(args),select:async(title,options)=>{screens.push({title,options});const choice=choices.shift();if(choice!==undefined)assert.ok(options.includes(choice),`Missing choice ${choice} in ${title}`);return choice;},input:async()=>inputs.shift(),editor:async()=>undefined,confirm:async()=>{confirmations++;return confirmResult;}}};
 try{
  extension({on:(n,h)=>events[n]=h,registerCommand:(n,c)=>commands[n]=c,registerTool(){},getActiveTools:()=>active,setActiveTools:n=>active=n,getSessionName:()=> 'Session',appendEntry(){},sendMessage:()=>presented++});
  await events.session_start({reason:'startup'},ctx);
  await run({dir,service,ctx,notices,screens,commands,jiti,get confirmations(){return confirmations;},get presented(){return presented;},events,confirm(value){confirmResult=value;},async command(args='',select=[],input=[]){choices=[...select];inputs=[...input];await commands.peer.handler(args,ctx);assert.equal(choices.length,0);assert.equal(inputs.length,0);}});
 }finally{await events.session_shutdown?.();await service?.close();if(old===undefined)delete process.env.PI_PEERS_DIR;else process.env.PI_PEERS_DIR=old;fs.rmSync(dir,{recursive:true,force:true});}
}

test('help and pairing guidance work before setup; cancellation never initializes service state',async()=>{
 await menuFixture(async f=>{
  await f.command('', ['Settings & help','Connection & authentication','Back']);
  assert.ok(f.notices.some(([text])=>text.includes('https://192.168.1.20:7443')&&text.includes('no token')));
  assert.ok(f.screens[0].title.includes('service unavailable'));
  await f.command('pair',['Connection guidance']);
  assert.equal(f.confirmations,0);assert.equal(fs.existsSync(path.join(f.dir,'config.json')),false);
  await f.command('pair',[undefined]);assert.equal(f.confirmations,0);
  await f.command('help');assert.ok(f.notices.some(([text])=>text.includes('Command reference')));
  await f.command('service',['Status']);assert.ok(f.notices.some(([text])=>text.includes('Update/reinstall service')));
  await f.command('status');assert.ok(f.notices.some(([text,type])=>type==='error'&&text.includes('Queues are preserved')));
 },{running:false});
});

test('command discovery, unknown command error, readable status and no self-target',async()=>{
 await menuFixture(async f=>{
  await f.command('enable');
  assert.equal(f.commands.peer.getArgumentCompletions('se')[0].value,'settings');
  assert.ok(f.commands.peers.getArgumentCompletions('').some(c=>c.value==='help'));
  await f.command('typo');assert.ok(f.notices.some(([text])=>text.includes('Unknown /peer command')));
  await f.command('status');assert.ok(f.notices.some(([text])=>text.includes('enabled · attached')&&text.includes('LAN listener: off')));
  await f.command('', ['Sessions']);assert.ok(f.notices.some(([text])=>text.includes('No other permitted sessions')));
  assert.ok(f.screens[0].options.includes('Status'));
 });
});

test('queue menus: empty guidance, reversible paging, state-appropriate actions and cancelled acceptance',async()=>{
 await menuFixture(async f=>{
  await f.command('enable');await f.command('', ['Inbox','Back']);await f.command('', ['Outbox','Back']);
  assert.ok(f.notices.some(([text])=>text.includes('Inbox empty')));assert.ok(f.notices.some(([text])=>text.includes('Outbox empty')));
  const store=f.service.store;store.configure('sender',{enabled:true,project:store.session('s').project,peers:['local']});const token=store.attach('sender','sender').token;
  const receiver=store.attachments.get('s').token,ids=[];
  for(let i=0;i<6;i++){const row=store.send('sender',token,{to:'host/s',toProject:store.session('s').project.id,body:`Message ${i}`,requestId:crypto.randomUUID()});store.receive(row.message,'host');ids.push(`local_${row.id}`);}
  store.claim('s',receiver,ids[0],true);store.settled('s',receiver,ids[0],true);
  await f.command('', ['Inbox','Next page','Previous page','Back']);
  assert.ok(f.screens.some(s=>s.title==='Inbox — page 2'&&s.options.includes('Previous page')));
  const handled=store.get(ids[0]);const historyLabel=`1. handled · Message 0 · ${handled.id.slice(0,8)}`;
  await f.command('', ['Inbox','Next page',historyLabel,'Back','Back']);
  assert.deepEqual(f.screens.filter(s=>s.title.includes(`Message ${ids[0]}`)).at(-1).options,['Back']);
  const label=f.screens.filter(s=>s.title==='Inbox — page 1').at(-1).options[0];
  await f.command('', ['Inbox',label,'Accept and start turn','Back']);
  assert.equal(f.presented,0);assert.equal(store.get(ids[1]).state,'pending');assert.ok(f.confirmations>0);
  f.confirm(true);await f.command('', ['Inbox',label,'Accept and start turn']);
  assert.equal(f.presented,1);assert.equal(store.get(ids[1]).state,'presented');
  assert.ok(!f.screens.at(-1).title.startsWith('Peer sessions —'));
 });
});

test('pairing addresses: HTTPS normalization without transport downgrade or URL credentials',async()=>{
 const {jiti}=await loadHostRuntime();const {pairingAddress}=await jiti.import(new URL('../extensions/manage.ts',import.meta.url).pathname);
 for(const [input,wanted]of [['192.168.1.20','https://192.168.1.20:7443'],[' 192.168.1.20:7444 ','https://192.168.1.20:7444'],['https://192.168.1.20:7443','https://192.168.1.20:7443'],['2001:db8::1','https://[2001:db8::1]:7443'],['[2001:db8::1]:7444','https://[2001:db8::1]:7444']])assert.equal(pairingAddress(input).origin,wanted);
 for(const input of ['http://192.168.1.20:7443','https://192.168.1.20:7443/path','https://192.168.1.20:7443?token=redacted','https://name.invalid:7443','https://192.168.1.20','0.0.0.0','::','not an address',''])assert.throws(()=>pairingAddress(input));
});

test('cross-project menu approval is reciprocal, cancellation-safe and separate from auto-start',async()=>{
 await menuFixture(async f=>{
  await f.command('enable');const own=f.service.store.session('s');
  f.service.store.configure('other',{enabled:true,project:{id:'other',label:'Other project'},peers:['local']});
  const label='1. Other project · host/other';
  await f.command('cooperate',['Allow local project',label]);assert.deepEqual(f.service.store.session('s').allowedProjects,[]);
  f.confirm(true);await f.command('cooperate',['Allow local project',label]);assert.deepEqual(f.service.store.session('s').allowedProjects,['host/other']);assert.deepEqual(f.service.store.session('s').auto,[]);
  assert.equal((await requestLocal(f.dir,'list',{session:'s',token:f.service.store.attachments.get('s').token})).length,0);
  f.service.store.configure('other',{enabled:true,project:{id:'other',label:'Other project'},allowedProjects:[`host/${own.project.id}`],peers:['local']});
  assert.equal((await requestLocal(f.dir,'list',{session:'s',token:f.service.store.attachments.get('s').token}))[0].address,'host/other');
  await f.command('cooperate',['Revoke project','host/other']);assert.deepEqual(f.service.store.session('s').allowedProjects,[]);
 });
});

test('non-Git roots need explicit confirmation; cancellation does not enable participation',async()=>{
 await menuFixture(async f=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'peer-nongit-'));f.ctx.cwd=folder;try{
  await f.command('enable',[],[undefined]);assert.equal(f.service.store.session('s'),undefined);
  await f.command('enable',[],[folder]);assert.equal(f.service.store.session('s'),undefined);
  f.confirm(true);await f.command('enable',[],[folder]);assert.ok(f.service.store.session('s').enabled);assert.equal(f.confirmations,2);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
 });
});

test('listener activation failure restores previous configuration without exposing manager errors',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-listen-'));
 const {jiti}=await loadHostRuntime();const {changeListener}=await jiti.import(new URL('../extensions/manage.ts',import.meta.url).pathname);
 try{
  initialize(dir);const previous=readConfig(dir);let attempts=0;
  await assert.rejects(changeListener(dir,{host:'192.168.1.20',port:7443},{restart:async()=>{
   if(++attempts===1){assert.equal(readConfig(dir).listen.port,7443);throw Object.assign(new Error('manager output should stay private'),{code:'EADDRNOTAVAIL'});}
   assert.equal(readConfig(dir).listen,null);
  }}),error=>error.message.includes('previous listener restored')&&error.message.includes('EADDRNOTAVAIL')&&!error.message.includes('manager output'));
  assert.equal(attempts,2);assert.deepEqual(readConfig(dir),previous);
  await assert.rejects(changeListener(dir,{host:'192.168.1.20',port:7443},{restart:async()=>{throw new Error('failed');}}),/activation and recovery failed/);
  assert.deepEqual(readConfig(dir),previous);
  await changeListener(dir,{host:'127.0.0.1',port:7444},{restart:async()=>{}});
  assert.deepEqual(readConfig(dir).listen,{host:'127.0.0.1',port:7444});assert.equal(readConfig(dir).machine,previous.machine);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('invalid pairing address retries without changing listener; approval Back retains pending request',async()=>{
 await menuFixture(async f=>{
  const before=readConfig(f.dir).listen;
  await f.command('pair',['Create invitation'],['http://127.0.0.1:7443',undefined]);
  assert.deepEqual(readConfig(f.dir).listen,before);assert.ok(f.notices.some(([text,type])=>type==='error'&&text.includes('HTTPS')));
  const own=readConfig(f.dir),url=`https://127.0.0.1:${f.service.address.port}`;
  const {invitation}=await requestLocal(f.dir,'pair-invite',{url});
  const {parseInvitation,pairingRequest}=await import('../src/pairing.mjs');const invite=parseInvitation(invitation);
  await pairingRequest(invite,{action:'request',token:invite.token,peer:{...invite.peer,machine:'other',label:'Other',url:'https://127.0.0.1:7444'}});
  await f.command('pair',['Approve waiting request','Back']);
  assert.equal((await requestLocal(f.dir,'pair-pending')).length,1);assert.equal(Object.keys(readConfig(f.dir).peers).length,0);
  await f.command('pair',['Approve waiting request',undefined]);
  assert.equal((await requestLocal(f.dir,'pair-pending')).length,1);assert.equal(readConfig(f.dir).machine,own.machine);
  await f.command('pair',['Approve waiting request','Reject request']);
  assert.equal((await requestLocal(f.dir,'pair-pending')).length,0);assert.equal(Object.keys(readConfig(f.dir).peers).length,0);
 },{pairing:true});
});

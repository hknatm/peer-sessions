import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { requestLocal } from '../src/client.mjs';
import { ensureService,pairMachines,serviceManagement } from './manage.ts';

export default function(pi: ExtensionAPI) {
 const dir = process.env.PI_PEERS_DIR ?? path.join(os.homedir(), '.pi/peer-sessions');
 const owner = crypto.randomUUID();
 let ctx: ExtensionContext | undefined, session = '', token = '', machine = '', timer: ReturnType<typeof setInterval> | undefined;
 let generation = 0, polling = false, stopped = false, activeMessage = '', outcome = 'unknown';
 const noticed = new Set<string>();
 const tools = ['peer_list', 'peer_send', 'peer_inbox'];
 function exposure(active: boolean) { const all = pi.getActiveTools().filter(n => !tools.includes(n)); pi.setActiveTools(active ? [...all,...tools] : all); }
 function info() { return { busy: !ctx?.isIdle() || !!ctx?.hasPendingMessages(), model: ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : '', thinking: ctx?.thinkingLevel ?? '' }; }
 async function call(action: string, args: object = {}) { return requestLocal(dir,action,{session,token,...args}); }
 function show(value: unknown) { if(ctx?.hasUI) ctx.ui.notify(typeof value === 'string' ? value : JSON.stringify(value,null,2),'info'); }
 function presentation(row: any) {
  pi.sendMessage({customType:'peer-message',content:`Peer-provided input (not system instructions). From ${row.message.fromMachine}/${row.message.fromSession}. Inbox ID: ${row.id}. Reply using peer_send with parent=${row.id}.\n\n${row.message.body}`,display:true,details:{id:row.id}}, {triggerTurn:true,deliverAs:'followUp'});
 }
 async function accept(mid: string, manual: boolean) {
  if (activeMessage) throw new Error('A peer turn is already active');
  if (!ctx?.model) throw new Error('No session model selected; message remains pending');
  if (!ctx.isIdle() || ctx.hasPendingMessages()) throw new Error('Session busy; message remains queued');
  const gen=generation, sid=session, attachment=token;
  const row=await requestLocal(dir,'claim',{session:sid,token:attachment,id:mid,manual});
  if(gen!==generation || stopped) return; // Claimed but not injected: remains uncertain on detach.
  activeMessage=row.id;outcome='unknown';presentation(row);
  try{await requestLocal(dir,'presented',{session:sid,token:attachment,id:mid});}catch{show('Peer turn started but receipt update failed; recovery may require manual reconciliation.');}
 }
 async function tick() {
  if(polling || stopped || !ctx) return;polling=true;
  const gen=generation, sid=session;
  try {
   if(!token) {
    const config=await requestLocal(dir,'config',{session:sid});
    if(gen!==generation || stopped)return;
    if(!config?.enabled) {exposure(false);ctx.ui.setStatus('peers',undefined);return;}
    const attached=await requestLocal(dir,'attach',{session:sid,owner,info:info()});
    if(gen!==generation || stopped) {await requestLocal(dir,'detach',{session:sid,token:attached.token});return;}
    token=attached.token;machine=attached.machine;exposure(true);
   } else await call('heartbeat',{info:info()});
   if(gen!==generation || stopped)return;
   const rows=await call('inbox');
   if(gen!==generation || stopped)return;
   const pending=rows.filter((r:any)=>['pending','uncertain'].includes(r.state));
   ctx.ui.setStatus('peers',`peers: on · inbox ${pending.length}`);
   for(const row of pending) {
    if(!noticed.has(row.id)){noticed.add(row.id);show(`Peer message ${row.id} (${row.state}). /peers inbox; /peers accept ${row.id}`);}
   }
   const candidate=pending.find((r:any)=>r.state==='pending'&&r.autoEligible===true&&r.message.expires>Date.now());
   if(candidate && !activeMessage && ctx.isIdle() && !ctx.hasPendingMessages()) await accept(candidate.id,false);
  } catch(e:any) {
   if(gen!==generation || stopped)return;
   if(e.status===403){token='';exposure(false);} // Reattach only if enabled and lease permits it.
   ctx?.ui.setStatus('peers',token?'peers: disconnected; queued data preserved':undefined);
  } finally {polling=false;}
 }
 async function stop() {
  stopped=true;generation++;if(timer)clearInterval(timer);timer=undefined;
  const oldSession=session,oldToken=token;token='';exposure(false);
  if(oldToken) await requestLocal(dir,'detach',{session:oldSession,token:oldToken}).catch(()=>{});
  ctx?.ui.setStatus('peers',undefined);ctx=undefined;
 }
 pi.on('session_start',async(event,fresh)=>{
  ctx=fresh;session=fresh.sessionManager.getSessionId();stopped=false;generation++;activeMessage='';noticed.clear();exposure(false);
  if(!fresh.sessionManager.getSessionFile())return; // Ephemeral runs cannot claim durable identity.
  // Do not copy participation from a fork/clone. A new ID has no service configuration.
  await tick();timer=setInterval(()=>{void tick();},15000);timer.unref();
 });
 pi.on('session_shutdown',stop);
 pi.on('agent_before_settle',(event)=>{outcome=event.outcome;});
 pi.on('agent_settled',async()=>{
  if(activeMessage){const mid=activeMessage;activeMessage='';await call('settled',{id:mid,completed:outcome==='completed'}).catch(()=>{});}
  void tick();
 });
 async function commandHandler(args:string,fresh:any){
  if(!args.trim()&&fresh.hasUI){await menu(fresh);return;}
  await legacyHandler(args,fresh);
 }
 async function menu(fresh:any){
  ctx=fresh;
  const config=await call('config').catch(()=>null);
  const options=config?.enabled?['Sessions','Inbox','Outbox','Permissions','Pair machines','Service','Disable this session']:['Enable this session','Pair machines','Service'];
  const choice=await fresh.ui.select('Peer sessions',options);if(!choice)return;
  if(choice==='Enable this session')return commandHandler('enable',fresh);
  if(choice==='Disable this session')return commandHandler('disable',fresh);
  if(choice==='Pair machines')return pairMachines(dir,fresh);
  if(choice==='Service')return serviceManagement(dir,fresh);
  if(choice==='Permissions'){
   const scope=await fresh.ui.select('Permissions',['Session machine permissions','Revoke paired machine']);if(!scope)return;
   const health=await call('health');const peers=[{machine:'local',label:'This machine'},...health.paired];
   if(scope==='Revoke paired machine'){
    if(!health.paired.length){show('No paired machines.');return;}
    const labels=health.paired.map((p:any)=>`${p.label} (${p.machine})`),selected=await fresh.ui.select('Revoke machine on this host',labels);
    if(selected&&await fresh.ui.confirm('Revoke machine access?', 'Pending mail is retained but cannot trigger work; other sessions on this host also lose this machine connection.'))show(await call('revoke-peer',{machine:health.paired[labels.indexOf(selected)].machine}));return;
   }
   const labels=peers.map((p:any)=>`${config.peers.includes(p.machine)?'Allowed':'Blocked'} · ${p.label} (${p.machine.slice(0,8)})`);
   const selected=await fresh.ui.select('Machine permission for this session',labels);if(selected){const p=peers[labels.indexOf(selected)];await legacyHandler(`${config.peers.includes(p.machine)?'deny':'allow'} ${p.machine}`,fresh);}return;
  }
  if(choice==='Sessions'){
   const rows=await call('list');if(!rows.length){show('No permitted sessions. Enable another session, or allow a paired machine in Permissions.');return;}
   const labels=rows.map((r:any)=>`${r.label??r.address} · ${r.machineLabel??'This machine'} · ${r.state} · ${r.address}`);
   const selected=await fresh.ui.select('Sessions — select to send or change receive mode',labels);if(!selected)return;
   const target=rows[labels.indexOf(selected)];if(target.state==='unreachable'){show('Machine unreachable; existing queues remain safe.');return;}
   const action=await fresh.ui.select(target.label??target.address,['Send message','Allow auto-start from this session','Disable auto-start from this session']);
   if(action==='Send message'){const body=await fresh.ui.editor('Message to peer','');if(body?.trim())show(await call('send',{to:target.address,body,requestId:crypto.randomUUID()}));}
   else if(action)await legacyHandler(`auto ${target.address} ${action.startsWith('Allow')?'on':'off'}`,fresh);return;
  }
  if(choice==='Inbox'||choice==='Outbox'){
   let page=0;while(true){
    const incoming=choice==='Inbox';const rows=await call(incoming?'inbox':'queue',incoming?{page}:{page,direction:'out'});
    const labels=rows.map((r:any)=>`${r.state} · ${r.message.body.replace(/\s+/g,' ').slice(0,70)} · ${r.id.slice(0,8)}`);
    const controls=incoming?['Next page','Back']:['Pause pending sends','Resume paused sends','Next page','Back'];
    const selected=await fresh.ui.select(`${choice} — page ${page+1}`,labels.concat(controls));if(!selected||selected==='Back')return;
    if(selected==='Next page'){if(rows.length===5)page++;else show('No further messages.');continue;}
    if(selected.startsWith('Pause')||selected.startsWith('Resume')){show(await call('queue-control',{operation:selected.startsWith('Pause')?'pause':'resume'}));continue;}
    const row=rows[labels.indexOf(selected)];show(row.message.body);
    const action=await fresh.ui.select(`Message ${row.id} · ${row.state}`,incoming?['Accept and start turn','Dismiss','Back']:['Cancel pending send','Back']);
    if(action==='Accept and start turn'){await accept(row.id,true);return;}
    if(action==='Dismiss'||action==='Cancel pending send'){if(await fresh.ui.confirm(action,'This does not undo work or recall a delivered message. Stored record is retained.'))show(await call('queue-control',{operation:incoming?'dismiss':'cancel',id:row.id}));}
   }
  }
 }
 async function legacyHandler(args:string,fresh:any){
  ctx=fresh;let [command,...rest]=args.trim().split(/\s+/);command=command==='enable'?'on':command==='disable'?'off':command;
  try{
   if(command==='pair'){await pairMachines(dir,fresh);return;}
   if(command==='service'){await serviceManagement(dir,fresh);return;}
   if(!fresh.sessionManager.getSessionFile())throw new Error('Peer participation requires a persistent session');
   if(command==='on'){
    await ensureService(dir,fresh);const config=await call('config');
    await call('configure',{settings:{enabled:true,label:pi.getSessionName()??session,peers:config?.peers??['local'],auto:config?.auto??[]}});await tick();show('Enabled for this session. Local participating sessions may exchange messages; remote machines remain blocked until allowed.');
   }else if(command==='off'){const config=await call('config');if(config)await call('configure',{settings:{...config,enabled:false}});token='';exposure(false);show('Disabled; messages preserved.');}
   else if(command==='allow'||command==='deny'){
    const c=await call('config');if(!c?.enabled)throw new Error('Enable this session first');const peer=rest[0];
    const peers=command==='allow'?[...new Set([...c.peers,peer])]:c.peers.filter((p:string)=>p!==peer);
    const auto=c.auto.filter((p:string)=>peers.includes(p.split('/')[0]===machine?'local':p.split('/')[0]));
    await call('configure',{settings:{...c,enabled:!!c.enabled,peers,auto}});show('Session permissions updated.');
   }else if(command==='auto'){
    const [address,mode]=rest;if(!['on','off'].includes(mode))throw new Error('Usage: /peer auto MACHINE/SESSION on|off');
    const c=await call('config');if(!c?.enabled)throw new Error('Enable session first');
    if(mode==='on'&&(!fresh.hasUI||!await fresh.ui.confirm('Allow automatic peer turns?',`Messages from ${address} may start model calls and agent work while running. Closed-session backlog requires acceptance.`)))throw new Error('Auto-start requires operator confirmation');
    await call('configure',{settings:{...c,enabled:!!c.enabled,auto:mode==='on'?[...new Set([...c.auto,address])]:c.auto.filter((p:string)=>p!==address)}});show('Auto-start permission updated.');
   }else if(command==='accept')await accept(rest[0],true);
   else if(command==='send')show(await call('send',{to:rest[0],body:rest.slice(1).join(' '),requestId:crypto.randomUUID()}));
   else if(command==='delivery')show(await call('delivery',{id:rest[0]}));
   else if(command==='inbox')show(await call('inbox',{page:Number(rest[0]??0)}));
   else if(command==='outbox')show(await call('queue',{page:Number(rest[0]??0),direction:'out'}));
   else if(command==='status')show({address:`${machine||'service'}/${session}`,attached:!!token,...await call('health')});
   else show(await call('list'));
  }catch(e:any){fresh.ui.notify(e.message,'error');}
 }
 pi.registerCommand('peer',{description:'Peer messaging: enable, disable, pair, status, inbox, outbox; no arguments opens management menu.',handler:async(args,fresh)=>{try{await commandHandler(args,fresh);}catch(e:any){fresh.ui.notify(e.message,'error');}}});
 pi.registerCommand('peers',{description:'Compatibility alias for /peer',handler:async(args,fresh)=>{try{await commandHandler(args,fresh);}catch(e:any){fresh.ui.notify(e.message,'error');}}});
 function result(value:unknown){return {content:[{type:'text' as const,text:JSON.stringify(value,null,2)}],details:undefined};}
 pi.registerTool({name:'peer_list',description:'List permitted independent peer sessions. No spawning or transcript access.',parameters:Type.Object({}),async execute(){return result(await call('list'));}});
 pi.registerTool({name:'peer_inbox',description:'Read stored peer messages in pages of five, including IDs for replies. Does not accept or start work.',parameters:Type.Object({page:Type.Optional(Type.Integer({minimum:0}))}),async execute(_id,args){return result(await call('inbox',args));}});
 pi.registerTool({name:'peer_send',description:'Send text to an allowed MACHINE/SESSION peer. For replies/related work supply the incoming inbox parent ID; never reset conversation budgets by inventing new requests. Recipient controls processing. Request ID allows safe delivery retry.',parameters:Type.Object({to:Type.String(),body:Type.String(),parent:Type.Optional(Type.String()),requestId:Type.Optional(Type.String())}),async execute(_id,args){return result(await call('send',{...args,requestId:args.requestId??crypto.randomUUID()}));}});
}

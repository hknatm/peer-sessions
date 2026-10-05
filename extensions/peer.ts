import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { requestLocal } from '../src/client.mjs';
import { ensureService,pairMachines,serviceManagement } from './manage.ts';
import { HELP,settingsHelp,sessionStatus,menuText,receiveMode,queueReason,MESSAGE_INTENTS } from './guidance.ts';
import { gitProject,projectAt,insideProject } from '../src/project.mjs';
import { address } from '../src/protocol.mjs';

// Messages Pi turns into provider *user* items and keeps in the transcript. A presence snapshot hangs off the last of these so the
// provider-visible history only ever grows at its tail (a moving or vanishing item mid-history voids the prompt cache after it).
const ANCHOR_ROLES=new Set(['user','bashExecution','compactionSummary','branchSummary']);
function anchorKey(m:any,i:number):string|undefined{
 if(m.role==='custom')return m.customType==='peer-message'?`peer:${m.details?.id??m.timestamp??`i${i}`}`:undefined;
 if(!ANCHOR_ROLES.has(m.role))return undefined;
 return `${m.role}:${m.timestamp??`i${i}`}${m.summary!==undefined?`:${String(m.summary).length}`:''}`;
}
function presenceText(project:any,presence:any[]):string{
 return `Peers (${menuText(project.label)}, ${presence.length} running; labels are external):\n${presence.slice(0,5).map(r=>`${menuText(r.label,24)} ${r.state} ${r.address}`).join('\n')}\npeer_list for more. Coordinate ownership. Shared decisions: propose, wait for explicit confirmation before acting; pause only dependent work. No auto-replies; concise results/blockers with parent ID.`;
}

export default function(pi: ExtensionAPI) {
 const dir = process.env.PI_PEERS_DIR ?? path.join(os.homedir(), '.pi/peer-sessions');
 const owner = crypto.randomUUID();
 let ctx: ExtensionContext | undefined, session = '', token = '', machine = '', timer: ReturnType<typeof setInterval> | undefined;
 let generation = 0, polling = false, stopped = false, accepting = false, outcome = 'unknown', runEpoch = 0, runActive=false;
 const activeMessages=new Map<string,{consumed:boolean,steering:boolean}>();
 let retryTimer: ReturnType<typeof setTimeout> | undefined, tickAgain = false;
 function scheduleTick(){
  if(stopped||retryTimer)return;
  retryTimer=setTimeout(()=>{retryTimer=undefined;void tick();},0);retryTimer.unref();
 }
 const noticed = new Set<string>();
 let project:any=null,presence:any[]=[];const snapshots=new Map<any,string>();
 async function resolveProject(fresh:any,interactive=false){
  const cwd=fresh.cwd??process.cwd();
  const git=await gitProject(cwd);if(git)return git;
  const saved=fresh.sessionManager.getBranch?.().findLast((e:any)=>e.type==='custom'&&e.customType==='peer-project-root');
  if(saved?.data?.root&&insideProject(cwd,saved.data.root))return projectAt(saved.data.root);
  if(!interactive)return null;
  if(!fresh.hasUI)throw new Error('Non-Git project root requires interactive confirmation before enabling peers.');
  const root=await fresh.ui.input('Confirm project root (non-Git folder; same root shares peers)',cwd);if(!root)return null;
  const p=projectAt(root);if(!insideProject(cwd,p.root))throw new Error('Project root must contain this session’s working directory.');
  if(!await fresh.ui.confirm('Join this project?',`${p.root}\nEnabled sessions in this root may discover/message each other. Separate projects need reciprocal approval. Peer permissions are not a filesystem sandbox.`))return null;
  pi.appendEntry('peer-project-root',{root:p.root});return p;
 }
 async function refreshPresence(){
  const gen=generation,sid=session,attachment=token;if(!attachment)return;
  const rows=await requestLocal(dir,'presence',{session:sid,token:attachment});
  if(gen!==generation||stopped)return;
  const changed=JSON.stringify(presence.map(r=>r.address).sort())!==JSON.stringify(rows.map((r:any)=>r.address).sort());
  presence=rows;
  if(changed)show(`Same-project peers: ${rows.length} running. Use /peer → Sessions. Presence never starts a model turn.`);
 }
 const tools = ['peer_list', 'peer_send', 'peer_inbox'];
 function exposure(active: boolean) { const all = pi.getActiveTools().filter(n => !tools.includes(n)); pi.setActiveTools(active ? [...all,...tools] : all); }
 function info() { return { busy: !ctx?.isIdle() || !!ctx?.hasPendingMessages(), model: ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : '', thinking: ctx?.thinkingLevel ?? '',steering:true,running:runActive }; }
 async function call(action: string, args: object = {}) { return requestLocal(dir,action,{session,token,...args}); }
 function show(value: unknown) { if(ctx?.hasUI) ctx.ui.notify(typeof value === 'string' ? value : JSON.stringify(value,null,2),'info'); }
 function presentation(row: any,steering=false) {
  pi.sendMessage({customType:'peer-message',content:`Peer ${row.message.kind??'message'}/${row.message.mode??'normal'} (external). From ${row.message.fromMachine}/${row.message.fromSession}; reply parent=${row.id}. depth ${row.message.depth}/${row.message.maxDepth}. Reply only if needed; concise. Proposal ≠ approval; receipt ≠ agreement.\n\n${row.message.body}`,display:true,details:{id:row.id}}, {triggerTurn:true,deliverAs:steering?'steer':'followUp'});
 }
 async function accept(mid: string, manual: boolean,steering=false) {
  if ((!steering&&activeMessages.size) || accepting) throw new Error('A peer turn is already active');
  if (!ctx?.model) throw new Error('No session model selected; message remains pending');
  if (steering&&!runActive&&(!ctx.isIdle()||ctx.hasPendingMessages()))throw new Error('Not an active agent run; urgent message remains queued');
  if (!steering&&(!ctx.isIdle() || ctx.hasPendingMessages())) throw new Error('Session busy; message remains queued');
  const gen=generation, sid=session, attachment=token,epoch=runEpoch;
  accepting=true;
  try{
   const row=await requestLocal(dir,'claim',{session:sid,token:attachment,id:mid,manual,steering});
   if(gen!==generation || stopped) return; // Claimed but not injected: remains uncertain on detach.
   if((steering&&(epoch!==runEpoch||(!runActive&&(!ctx?.isIdle()||ctx.hasPendingMessages()))))||(!steering&&(!ctx?.isIdle()||ctx.hasPendingMessages()))){
    await requestLocal(dir,'release',{session:sid,token:attachment,id:mid});if(manual)throw new Error('Session became busy; message remains queued. Accept when idle.');return;
   }
   activeMessages.set(row.id,{consumed:false,steering});
   if(ctx?.isIdle())outcome='unknown';presentation(row,steering);
   try{await requestLocal(dir,'presented',{session:sid,token:attachment,id:mid});}catch{show('Peer turn started but receipt update failed; recovery may require manual reconciliation.');}
  }finally{if(gen===generation)accepting=false;}
 }
 async function tick() {
  if(stopped || !ctx)return;
  if(polling){tickAgain=true;return;}polling=true;
  const gen=generation, sid=session;
  try {
   if(!token) {
    const health=await requestLocal(dir,'health');
    if(!health.capabilities?.includes('urgent-steer-v1'))throw Object.assign(new Error('Service update required'),{status:409});
    const config=await requestLocal(dir,'config',{session:sid});
    if(gen!==generation || stopped)return;
    if(!config?.enabled) {presence=[];snapshots.clear();exposure(false);ctx.ui.setStatus('peers',undefined);return;}
    if(!project||config.project?.id!==project.id){presence=[];snapshots.clear();exposure(false);ctx.ui.setStatus('peers','peers: project confirmation required; /peer enable');return;}
    const attached=await requestLocal(dir,'attach',{session:sid,owner,info:info()});
    if(gen!==generation || stopped) {await requestLocal(dir,'detach',{session:sid,token:attached.token});return;}
    token=attached.token;machine=attached.machine;exposure(true);
   } else await call('heartbeat',{info:info()});
   if(gen!==generation || stopped)return;
   await refreshPresence();
   const rows=await call('inbox');
   if(gen!==generation || stopped)return;
   const pending=rows.filter((r:any)=>['pending','uncertain'].includes(r.state));
   const usage=await call('usage');
   if(gen!==generation||stopped)return;
   const automatic=pending.filter((r:any)=>r.state==='pending'&&r.autoEligible).length;
   ctx.ui.setStatus('peers',`peers: ${usage.used}/${usage.limit}/h · auto ${automatic} · review ${pending.length-automatic}${pending.length===5?'+':''}`);
   for(const row of pending) {
    if(!noticed.has(row.id)){noticed.add(row.id);show(row.autoEligible&&row.state==='pending'?(row.message.mode==='urgent'?'Urgent peer message queued for a steering boundary.':'Peer message queued for auto-start when idle.'):`Peer message needs review (${row.state}). /peer → Inbox; acceptance starts a turn.`);}
   }
   const urgent=pending.find((r:any)=>r.state==='pending'&&r.autoEligible&&r.message.mode==='urgent'&&r.message.expires>Date.now());
   const candidate=urgent??pending.find((r:any)=>r.state==='pending'&&r.autoEligible===true&&r.message.expires>Date.now());
   if(candidate && !accepting && (candidate.message.mode==='urgent'||(!activeMessages.size&&ctx.isIdle()&&!ctx.hasPendingMessages()))){
    try{await accept(candidate.id,false,candidate.message.mode==='urgent');}catch(e:any){
     // Claim refusals are message-local, not lost leases or incompatible services.
     if(!noticed.has(`blocked:${candidate.id}`)){noticed.add(`blocked:${candidate.id}`);show(`Auto-start waiting: ${e.message}. /peer → Inbox for details.`);}
    }
   }
  } catch(e:any) {
   if(gen!==generation || stopped)return;
   if(e.status===403||e.status===409){token='';presence=[];exposure(false);} // Reattach only if enabled and lease permits it.
   ctx?.ui.setStatus('peers',e.status===409?'peers: service upgrade required; /peer service':token?'peers: disconnected; queued data preserved':undefined);
  } finally {polling=false;if(tickAgain){tickAgain=false;scheduleTick();}}
 }
 async function stop() {
  stopped=true;generation++;if(timer)clearInterval(timer);timer=undefined;
  if(retryTimer)clearTimeout(retryTimer);retryTimer=undefined;tickAgain=false;
  activeMessages.clear();runActive=false;runEpoch++;
  const oldSession=session,oldToken=token;token='';presence=[];snapshots.clear();project=null;exposure(false);
  if(oldToken) await requestLocal(dir,'detach',{session:oldSession,token:oldToken}).catch(()=>{});
  ctx?.ui.setStatus('peers',undefined);ctx=undefined;
 }
 pi.on('session_start',async(event,fresh)=>{
  ctx=fresh;session=fresh.sessionManager.getSessionId();stopped=false;generation++;activeMessages.clear();snapshots.clear();runActive=false;runEpoch++;accepting=false;noticed.clear();exposure(false);
  if(!fresh.sessionManager.getSessionFile())return; // Ephemeral runs cannot claim durable identity.
  // Do not copy participation from a fork/clone. A new ID has no service configuration.
  const gen=generation;const resolved=await resolveProject(fresh);if(gen!==generation||stopped)return;project=resolved;
  await tick();if(gen!==generation||stopped)return;
  let lastPoll=Date.now();timer=setInterval(()=>{const delay=ctx?.isIdle()?15000:2000;if(Date.now()-lastPoll>=delay){lastPoll=Date.now();void tick();}},1000);timer.unref();
 });
 pi.on('session_shutdown',stop);
 pi.on('context',async(event)=>{
  const gen=generation,sid=session,attachment=token;
  for(const m of event.messages as any[]){
   if(m.role!=='custom'||m.customType!=='peer-message')continue;
   const active=activeMessages.get(m.details?.id);if(!active||active.consumed)continue;
   try{await requestLocal(dir,'consumed',{session:sid,token:attachment,id:m.details.id});if(gen===generation)active.consumed=true;}catch{show('Peer consumption receipt failed; recovery remains manual.');}
  }
  const base=event.messages.filter((m:any)=>m.role!=='custom'||m.customType!=='peer-presence');
  const keys=base.map(anchorKey);
  let last=-1;keys.forEach((k,i)=>{if(k)last=i;});
  const live=!!token&&!!project;
  // Each snapshot is decided once, for the last stable user-side message of its turn, then re-inserted unchanged on every later
  // request while that message stays in context: never moved, refreshed or dropped. Later requests in the turn make no socket call.
  // '' means "no snapshot here" and is also a final decision, so a lease gap or failed refresh cannot insert one mid-history later.
  if(last>=0&&!snapshots.has(keys[last]!)){
   let content='';
   if(live){
    try{await refreshPresence();if(gen===generation&&token&&project)content=presenceText(project,presence);}catch{}
    if(gen!==generation)return {messages:base};
    // Identical to the latest snapshot already in context: the model has it, so adding it again would only grow the prompt.
    let before='';for(let i=0;i<last;i++){const k=keys[i];if(k)before=snapshots.get(k)||before;}
    if(content===before)content='';
   }
   snapshots.set(keys[last]!,content);
  }
  let tail='';
  if(live&&last<0){ // Nothing stable to anchor on (an empty request); a real transcript always has an anchor.
   try{await refreshPresence();}catch{return {messages:base};}
   if(gen!==generation||!token||!project)return {messages:base};
   tail=presenceText(project,presence);
  }
  if(snapshots.size>500){const liveKeys=new Set(keys);for(const k of [...snapshots.keys()])if(!liveKeys.has(k))snapshots.delete(k);} // Only snapshots of messages that left the context.
  const out:any[]=[];
  base.forEach((m:any,i:number)=>{out.push(m);const snap=keys[i]?snapshots.get(keys[i]!):undefined;if(snap)out.push({role:'custom',customType:'peer-presence',content:snap,display:false,timestamp:m.timestamp});});
  if(tail)out.push({role:'custom',customType:'peer-presence',content:tail,display:false,timestamp:Date.now()});
  return {messages:out};
 });
 pi.on('agent_start',()=>{runActive=true;outcome='unknown';});
 pi.on('turn_end',async()=>{await tick();}); // Safe tool/response boundary; normal mail still waits for idle.
 pi.on('agent_before_settle',(event)=>{outcome=event.outcome;});
 pi.on('agent_settled',async()=>{
  runActive=false;runEpoch++;
  const sid=session,attachment=token,completed=outcome==='completed',active=[...activeMessages];activeMessages.clear();
  for(const [id,entry]of active)await requestLocal(dir,'settled',{session:sid,token:attachment,id,completed:completed&&(!entry.steering||entry.consumed)}).catch(()=>show('Peer settlement receipt failed; inspect Inbox before retrying.'));
  scheduleTick(); // Leave the notification-only settlement callback before starting work.
 });
 async function commandHandler(args:string,fresh:any){
  if(!args.trim()&&fresh.hasUI){await menu(fresh);return;}
  await legacyHandler(args,fresh);
 }
 async function menu(fresh:any){
  while(await menuPage(fresh)!==false){ /* Return to the parent menu after each completed action. */ }
 }
 async function menuPage(fresh:any):Promise<false|void>{
  ctx=fresh;const menuGeneration=generation,menuSession=session;
  let config:any,available=true;
  try{config=await call('config');}catch(error:any){if(!['ENOENT','ECONNREFUSED'].includes(error.code)&&error.status!==409)throw error;available=false;}
  const options=config?.enabled?['Sessions','Inbox','Outbox','Permissions','Cross-project cooperation','Pair machines','Status','Settings & help','Service','Disable this session']:['Enable this session','Pair machines','Status','Settings & help','Service'];
  const usage=token?await call('usage').catch(()=>null):null;
  const choice=await fresh.ui.select(`Peer sessions — ${available?(config?.enabled?(token?'enabled':'enabled, disconnected'):'disabled'):'service unavailable'}${usage?` · ${usage.used}/${usage.limit}/h`:''} (Escape closes)`,options);if(!choice)return false;
  if(choice==='Settings & help')return settingsHelp(fresh);
  if(choice==='Status')return commandHandler('status',fresh);
  if(choice==='Enable this session')return commandHandler('enable',fresh);
  if(choice==='Disable this session')return commandHandler('disable',fresh);
  if(choice==='Pair machines')return pairMachines(dir,fresh);
  if(choice==='Service')return serviceManagement(dir,fresh);
  if(choice==='Cross-project cooperation')return cooperation(fresh,config);
  if(choice==='Permissions'){
   const scope=await fresh.ui.select('Permissions',['Session machine permissions','Revoke paired machine']);if(!scope)return;
   const health=await call('health');const peers=[{machine:'local',label:'This machine'},...health.paired];
   if(scope==='Revoke paired machine'){
    if(!health.paired.length){show('No paired machines.');return;}
    const labels=health.paired.map((p:any)=>`${menuText(p.label)} (${p.machine})`),selected=await fresh.ui.select('Revoke machine on this host',labels);
    if(selected&&await fresh.ui.confirm('Revoke machine access?', 'Pending mail is retained but cannot trigger work; other sessions on this host also lose this machine connection.'))show(await call('revoke-peer',{machine:health.paired[labels.indexOf(selected)].machine}));return;
   }
   const labels=peers.map((p:any)=>`${config.peers.includes(p.machine)?'Allowed':'Blocked'} · ${menuText(p.label)} (${p.machine.slice(0,8)})`);
   const selected=await fresh.ui.select('Machine permission for this session',labels);if(selected){const p=peers[labels.indexOf(selected)];await legacyHandler(`${config.peers.includes(p.machine)?'deny':'allow'} ${p.machine}`,fresh);}return;
  }
  if(choice==='Sessions'){
   const rows=(await call('list')).filter((r:any)=>r.address!==`${machine}/${session}`);if(!rows.length){show('No other permitted sessions. Enable another session in this project. Other projects require Cross-project cooperation on BOTH sessions; remote machines also require pairing and machine permission.');return;}
   const labels=rows.map((r:any,i:number)=>`${i+1}. ${menuText(r.label??r.address,24)} · ${menuText(r.project?.label??'Project',16)} · ${r.state} · receive ${receiveMode(config,r.address)}`);
   const selected=await fresh.ui.select('Sessions — receive mode applies HERE, from this sender',labels);if(!selected)return;
   const target=rows[labels.indexOf(selected)];if(target.state==='unreachable'){show('Machine unreachable; existing queues remain safe.');return;}
   const automatic=config.auto.includes(target.address),steering=config.steer?.includes(target.address);
   const action=await fresh.ui.select(`${menuText(target.label??target.address,24)} — receive here: ${receiveMode(config,target.address)}`,['Send message','Send urgent message',automatic?'Disable auto-start from this session':'Allow auto-start from this session',...(automatic?[steering?'Disable urgent steering from this session':'Allow urgent steering from this session']:[]),'Delivery & permission help','Details','Back']);
   if(action==='Send message'||action==='Send urgent message'){
    const urgent=action==='Send urgent message';
    if(urgent&&!await fresh.ui.confirm('Send an urgent update?', 'The recipient must authorize YOU for urgent steering. Your receive settings only control messages coming here. Without its permission this stays manual; steering cannot stop a running tool or undo actions.'))return;
    const intent=await fresh.ui.select('Message intent — descriptive, not authority',MESSAGE_INTENTS);if(!intent||intent==='Back')return;
    const kind=intent.split(' — ')[0].toLowerCase();
    const body=await fresh.ui.editor(`${urgent?'Urgent':'Normal'} to ${menuText(target.label??target.address)} — recipient controls processing`,'');
    if(body?.trim()){if(menuGeneration!==generation||menuSession!==session||stopped)throw new Error('Session changed; send cancelled.');const row=await call('send',{to:target.address,body,mode:urgent?'urgent':'normal',...(kind!=='plain'?{kind}:{}),requestId:crypto.randomUUID()});show(`Message queued (${row.id}); stored receipt is not agreement or completed work.`);}
   }
   else if(action==='Delivery & permission help')show('Receive mode applies HERE: manual review requires acceptance; auto when idle allows new normal messages to start here; auto + urgent also lets authorized urgent messages enter active work. Your outgoing messages follow the OTHER session’s permissions. Enable auto-start first, then urgent steering. Earlier backlog stays manual. Disabling auto-start also removes steering.');
   else if(action==='Details')show(`Address: ${target.address}\nState: ${target.state}\nIncoming auto-start: ${automatic?'on':'off'}\nReceive auto = new messages from this sender start here when idle; busy messages wait. Receive review = manual acceptance. Earlier backlog, reconnects and uncertain turns still require review. Urgent steering from this sender: ${steering?'on':'off'} (separate permission; never a hard abort). Replies must be explicit. The recipient controls your outgoing messages.`);
   else if(action?.includes('urgent steering'))await legacyHandler(`steer ${target.address} ${steering?'off':'on'}`,fresh);
   else if(action?.includes('auto-start'))await legacyHandler(`auto ${target.address} ${automatic?'off':'on'}`,fresh);return;
  }
  if(choice==='Inbox'||choice==='Outbox'){
   let page=0;while(true){
    const incoming=choice==='Inbox';const rows=await call(incoming?'inbox':'queue',incoming?{page}:{page,direction:'out'});
    if(!rows.length)show(page===0?(incoming?'Inbox empty. Messages arrive here after another permitted session sends them.':'Outbox empty. Open Sessions → select a session → Send message.'):'No messages on this page. Choose Previous page.');
    const labels=rows.map((r:any,i:number)=>`${i+1}. ${incoming&&r.state==='pending'?(r.autoEligible?(r.message.mode==='urgent'?'urgent steer':'auto when idle'):'review required'):r.state} · ${menuText(r.message.body,40)} · ${r.id.slice(0,8)}`);
    const controls=[...(!incoming?['Pause pending sends','Resume paused sends']:[]),...(page>0?['Previous page']:[]),...(rows.length===5?['Next page']:[]),'Back'];
    const selected=await fresh.ui.select(`${choice} — page ${page+1}`,labels.concat(controls));if(!selected||selected==='Back')return;
    if(selected==='Next page'){page++;continue;}
    if(selected==='Previous page'){page--;continue;}
    if(selected.startsWith('Pause')||selected.startsWith('Resume')){const operation=selected.startsWith('Pause')?'pause':'resume';await call('queue-control',{operation});show(operation==='pause'?'Pending sends paused. Already in-flight sends may still arrive.':'Paused sends resumed; delivery retries subject to permission and expiry.');continue;}
    const row=rows[labels.indexOf(selected)];
    show(`From: ${row.message.fromMachine}/${row.message.fromSession}\nTo: ${row.message.toMachine}/${row.message.toSession}\nIntent: ${row.message.kind??'plain'} · mode: ${row.message.mode??'normal'}\nState: ${row.state} · expires ${new Date(row.message.expires).toISOString()}\n${queueReason(row)}\n${row.error?`Delivery: ${row.error}\n`:''}\n${row.message.body}`);
    const canAccept=!!ctx?.isIdle()&&!ctx?.hasPendingMessages()&&!activeMessages.size&&!accepting;
    const actions=incoming?[...(canAccept&&row.message.version===2&&['pending','uncertain'].includes(row.state)&&row.message.expires>Date.now()?['Accept and start turn']:[]),...(['pending','uncertain','expired'].includes(row.state)?['Dismiss']:[]),'Back']:[...(['queued','paused'].includes(row.state)?['Cancel pending send']:[]),'Back'];
    if(incoming&&!canAccept&&['pending','uncertain'].includes(row.state))show('This session is busy. Manual acceptance is available when idle; eligible automatic messages remain queued.');
    const action=await fresh.ui.select(`Message ${row.id.slice(0,12)} · ${row.state}`,actions);
    if(action==='Accept and start turn'){
     if(!await fresh.ui.confirm('Start a peer turn?',row.state==='uncertain'?'Previous work may already have performed side effects. Inspect this session before retrying. Acceptance starts model calls with your current model and tools.':'Acceptance starts model calls and agent work with this session’s current model and tools.'))continue;
     await accept(row.id,true);return false;
    }
    if(action==='Dismiss'||action==='Cancel pending send'){if(await fresh.ui.confirm(action,'This does not undo work or recall a delivered message. Stored record is retained.')){await call('queue-control',{operation:incoming?'dismiss':'cancel',id:row.id});show(incoming?'Message dismissed; stored record retained.':'Unsent message cancelled; stored record retained.');}}
   }
  }
 }
 async function legacyHandler(args:string,fresh:any){
  ctx=fresh;let [command,...rest]=args.trim().split(/\s+/);command=command==='enable'?'on':command==='disable'?'off':command;
  try{
   if(command==='help'){show(Object.entries(HELP).map(([title,body])=>`${title}\n${body}`).join('\n\n'));return;}
   if(command==='cooperate'){const config=await call('config');if(!config?.enabled)throw new Error('Enable this project session first');await cooperation(fresh,config);return;}
   if(command==='settings'){await settingsHelp(fresh);return;}
   if(command==='pair'){await pairMachines(dir,fresh);return;}
   if(command==='service'){await serviceManagement(dir,fresh);return;}
   if(!fresh.sessionManager.getSessionFile())throw new Error('Peer participation requires a persistent session');
   if(command==='on'){
    const gen=generation,resolved=await resolveProject(fresh,true);if(!resolved)return;
    if(gen!==generation||stopped)throw new Error('Session changed; enable cancelled.');project=resolved;
    await ensureService(dir,fresh);const config=await call('config');
    if(gen!==generation||stopped)throw new Error('Session changed; enable cancelled.');
    await call('configure',{settings:{enabled:true,label:pi.getSessionName()??session,project:{id:project.id,label:project.label},allowedProjects:config?.allowedProjects??[],peers:config?.peers??['local'],auto:config?.auto??[],steer:config?.steer??[]}});await tick();show(`Enabled for project ${menuText(project.label)}. Same-project discovery is automatic; cross-project messaging needs approval on both sessions. Auto-start stays separately authorized.`);
   }else if(command==='off'){const config=await call('config');if(config)await call('configure',{settings:{...config,enabled:false}});token='';presence=[];snapshots.clear();exposure(false);ctx?.ui.setStatus('peers',undefined);show('Disabled; messages preserved.');}
   else if(command==='allow'||command==='deny'){
    const c=await call('config');if(!c?.enabled)throw new Error('Enable this session first');const peer=rest[0];
    const peers=command==='allow'?[...new Set([...c.peers,peer])]:c.peers.filter((p:string)=>p!==peer);
    const auto=c.auto.filter((p:string)=>peers.includes(p.split('/')[0]===machine?'local':p.split('/')[0]));
    await call('configure',{settings:{...c,enabled:!!c.enabled,peers,auto,steer:(c.steer??[]).filter((s:string)=>auto.includes(s))}});show('Session permissions updated.');
   }else if(command==='auto'){
    const [address,mode]=rest;if(!['on','off'].includes(mode))throw new Error('Usage: /peer auto MACHINE/SESSION on|off');
    const gen=generation,sid=session;const c=await call('config');if(!c?.enabled)throw new Error('Enable session first');
    if(mode==='on'&&(!fresh.hasUI||!await fresh.ui.confirm('Allow automatic peer turns?',`New messages from ${address} start model work here when idle; while busy they wait automatically. Existing backlog, reconnects and uncertain turns require manual review. No automatic reply; model calls use your current tools and permissions.`)))throw new Error('Auto-start requires operator confirmation');
    if(gen!==generation||sid!==session||stopped)throw new Error('Session changed; auto-start approval cancelled.');
    const current=await call('config');if(!current?.enabled||gen!==generation||sid!==session||stopped)throw new Error('Session changed or disabled; auto-start approval cancelled.');
    await call('configure',{settings:{...current,enabled:true,auto:mode==='on'?[...new Set([...current.auto,address])]:current.auto.filter((p:string)=>p!==address),steer:(current.steer??[]).filter((s:string)=>mode!=='off'||s!==address)}});show('Auto-start permission updated. New arrivals follow this mode; earlier backlog stays manual.');
   }else if(command==='steer'){
    const [sender,mode]=rest;address(sender);if(!['on','off'].includes(mode))throw new Error('Usage: /peer steer MACHINE/SESSION on|off');
    const gen=generation,sid=session,current=await call('config');if(!current?.enabled)throw new Error('Enable session first');
    if(mode==='on'&&!current.auto.includes(sender))throw new Error('Allow auto-start from this sender before allowing urgent steering.');
    if(mode==='on'&&(!fresh.hasUI||!await fresh.ui.confirm('Allow urgent steering?',`New urgent messages from ${sender} may enter active work at the next steering boundary. They cannot stop a running tool or undo actions. Uses this session’s model/tools; may add cost. Earlier backlog stays manual.`)))return;
    if(gen!==generation||sid!==session||stopped)throw new Error('Session changed; steering approval cancelled.');
    const latest=await call('config');if(!latest?.enabled||gen!==generation||sid!==session||stopped)throw new Error('Session changed or disabled; steering approval cancelled.');
    await call('configure',{settings:{...latest,enabled:true,steer:mode==='on'?[...new Set([...(latest.steer??[]),sender])]:(latest.steer??[]).filter((s:string)=>s!==sender)}});show('Urgent steering permission updated; existing backlog stays manual.');
   }else if(command==='accept')await accept(rest[0],true);
   else if(command==='send')show(await call('send',{to:rest[0],body:rest.slice(1).join(' '),requestId:crypto.randomUUID()}));
   else if(command==='delivery')show(await call('delivery',{id:rest[0]}));
   else if(command==='inbox')show(await call('inbox',{page:Number(rest[0]??0)}));
   else if(command==='outbox')show(await call('queue',{page:Number(rest[0]??0),direction:'out'}));
   else if(command==='status')show(sessionStatus(await call('health'),await call('config'),!!token,session,token?await call('usage'):null));
   else if(command==='list'||!command)show(await call('list'));
   else throw new Error(`Unknown /peer command: ${command}. Use /peer help or open /peer.`);
  }catch(e:any){fresh.ui.notify(['ENOENT','ECONNREFUSED'].includes(e.code)?'Peer service unavailable. Use /peer → Service → Update/reinstall service, or /peer enable for confirmed setup. Queues are preserved.':e.message,'error');}
 }
 const commands:Record<string,string>={enable:'Enable this session; confirmed service setup if needed',disable:'Disable this session; preserve mail',list:'List permitted sessions',inbox:'Stored incoming messages (pages start at 0)',outbox:'Outgoing delivery records (pages start at 0)',status:'Connection, session permission and queue summary',cooperate:'Approve/revoke cross-project cooperation (operator UI only)',settings:'Connection examples, automatic auth and guidance',help:'Setup, permissions, recovery and commands',pair:'Guided secure machine pairing',service:'Status, update/reinstall, restart or uninstall',send:'Send to MACHINE/SESSION',accept:'Start a turn for INBOX_ID',delivery:'Check transport receipt for MESSAGE_ID',allow:'Allow paired MACHINE for this session',deny:'Block MACHINE for this session',steer:'Authorize urgent steering from MACHINE/SESSION on|off',auto:'Allow automatic turns from MACHINE/SESSION on|off'};
 const getArgumentCompletions=(prefix:string)=>Object.entries(commands).filter(([name])=>name.startsWith(prefix)).map(([value,description])=>({value,label:value,description}));
 const handler=async(args:string,fresh:any)=>{try{await commandHandler(args,fresh);}catch(e:any){fresh.ui.notify(e.message,'error');}};
 pi.registerCommand('peer',{description:'Independent peer sessions — menu, settings/help, secure pairing and queues.',getArgumentCompletions,handler});
 pi.registerCommand('peers',{description:'Compatibility alias for /peer',getArgumentCompletions,handler});
 async function cooperation(fresh:any,config:any){
  const gen=generation;
  if(!fresh.hasUI)throw new Error('Cross-project approval requires interactive operator UI');
  const choice=await fresh.ui.select('Cross-project cooperation — approval required on BOTH sessions',['Allow local project','Allow project by address','Revoke project','Back']);if(!choice||choice==='Back')return;
  let ref:string|undefined;
  if(choice==='Revoke project'){
   if(!config.allowedProjects.length){show('No cross-project permissions.');return;}
   ref=await fresh.ui.select('Revoke access for this session',config.allowedProjects);if(!ref)return;
  }else if(choice==='Allow local project'){
   const projects=await call('projects');if(!projects.length){show('No other enabled projects. Enable a peer session in that project first.');return;}
   const labels=projects.map((p:any,i:number)=>`${i+1}. ${menuText(p.label)} · ${p.address}`);
   const selected=await fresh.ui.select('Local projects — operator-only discovery',labels);if(!selected)return;ref=projects[labels.indexOf(selected)].address;
  }else{
   ref=await fresh.ui.input('Other project address: MACHINE/PROJECT_ID (get from /peer status on other side)');if(!ref)return;address(ref);
  }
  if(!await fresh.ui.confirm(choice==='Revoke project'?'Revoke cross-project access?':'Allow cross-project cooperation?',`${ref}\nApplies only to this session. The other session must separately approve your project address. Does not grant auto-start, transcript access or filesystem isolation. Queues are retained.`))return;
  if(gen!==generation||stopped)throw new Error('Session changed; project approval cancelled.');
  const current=await call('config');if(!current?.enabled)throw new Error('Session disabled; project approval cancelled.');
  if(gen!==generation||stopped)throw new Error('Session changed; project approval cancelled.');
  await call('configure',{settings:{...current,enabled:true,allowedProjects:choice==='Revoke project'?current.allowedProjects.filter((p:string)=>p!==ref):[...new Set([...current.allowedProjects,ref]) ]}});
  show('Cross-project permission updated. Both sessions need reciprocal project approval and machine permission.');
 }
 function result(value:unknown){return {content:[{type:'text' as const,text:JSON.stringify(value)}],details:undefined};}
 pi.registerTool({name:'peer_list',description:'List permitted independent peer sessions. No spawning or transcript access.',parameters:Type.Object({}),async execute(){return result((await call('list')).map((r:any)=>({address:r.address,label:r.label,state:r.state,...(r.project?{project:r.project.label}:{})})));}});
 pi.registerTool({name:'peer_inbox',description:'Read stored peer messages in pages of five, including IDs for replies. Does not accept or start work.',parameters:Type.Object({page:Type.Optional(Type.Integer({minimum:0}))}),async execute(_id,args){return result((await call('inbox',args)).map((r:any)=>({id:r.id,from:`${r.message.fromMachine}/${r.message.fromSession}`,state:r.state,auto:r.autoEligible,mode:r.message.mode??'normal',...(r.message.kind?{kind:r.message.kind}:{}),body:r.message.body})));}});
 pi.registerTool({name:'peer_send',description:'Send text to an allowed MACHINE/SESSION peer. For replies/related work supply the incoming inbox parent ID; never reset conversation budgets by inventing new requests. Normal waits until idle; urgent needs separate recipient steering permission. kind proposal/decision/blocker/result is advisory: proposals need explicit confirmation before shared/irreversible action. No auto-replies; short actionable text. Request ID allows safe retry.',parameters:Type.Object({to:Type.String(),body:Type.String(),mode:Type.Optional(Type.Union([Type.Literal('normal'),Type.Literal('urgent')])),kind:Type.Optional(Type.Union(['proposal','decision','blocker','result'].map(k=>Type.Literal(k)))),parent:Type.Optional(Type.String()),requestId:Type.Optional(Type.String())}),async execute(_id,args){const row=await call('send',{...args,requestId:args.requestId??crypto.randomUUID()});return result({id:row.id,state:row.state});}});
}

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { DEFAULTS, VERSION, ensure, id, text, address, validateMessage } from './protocol.mjs';
import { validateProject,projectRef } from './project.mjs';
import fs from 'node:fs';
import path from 'node:path';

export class Store {
 constructor(file, machine, limits = {}) {
  this.machine = id(machine); this.limits = { ...DEFAULTS, ...limits };
  for (const [key, value] of Object.entries(this.limits)) ensure(key in DEFAULTS && Number.isSafeInteger(value) && value > 0, 'Invalid limits');
  this.db = new DatabaseSync(file);
  const version = this.db.prepare('PRAGMA user_version').get().user_version;
  if (![0,1,VERSION].includes(version)) { this.db.close(); throw new Error('Unsupported database version; data untouched'); }
  if(version===1){
   const identity=this.db.prepare("SELECT value FROM metadata WHERE key='machine'").get();
   if(identity&&identity.value!==machine){this.db.close();throw new Error('Database belongs to a different machine identity');}
   const backup=file+'.before-project-v2-'+crypto.randomUUID();
   try{
    this.db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);fs.chmodSync(backup,0o600);
    const fd=fs.openSync(backup,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const directory=fs.openSync(path.dirname(backup),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
    this.db.exec(`BEGIN IMMEDIATE;
     CREATE TABLE project_sessions (session TEXT PRIMARY KEY,project TEXT NOT NULL,label TEXT NOT NULL,allowed TEXT NOT NULL);
     UPDATE sessions SET enabled=0,auto='[]';
     UPDATE messages SET eligible=NULL,state=CASE WHEN state IN ('processing','presented') THEN 'uncertain' ELSE state END WHERE direction='in';
     UPDATE messages SET state='paused',error='Project permissions require re-enabling after upgrade' WHERE direction='out' AND state='queued';
     PRAGMA user_version=2;COMMIT;`);
   }catch(error){try{this.db.exec('ROLLBACK');}catch{}this.db.close();throw error;}
  }
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, label TEXT NOT NULL, peers TEXT NOT NULL, auto TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, direction TEXT NOT NULL, session TEXT NOT NULL, envelope TEXT NOT NULL, state TEXT NOT NULL, received INTEGER NOT NULL, eligible TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, next INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS message_session ON messages(session,direction,state);
   CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, messages INTEGER NOT NULL, wakes INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS project_sessions (session TEXT PRIMARY KEY,project TEXT NOT NULL,label TEXT NOT NULL,allowed TEXT NOT NULL);
   PRAGMA user_version=2;`);
  const identity = this.db.prepare("SELECT value FROM metadata WHERE key='machine'").get();
  if(identity && identity.value !== machine){this.db.close();throw new Error('Database belongs to a different machine identity');}
  this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('machine',?)").run(machine);
  this.attachments = new Map(); this.rates = new Map();this.inFlight=new Set();
  this.db.prepare("UPDATE messages SET eligible=NULL,state=CASE WHEN state IN ('processing','presented') THEN 'uncertain' ELSE state END WHERE direction='in'").run();
 }
 transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
 session(sid) {
  const row=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id(sid));
  const project=this.db.prepare('SELECT * FROM project_sessions WHERE session=?').get(sid);
  return row&&{...row,peers:JSON.parse(row.peers),auto:JSON.parse(row.auto),project:project?{id:project.project,label:project.label}:null,allowedProjects:project?JSON.parse(project.allowed):[]};
 }
 configure(sid, { enabled, label = sid, peers = [], auto = [], project, allowedProjects }) {
  id(sid); text(label, 100); ensure(typeof enabled === 'boolean' && Array.isArray(peers) && peers.length <= 100 && Array.isArray(auto), 'Invalid session permissions');
  peers.forEach(p => { if (p !== 'local') id(p); }); auto.forEach(p => { address(p); ensure(peers.includes(address(p).machine === this.machine ? 'local' : address(p).machine), 'Auto sender must be allowed'); });
  const old=this.session(sid),p=project?validateProject(project):old?.project;
  ensure(!enabled||p,'Enable requires a confirmed project identity');
  ensure(!old?.project||!p||old.project.id===p.id,'Session project changed; disable and use a new session',409);
  const allowed=allowedProjects??old?.allowedProjects??[];
  ensure(Array.isArray(allowed)&&allowed.length<=100,'Invalid cross-project permissions');allowed.forEach(value=>address(value));
  this.transaction(()=>{
   this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,label=excluded.label,peers=excluded.peers,auto=excluded.auto').run(sid, +enabled, label, JSON.stringify(peers), JSON.stringify(auto));
   if(p)this.db.prepare('INSERT INTO project_sessions VALUES (?,?,?,?) ON CONFLICT(session) DO UPDATE SET label=excluded.label,allowed=excluded.allowed').run(sid,p.id,p.label,JSON.stringify(allowed));
  });
  if(JSON.stringify(old?.allowedProjects??[])!==JSON.stringify(allowed)||JSON.stringify(old?.peers??[])!==JSON.stringify(peers)||!enabled){
   this.db.prepare("UPDATE messages SET eligible=NULL WHERE direction='in' AND (session=? OR (json_extract(envelope,'$.fromMachine')=? AND json_extract(envelope,'$.fromSession')=?))").run(sid,this.machine,sid);
  }
  this.db.prepare("UPDATE messages SET eligible=NULL WHERE session=? AND direction='in' AND json_extract(envelope,'$.fromMachine') || '/' || json_extract(envelope,'$.fromSession') NOT IN (SELECT value FROM json_each(?))").run(sid,JSON.stringify(auto));
  if (!enabled) this.detach(sid);
  return this.session(sid);
 }
 live(sid) { const a = this.attachments.get(sid); if (a && a.expires > Date.now()) return a; if (a) this.detach(sid); }
 attach(sid, owner, info = {}) {
  ensure(this.session(sid)?.enabled, 'Session not enabled', 403); id(owner);
  const old = this.live(sid); ensure(!old || old.owner === owner, 'Session already attached', 409);
  const token = old?.token ?? crypto.randomUUID();
  // Every new attachment starts with manual backlog, even if the service restarted.
  if (!old) this.db.prepare("UPDATE messages SET eligible=NULL WHERE session=? AND direction='in'").run(sid);
  this.attachments.set(sid, { owner, token, expires: Date.now() + this.limits.leaseMs, busy: !!info.busy, model: typeof info.model === 'string' ? info.model.slice(0, 128) : '', thinking: typeof info.thinking === 'string' ? info.thinking.slice(0, 32) : '' });
  return { token, machine: this.machine, limits: this.limits };
 }
 authorized(sid, token) { const a = this.live(sid); ensure(a && a.token === token && this.session(sid)?.enabled, 'Attachment expired or disabled', 403); return a; }
 heartbeat(sid, token, info) { const a = this.authorized(sid, token); return this.attach(sid, a.owner, info); }
 detach(sid, token) {
  const a = this.attachments.get(sid); if (token && a?.token !== token) return;
  this.attachments.delete(sid);
  this.db.prepare("UPDATE messages SET eligible=NULL,state=CASE WHEN state IN ('processing','presented') THEN 'uncertain' ELSE state END WHERE session=? AND direction='in'").run(sid);
 }
 permitted(sid, machine) { const s = this.session(sid); return !!(s?.enabled && s.peers.includes(machine === this.machine ? 'local' : machine)); }
 projectAllowed(sid,machine,project){
  const s=this.session(sid);return !!(s?.enabled&&s.project&&this.permitted(sid,machine)&&((machine===this.machine&&s.project.id===project)||s.allowedProjects.includes(projectRef(machine,project))));
 }
 localAllowed(from,to){const a=this.session(from),b=this.session(to);return !!(a?.project&&b?.project&&this.projectAllowed(from,this.machine,b.project.id)&&this.projectAllowed(to,this.machine,a.project.id));}
 listing(machine,requester) {
  ensure(requester?.project&&requester?.session,'Requester project required');validateProject(requester.project);id(requester.session);
  if(machine===this.machine){const s=this.session(requester.session);ensure(s?.enabled&&s.project?.id===requester.project.id,'Requester mismatch',403);}
  return this.db.prepare('SELECT id FROM sessions WHERE enabled=1').all().filter(s=>s.id!==requester.session||machine!==this.machine).filter(s=>this.projectAllowed(s.id,machine,requester.project.id)&&(machine!==this.machine||this.localAllowed(requester.session,s.id))).map(s => {
  const row = this.session(s.id), a = this.live(s.id);
  return { address: `${this.machine}/${s.id}`, label: row.label, state: a ? a.busy ? 'busy' : 'ready' : 'session-closed', project:row.project, receive: 'store; auto-start per sender', ...(machine === this.machine ? { model: a?.model, thinking: a?.thinking } : {}) };
 }); }
 rate(key) { const now = Date.now(); const r = this.rates.get(key); if (!r || now - r.at >= 60000) this.rates.set(key, { at: now, count: 1 }); else ensure(++r.count <= this.limits.ratePerMinute, 'Rate limit', 429); }
 capacity(sid, direction) {
  ensure(this.db.prepare('SELECT count(*) n FROM messages').get().n < this.limits.maxRows, 'Storage row limit; explicit archive required', 507);
  ensure(this.db.prepare("SELECT count(*) n FROM messages WHERE session=? AND direction=? AND state NOT IN ('received','handled','expired','rejected','replied','cancelled')").get(sid, direction).n < this.limits.mailboxRows, 'Mailbox full', 507);
 }
 budget(m) {
  const old = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(m.conversation);
  ensure(!old || old.expires === m.expires, 'Conversation deadline cannot change', 409);
  ensure(!old || old.messages < this.limits.maxMessages, 'Conversation message limit', 429);
  this.db.prepare('INSERT INTO conversations VALUES (?,?,1,0) ON CONFLICT(id) DO UPDATE SET messages=messages+1').run(m.conversation, m.expires);
 }
 get(mid) { const r = this.db.prepare('SELECT * FROM messages WHERE id=?').get(id(mid)); return r && { ...r, message: JSON.parse(r.envelope) }; }
 send(sid, token, { to, body, parent, requestId, toProject }) {
  this.authorized(sid, token); const target = address(to); ensure(this.permitted(sid, target.machine), 'Target machine not permitted', 403);
  const source=this.session(sid);id(toProject);
  ensure(this.projectAllowed(sid,target.machine,toProject),'Target project not permitted',403);
  if(target.machine===this.machine)ensure(this.session(target.session)?.project?.id===toProject&&this.localAllowed(sid,target.session),'Cross-project approval required on both sessions',403);
  const mid = id(requestId); const existing = this.get(mid);
  if (existing) { ensure(existing.direction === 'out' && existing.session === sid && existing.message.body === body && existing.message.toMachine === target.machine && existing.message.toSession === target.session && existing.message.toProject===toProject && existing.message.parent === (parent ? this.get(parent)?.message.id : null), 'Conflicting message ID', 409); return existing; }
  this.rate(`send:${sid}`);
  let p; if (parent) { p = this.get(parent); ensure(p && p.session === sid && p.direction === 'in', 'Unknown incoming parent'); }
  const m = validateMessage({ version: VERSION, id: mid, conversation: p?.message.conversation ?? crypto.randomUUID(), fromMachine: this.machine, fromSession: sid, toMachine: target.machine, toSession: target.session, fromProject:source.project.id,toProject, body, depth: p ? p.message.depth + 1 : 1, maxDepth: p?.message.maxDepth ?? this.limits.maxDepth, parent: p?.message.id ?? null, expires: p?.message.expires ?? Date.now() + this.limits.ttlMs }, this.limits);
  this.transaction(() => { this.capacity(sid, 'out'); this.budget(m); this.db.prepare("INSERT INTO messages(id,direction,session,envelope,state,received) VALUES (?,'out',?,?,'queued',?)").run(mid, sid, JSON.stringify(m), Date.now()); });
  return this.get(mid);
 }
 receive(m, machine) {
  validateMessage(m, this.limits); ensure(m.fromMachine === machine && m.toMachine === this.machine, 'Message identity mismatch', 403);
  ensure(this.session(m.toSession)?.project?.id===m.toProject&&this.projectAllowed(m.toSession,machine,m.fromProject), 'Recipient project not permitted or disabled', 403);
  if(machine===this.machine)ensure(this.session(m.fromSession)?.project?.id===m.fromProject&&this.localAllowed(m.fromSession,m.toSession),'Sender project permission revoked',403);
  const existing = this.get(m.id);
  // Local transport uses an independent inbox ID while preserving the wire ID.
  const inboxId = machine === this.machine ? `local_${m.id}` : m.id;
  const duplicate = this.get(inboxId);
  if (duplicate?.direction === 'in') { ensure(duplicate.envelope === JSON.stringify(m), 'Conflicting duplicate', 409); return { received: true }; }
  ensure(!existing || machine === this.machine, 'Conflicting message ID', 409); this.rate(`receive:${machine}`);
  this.transaction(() => {
   this.capacity(m.toSession, 'in'); if (machine !== this.machine) this.budget(m);
   const a = this.live(m.toSession); const auto = this.session(m.toSession).auto.includes(`${machine}/${m.fromSession}`);
   this.db.prepare("INSERT INTO messages(id,direction,session,envelope,state,received,eligible) VALUES (?,'in',?,?,'pending',?,?)").run(inboxId, m.toSession, JSON.stringify(m), Date.now(), a && auto ? a.token : null);
  }); return { received: true };
 }
 inbox(sid, token, page = 0) {
  this.authorized(sid, token); ensure(Number.isInteger(page) && page >= 0 && page < 2000, 'Invalid inbox page');
  this.db.prepare("UPDATE messages SET state='expired',eligible=NULL WHERE session=? AND direction='in' AND state IN ('pending','uncertain') AND json_extract(envelope,'$.expires')<=?").run(sid,Date.now());
  return this.db.prepare("SELECT id FROM messages WHERE session=? AND direction='in' ORDER BY CASE WHEN state='pending' AND eligible=? THEN 0 WHEN state IN ('pending','uncertain') THEN 1 ELSE 2 END,received ASC LIMIT 5 OFFSET ?").all(sid,token,page*5).map(r => this.get(r.id));
 }
 claim(sid, token, mid, manual = false) {
  const a = this.authorized(sid, token), r = this.get(mid); ensure(r?.session === sid && r.direction === 'in', 'Unknown inbox message', 404);
  ensure(r.message.version===VERSION&&this.session(sid)?.project?.id===r.message.toProject&&this.projectAllowed(sid,r.message.fromMachine,r.message.fromProject), 'Sender project permission revoked or legacy message; retained for inspection only', 403);
  if(r.message.fromMachine===this.machine)ensure(this.localAllowed(r.message.fromSession,sid),'Sender project permission revoked',403);
  ensure(r.message.expires > Date.now(), 'Message expired', 410);
  ensure(['pending', 'uncertain'].includes(r.state), 'Already claimed', 409);
  ensure(manual || (r.eligible === token && !a.busy && this.session(sid).auto.includes(`${r.message.fromMachine}/${r.message.fromSession}`)), 'Manual acceptance required', 403);
  this.transaction(() => {
   const processing = this.db.prepare("SELECT count(*) n FROM messages WHERE session=? AND direction='in' AND state IN ('processing','presented')").get(sid);
   ensure(processing.n === 0, 'A peer turn is already processing', 409);
   const c = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(r.message.conversation);
   ensure(c && c.wakes < this.limits.maxWakes, 'Conversation wake budget exceeded', 429);
   this.db.prepare('UPDATE conversations SET wakes=wakes+1 WHERE id=?').run(c.id);
   this.db.prepare("UPDATE messages SET state='processing',eligible=NULL WHERE id=?").run(mid);
  }); return this.get(mid);
 }
 settled(sid, token, mid, completed = true) { this.authorized(sid, token); const r = this.get(mid); ensure(r?.session === sid && ['processing','presented'].includes(r.state), 'Not an active peer turn', 409); this.db.prepare('UPDATE messages SET state=? WHERE id=?').run(completed ? 'handled' : 'uncertain',mid); }
 presented(sid, token, mid) { this.authorized(sid, token); const r = this.get(mid); ensure(r?.session === sid && r.state === 'processing', 'Message not processing', 409); this.db.prepare("UPDATE messages SET state='presented' WHERE id=?").run(mid); }
 queueSummary(){return this.db.prepare('SELECT direction,state,count(*) count FROM messages GROUP BY direction,state').all();}
 queue(sid,direction,page=0){ensure(['in','out'].includes(direction)&&Number.isInteger(page)&&page>=0,'Invalid queue query');return this.db.prepare('SELECT id FROM messages WHERE session=? AND direction=? ORDER BY received DESC LIMIT 5 OFFSET ?').all(sid,direction,page*5).map(r=>this.get(r.id));}
 queueControl(sid,operation,mid){
  ensure(['pause','resume','cancel','dismiss'].includes(operation),'Invalid queue operation');
  if(operation==='pause'||operation==='resume'){
   this.db.prepare("UPDATE messages SET state=?,next=0 WHERE session=? AND direction='out' AND state=? AND json_extract(envelope,'$.version')=2").run(operation==='pause'?'paused':'queued',sid,operation==='pause'?'queued':'paused');return {operation};
  }
  const row=this.get(mid);ensure(row?.session===sid,'Unknown queue message',404);
  if(operation==='cancel')ensure(!this.inFlight.has(mid)&&row.direction==='out'&&['queued','paused'].includes(row.state),'Cannot cancel received or in-flight message',409);
  else ensure(row.direction==='in'&&['pending','uncertain','expired'].includes(row.state),'Cannot dismiss active message',409);
  this.db.prepare("UPDATE messages SET state='cancelled',eligible=NULL WHERE id=?").run(mid);return {operation,id:mid};
 }
 outbox() { return this.db.prepare("SELECT id FROM messages WHERE direction='out' AND state='queued' AND next<=? ORDER BY received LIMIT 16").all(Date.now()).map(r => this.get(r.id)); }
 delivery(mid, state, error = null) { const r = this.get(mid); if(r.state!=='queued'&&state!=='received')return; this.db.prepare('UPDATE messages SET state=?,error=?,attempts=attempts+1,next=? WHERE id=?').run(state, error, Date.now() + Math.min(60000, 1000 * 2 ** Math.min(r.attempts, 6)) + crypto.randomInt(500), mid); }
 close() { this.db.close(); }
}

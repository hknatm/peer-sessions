import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { VERSION, ensure, equalSecret, fingerprint, id } from './protocol.mjs';
import { requestLocal, socketPath, jsonRequest } from './client.mjs';
import { Pairing } from './pairing.mjs';

export function readConfig(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); }
export { requestLocal, socketPath } from './client.mjs';
function privateFile(file) { const s = fs.statSync(file); ensure((s.mode & 0o077) === 0 && s.isFile(), 'Credential files must be private (chmod 600)', 500); return fs.readFileSync(file); }
function loadPeers(config) {
 return Object.fromEntries(Object.entries(config.peers ?? {}).map(([machine, p]) => {
  id(machine); const url = new URL(p.url); ensure(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Peer requires plain HTTPS origin');
  const cert = fs.readFileSync(p.certificate); const pin = fingerprint(new crypto.X509Certificate(cert).raw);
  const secret = privateFile(p.secretFile).toString().trim(); ensure(/^[a-f0-9]{64}$/.test(secret), 'Pair secret must be 32 random bytes in hex');
  return [machine, { url, cert, pin, secret, label:p.label }];
 }));
}
export async function startService(dir, { config = readConfig(dir), interval = 1000 } = {}) {
 ensure(config.version === VERSION, 'Unsupported config protocol');
 fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); ensure((fs.statSync(dir).mode & 0o077) === 0, 'State directory must be chmod 700');
 const sock = socketPath(dir); ensure(Buffer.byteLength(sock) < 100, 'Unix socket path too long; use a shorter private state path');
 // Exclusive kernel socket ownership; never unlink a potentially live service.
 if (fs.existsSync(sock)) {
  let stale = false;
  try { await requestLocal(dir, 'health'); } catch (e) { stale = ['ECONNREFUSED', 'ENOENT'].includes(e.code); if (!stale) throw new Error('Existing socket cannot be verified'); }
  ensure(stale, 'Service already running', 409); fs.unlinkSync(sock);
 }
 let peers = loadPeers(config);
 const pairing = new Pairing(dir);
 let store, ownsSocket = false;
 let closing = false, timer, flushing = false;
 const peerRequest = async (machine, action, args = {}) => {
  const p = Object.hasOwn(peers,machine) ? peers[machine] : undefined; ensure(p, 'Machine is not paired', 403);
  return jsonRequest(https, { hostname: p.url.hostname, port: p.url.port || 443, path: '/v1', method: 'POST', ca: p.cert, rejectUnauthorized: true,
   cert: fs.readFileSync(path.join(dir, 'identity.crt')), key: privateFile(path.join(dir, 'identity.key')),
   checkServerIdentity: (_host, cert) => fingerprint(cert.raw) === p.pin ? undefined : new Error('Peer certificate mismatch'),
   headers: { 'x-peer-machine': config.machine, authorization: `Bearer ${p.secret}` }, agent: false }, { version: VERSION, action, ...args });
 };
 async function flush() {
  if (flushing || closing) return; flushing = true;
  try {
   for (const r of store.outbox()) {
    const m = r.message;
    if (m.expires <= Date.now()) { store.delivery(r.id, 'expired'); continue; }
    if (!store.permitted(r.session, m.toMachine)) { store.delivery(r.id, 'rejected', 'Sender permission revoked'); continue; }
    try {
     store.inFlight.add(r.id);
     const ack = m.toMachine === config.machine ? store.receive(m, config.machine) : await peerRequest(m.toMachine, 'receive', { message: m });
     ensure(ack.received === true, 'Invalid receipt', 409); store.delivery(r.id, 'received');
    } catch (e) { store.delivery(r.id, [400,403,409,410].includes(e.status) ? 'rejected' : 'queued', e.status ? `Remote rejection ${e.status}` : 'Peer unreachable or TLS/auth failure'); }
    finally {store.inFlight.delete(r.id);}
   }
  } finally { flushing = false; }
 }
 function publicRow(r, token) { return r && { id:r.id,state:r.state,received:r.received,attempts:r.attempts,error:r.error,message:r.message,autoEligible:!!token && r.eligible===token }; }
 async function local(body) {
  const { action, session, token } = body;
  switch (action) {
   case 'reload-trust': {
    const next = readConfig(dir); ensure(next.version === VERSION && next.machine === config.machine, 'Identity/config mismatch');
    const updated=loadPeers(next);
    for(const old of Object.keys(peers).filter(machine=>!Object.hasOwn(updated,machine))) {
     store.db.prepare("UPDATE messages SET eligible=NULL WHERE direction='in' AND json_extract(envelope,'$.fromMachine')=?").run(old);
     store.db.prepare("UPDATE messages SET state='rejected',error='Peer revoked' WHERE direction='out' AND state='queued' AND json_extract(envelope,'$.toMachine')=?").run(old);
    }
    peers=updated;return { reloaded: true };
   }
   case 'pair-invite': ensure(config.listen,'Configure LAN listener first'); return {invitation:pairing.invite(body.url)};
   case 'pair-pending': return pairing.pending();
   case 'pair-approve': pairing.approve(body.request,body.accepted===true);peers=loadPeers(readConfig(dir));return {approved:body.accepted===true};
   case 'pair-cancel': pairing.cancel();return {cancelled:true};
   case 'queue': store.authorized(session,token);return store.queue(session,body.direction??'out',body.page??0).map(r=>publicRow(r));
   case 'queue-control': store.authorized(session,token);return store.queueControl(session,body.operation,body.id);
   case 'revoke-peer': {const next=readConfig(dir);id(body.machine);delete next.peers[body.machine];const {saveConfig}=await import('./config.mjs');saveConfig(dir,next);return local({action:'reload-trust'});}
   case 'health': return {runtime:path.join(path.dirname(fileURLToPath(import.meta.url)),'cli.mjs'), version: VERSION, machine: config.machine, label:config.label??config.machine, paired: Object.entries(peers).map(([machine,p])=>({machine,label:p.label??machine})), lan: !!config.listen, limits: store.limits, queue:store.queueSummary() };
   case 'config': return store.session(session) ?? null;
   case 'configure': ensure(body.settings.peers.every(p => p === 'local' || Object.hasOwn(peers,p)), 'Allow only paired machines'); return store.configure(session, body.settings);
   case 'attach': return store.attach(session, body.owner, body.info);
   case 'heartbeat': return store.heartbeat(session, token, body.info);
   case 'detach': store.detach(session, token); return { detached: true };
   case 'inbox': return store.inbox(session, token, body.page ?? 0).map(r=>publicRow(r,token));
   case 'claim': { const r = store.get(body.id); ensure(r && (r.message.fromMachine === config.machine || Object.hasOwn(peers,r.message.fromMachine)), 'Sender machine revoked', 403); return publicRow(store.claim(session, token, body.id, !!body.manual)); }
   case 'settled': store.settled(session, token, body.id, body.completed === true); return { settled: true };
   case 'presented': store.presented(session, token, body.id); return { presented: true };
   case 'send': { const target = body.to?.split('/')[0]; ensure(target === config.machine || Object.hasOwn(peers,target), 'Machine is not paired'); return publicRow(store.send(session, token, body)); }
   case 'delivery': { store.authorized(session, token); const r = store.get(body.id); ensure(r?.session === session, 'Unknown delivery', 404); return publicRow(r); }
   case 'list': {
    store.authorized(session, token); const allowed = store.session(session).peers;
    const rows = allowed.includes('local') ? store.listing(config.machine) : [];
    await Promise.all(allowed.filter(p => p !== 'local').map(async machine => {
     try { const out = await peerRequest(machine, 'list'); ensure(Array.isArray(out.sessions) && out.sessions.length <= 1000, 'Invalid peer listing'); rows.push(...out.sessions.map(s => ({ machineLabel:peers[machine]?.label??machine, address: `${machine}/${id(s.address?.split('/')[1])}`, label: String(s.label).replace(/[\x00-\x1f\x7f]/g, '').slice(0,100), state: ['ready','busy','session-closed'].includes(s.state) ? s.state : 'unknown', receive: 'per-sender permission' }))); }
     catch { rows.push({ address: machine, state: 'unreachable' }); }
    }));
    return rows.slice(0,1000);
   }
   default: throw Object.assign(new Error('Unknown operation'), { status: 400 });
  }
 }
 async function handler(req, res, remote) {
  try {
   ensure(store, 'Service initializing', 503);
   ensure(req.method === 'POST' && (req.url === '/v1' || (remote && req.url === '/pair')), 'Unknown endpoint', 404);
   if(remote && req.url==='/pair'){
    ensure(pairing.invitation || pairing.requests.size,'Pairing closed',403);
    store.rate('pairing');let content='',size=0;for await(const chunk of req){size+=chunk.length;ensure(size<=16384,'Pair request too large',413);content+=chunk;}
    const reply=pairing.remote(JSON.parse(content));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(reply));return;
   }
   let machine;
   if (remote) {
    machine = req.headers['x-peer-machine']; const p = Object.hasOwn(peers, machine ?? '') ? peers[machine] : undefined; const raw = req.socket.getPeerCertificate()?.raw;
    ensure(p && raw && fingerprint(raw) === p.pin && equalSecret(req.headers.authorization, `Bearer ${p.secret}`), 'Authentication failed', 403);
    store.rate(`http:${machine}`);
   }
   let data = '', bytes = 0;
   for await (const chunk of req) { bytes += chunk.length; ensure(bytes <= store.limits.maxPayload + 4096, 'Request too large', 413); data += chunk; }
   const body = JSON.parse(data); ensure(body.version === VERSION, 'Unsupported protocol version', 409);
   // Trust can be revoked while an authenticated request is still uploading.
   if (remote) { const cert = new crypto.X509Certificate(req.socket.getPeerCertificate().raw); ensure(Date.parse(cert.validTo) > Date.now() && Date.parse(cert.validFrom) <= Date.now(), 'Peer certificate expired or not yet valid', 403); const p = Object.hasOwn(peers, machine) ? peers[machine] : undefined; ensure(p && equalSecret(req.headers.authorization, `Bearer ${p.secret}`) && fingerprint(req.socket.getPeerCertificate().raw) === p.pin, 'Peer revoked', 403); }
   let out;
   if (!remote) out = await local(body);
   else if (body.action === 'list') out = { sessions: store.listing(machine).slice(0,1000) };
   else if (body.action === 'receive') out = store.receive(body.message, machine);
   else throw Object.assign(new Error('Remote operation forbidden'), { status: 403 });
   res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
  } catch (e) {
   if (!res.headersSent) res.writeHead(e.status ?? 400, { 'content-type': 'application/json' });
   res.end(JSON.stringify({ error: e.status ? e.message : 'Request failed' }));
  }
 }
 const server = http.createServer((req,res) => handler(req,res,false)); server.requestTimeout = 10000; server.headersTimeout = 10000;
 let lan;
 try {
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(sock,resolve); }); ownsSocket = true; fs.chmodSync(sock,0o600);
  store = new Store(path.join(dir, 'mailboxes.sqlite'), config.machine, config.limits);
  fs.chmodSync(path.join(dir, 'mailboxes.sqlite'), 0o600);
  if (config.listen) {
   lan = https.createServer({ key: privateFile(path.join(dir,'identity.key')), cert: fs.readFileSync(path.join(dir,'identity.crt')), requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3', maxHeaderSize: 8192 }, (req,res) => handler(req,res,true));
   lan.requestTimeout = 10000; lan.headersTimeout = 10000; lan.maxConnections = 32;
   await new Promise((resolve,reject) => { lan.once('error',reject); lan.listen(config.listen.port,config.listen.host,resolve); });
  }
  timer = setInterval(() => flush().catch(() => { console.error('Peer outbox flush failed; queued data retained. Check database/storage.'); }), interval); timer.unref();
 } catch (e) { server.close(); lan?.close(); if (ownsSocket && fs.existsSync(sock)) fs.unlinkSync(sock); store?.close(); throw e; }
 return { store, flush, address: lan?.address(), async close() {
  closing = true; clearInterval(timer);
  await Promise.all([server,lan].filter(Boolean).map(s => new Promise(resolve => { s.close(resolve); s.closeAllConnections(); })));
  while (flushing) await new Promise(r => setTimeout(r,10));
  if (fs.existsSync(sock)) fs.unlinkSync(sock); store.close();
 } };
}

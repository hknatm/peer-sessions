import path from 'node:path';
import http from 'node:http';
import { VERSION } from './protocol.mjs';

export function socketPath(dir) { return path.join(dir, 'service.sock'); }
export async function requestLocal(dir, action, args = {}) {
 return jsonRequest(http, { socketPath: socketPath(dir), path: '/v1', method: 'POST' }, { version: VERSION, action, ...args });
}
export function jsonRequest(transport, options, body) {
 return new Promise((resolve, reject) => {
  const deadline = setTimeout(() => req.destroy(new Error('Request deadline exceeded')), 6000);
  function finish(error, value) { clearTimeout(deadline); if(error) reject(error); else resolve(value); }
  const data = JSON.stringify(body);
  const req = transport.request({ ...options, headers: { ...options.headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
   let chunks = '', bytes = 0;
   res.on('data', chunk => { bytes += chunk.length; if (bytes > 262144) { res.destroy(); finish(new Error('Response too large')); } else chunks += chunk; });
   res.on('error', error => finish(error));
   res.on('end', () => { try { const out = JSON.parse(chunks); if (res.statusCode >= 400) finish(Object.assign(new Error(out.error ?? 'Peer request failed'), { status: res.statusCode })); else finish(null,out); } catch (e) { finish(e); } });
  });
  req.setTimeout(5000, () => req.destroy(new Error('Connection timeout'))); req.on('error', error => finish(error)); req.end(data);
 });
}

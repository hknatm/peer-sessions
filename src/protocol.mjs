import crypto from 'node:crypto';
export const VERSION = 2;
export const CONFIG_VERSION = 1;
export const DEFAULTS = Object.freeze({ leaseMs: 60000, pollMs: 15000, maxDepth: 4, maxMessages: 16, maxWakes: 4, maxPayload: 32768, maxRows: 10000, mailboxRows: 1000, ttlMs: 86400000, ratePerMinute: 60 });
export function ensure(value, message, status = 400) { if (!value) throw Object.assign(new Error(message), { status }); }
export function text(value, max = 256) { ensure(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value), 'Invalid text field'); return value; }
export function id(value) { ensure(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value), 'Invalid identifier'); return value; }
export function address(value) { ensure(typeof value === 'string', 'Invalid address'); const bits = value.split('/'); ensure(bits.length === 2, 'Use machine/session address'); return { machine: id(bits[0]), session: id(bits[1]) }; }
export function equalSecret(a, b) { const x = Buffer.from(a ?? ''), y = Buffer.from(b ?? ''); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); }
export function fingerprint(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
export function validateMessage(m, limits = DEFAULTS) {
 ensure(m && m.version === VERSION, 'Unsupported protocol version', 409);
 for (const key of ['id', 'conversation', 'fromMachine', 'fromSession', 'toMachine', 'toSession']) id(m[key]);
 id(m.fromProject);id(m.toProject);
 if (m.parent !== undefined && m.parent !== null) id(m.parent);
 ensure(typeof m.body === 'string' && !/[\x00-\x08\x0b-\x1f\x7f]/.test(m.body) && m.body.trim().length > 0 && Buffer.byteLength(m.body) <= limits.maxPayload, 'Invalid or oversized message');
 ensure(Number.isSafeInteger(m.depth) && m.depth >= 1 && m.depth <= limits.maxDepth, 'Chain depth exceeded');
 ensure(Number.isSafeInteger(m.maxDepth) && m.maxDepth >= m.depth && m.maxDepth <= limits.maxDepth, 'Invalid chain limit');
 ensure(Number.isSafeInteger(m.expires) && m.expires > Date.now() && m.expires <= Date.now() + limits.ttlMs + 60000, 'Message expired or invalid deadline', 410);
 return m;
}
export function publicMessage(m) { return { ...m, body: m.body.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '') }; }

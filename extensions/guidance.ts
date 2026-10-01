import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export const HELP: Record<string,string> = {
 'Connection & authentication': [
  'Same computer: enable both Pi sessions with /peer enable. No URL or pairing needed.',
  'Another computer: pair the machines, then allow each machine in the receiving session’s Permissions.',
  'Address example: https://192.168.1.20:7443 — use THIS computer’s actual LAN IP. A bare IP or IP:port also works; default port is 7443.',
  'This is the peer messaging listener, NOT your model/provider API URL. Existing Pi provider settings remain unchanged.',
  'HTTPS is required. Certificates and per-pair auth secrets are generated automatically; there is no token to enter. Plain HTTP, hostnames, reverse-proxy paths, URL credentials and query tokens are unsupported.',
  'Keep invitations private: use the pairing UI, never agent chat. Escape cancels a dialog; it does not revoke an already paired machine.'
 ].join('\n\n'),
 'Pairing steps': [
  '1. Enable a persistent Pi session on both computers.',
  '2. On A: /peer pair → Create invitation. Enter A’s LAN IP, confirm the secure listener, and copy the private invitation.',
  '3. On B: /peer pair → Join with invitation. Enter B’s LAN IP and paste A’s invitation privately. Verify A’s fingerprint through a trusted channel.',
  '4. On A: /peer pair → Approve waiting request. Verify B’s fingerprint, then approve. Invitations expire after five minutes.',
  '5. On BOTH sessions: /peer → Permissions → Session machine permissions → allow the other machine. Pairing alone does not grant session access.',
  'Auto-start remains off. Stored messages require acceptance unless that exact sending session is authorized for automatic turns.'
 ].join('\n\n'),
 'Permissions & auto-start': [
  'Enable/disable affects only this Pi session. Disabling preserves messages.',
  'Machine permission controls which paired machines this session may discover/message and receive from. Both ends must permit each other.',
  'Auto-start permits one exact sending session to start model calls and agent work while this recipient is running and idle, using its own model and tools. It is not a sandbox.',
  'Closed-session backlog and uncertain/interrupted turns require manual acceptance. An uncertain turn may already have performed work; inspect it before retrying.',
  'Revoking a paired machine affects ALL sessions on this host. Stopping the service disconnects all sessions. Neither operation deletes queues.'
 ].join('\n\n'),
 'Recovery & troubleshooting': [
  'Unreachable machine: check both services, actual LAN IPs, port and firewall rules. Use static IPs/DHCP reservations; no hostname discovery, relay or NAT traversal is included.',
  'No sessions: enable a persistent session on the other computer and allow the paired machine in Permissions on both ends.',
  'Service stopped/missing: /peer → Service → Update/reinstall service (requires confirmation). After a package update, restart Pi and activate the service release there.',
  'User services normally start at login, not necessarily before login after reboot. A removed Node runtime can require service reinstall.',
  'Received means durably stored, not processed. Handled means a turn settled, not proof that the task succeeded. Queued sends retry while permission and deadlines permit.',
  'Messages and identity are retained on disable/uninstall. Back up the entire private state with the service stopped; never share credentials or run a cloned identity on LAN.'
 ].join('\n\n'),
 'Command reference': [
  '/peer — management menu; /peer help — this guidance',
  '/peer enable | disable — this session only',
  '/peer status — connection, permissions and machine queue summary',
  '/peer settings — connection and setup guidance',
  '/peer pair | service — guided machine/service management',
  '/peer list — permitted sessions',
  '/peer inbox [PAGE] | outbox [PAGE] — raw message records; command pages start at 0',
  '/peer send MACHINE/SESSION message — send without starting a local turn',
  '/peer accept INBOX_ID — start a turn with this session’s model',
  '/peer delivery MESSAGE_ID — transport receipt, not execution proof',
  '/peer allow MACHINE | deny MACHINE — session machine permission (local for this computer)',
  '/peer auto MACHINE/SESSION on|off — automatic turns; enabling requires confirmation',
  '/peers — compatibility alias. Use the menus for queue pause/resume/cancel/dismiss.'
 ].join('\n')
};

export async function settingsHelp(ctx:ExtensionContext){
 if(!ctx.hasUI)return;
 while(true){
  const topic=await ctx.ui.select('Settings & help — credentials are managed automatically',[...Object.keys(HELP),'Back']);
  if(!topic||topic==='Back')return;
  ctx.ui.notify(HELP[topic],'info');
 }
}
export function serviceStatus(health:any){
 return [
  `Machine: ${health.label??health.machine}`,
  `Service: reachable · protocol ${health.version}`,
  `LAN listener: ${health.lan?'on (HTTPS)':'off — local sessions only'}`,
  `Paired machines: ${health.paired.length}`,
  'Authentication: automatic certificates + per-pair secret; no manual token',
  'Machine-wide queues: '+(health.queue.map((r:any)=>`${r.direction==='in'?'inbox':'outbox'} ${r.state}: ${r.count}`).join(' · ')||'empty'),
  'Received = stored, not processed. Queues are retained on disable/uninstall.'
 ].join('\n');
}
export function sessionStatus(health:any,config:any,attached:boolean,session:string){
 return [
  serviceStatus(health),
  `This session: ${config?.enabled?(attached?'enabled · attached':'enabled · disconnected; run /peer enable to retry'):'disabled — use /peer enable'}`,
  `Address: ${health.machine}/${session}`,
  `Allowed machines: ${config?.peers?.length??0} · auto-start senders: ${config?.auto?.length??0}`,
  'Pairing and session permission are separate. /peer settings explains setup.'
 ].join('\n');
}
export function menuText(value:unknown,max=48){
 return String(value??'').replace(/[\x00-\x1f\x7f-\x9f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export const HELP: Record<string,string> = {
 'Connection & authentication': [
  'Same project on this computer: enable both Pi sessions with /peer enable. No URL or pairing needed. Sessions in the same canonical Git checkout discover/message each other automatically; separate worktrees count as separate projects.',
  'Other projects stay hidden from agents until reciprocal cooperation is approved in /peer → Cross-project cooperation on BOTH sessions. Operator project selection is separate from agent discovery.',
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
  '5. On BOTH sessions: allow the paired machine in Permissions AND allow the other project address in Cross-project cooperation. Read your project address from /peer status. Roots on different machines are never automatically treated as the same project.',
  'Auto-start remains off. Stored messages require acceptance unless that exact sending session is authorized for automatic turns.'
 ].join('\n\n'),
 'Permissions & auto-start': [
  'Enable joins only this session’s confirmed project. Canonical Git root is automatic; non-Git folders require root confirmation. Disabling preserves messages.',
  'Cross-project approval is session-scoped, reciprocal and revocable. It does not automatically enable other sessions in either project. Full project paths remain local and are not advertised over LAN.',
  'Same-project presence is refreshed every 15 seconds and on model context preparation; it never triggers a turn. Coordinate file ownership or separate worktrees—presence does not prevent concurrent edits.',
  'Machine permission controls which paired machines this session may discover/message and receive from. Both ends must permit each other.',
  'Auto-start permits one exact sending session to start model calls and agent work while this recipient is running and idle, using its own model and tools. It is not a sandbox.',
  'New authorized messages wait while busy and start one at a time when idle (poll fallback within 15 seconds). No first-message acceptance is needed. Earlier backlog, service restart/reattachment and uncertain/interrupted turns require manual acceptance. An uncertain turn may already have performed work; inspect it before retrying.',
  'Revoking a paired machine affects ALL sessions on this host. Stopping the service disconnects all sessions. Neither operation deletes queues.'
 ].join('\n\n'),
 'Urgent steering & decisions': [
  'Normal messages wait for idle. Urgent messages may enter active work only after this recipient separately authorizes the exact sender: Sessions → Allow urgent steering. Auto-start must already be enabled.',
  'Urgent detection uses active-turn boundaries plus a 2-second busy polling fallback (15 seconds idle). Steering is not a hard interrupt: it cannot stop a running tool, undo actions or guarantee immediate delivery. No session is reopened.',
  'Without steering permission, an urgent message stays in Inbox for manual review. Granting permission does not promote earlier backlog. Revocation stops future claims, not work already injected.',
  'Kinds: proposal, decision, blocker, result; plain messages remain valid. Kind is advisory, never approval or extra authority. For shared/irreversible decisions send a proposal, link replies by parent ID and wait for explicit confirmation before acting. Pause only dependent work; continue independent work.',
  'A stored receipt is not agreement. Consumed means included in a model context preparation, not proof of understanding. Handled means the containing run settled successfully, not proof of task success or acceptance. Unconsumed/interrupted steering is uncertain and needs review.',
  'Keep urgent corrections short and actionable. No inferred urgency, automatic acknowledgement/reply, abort or negotiation loop. Steering shares the existing message and conversation budgets.'
 ].join('\n\n'),
 'Message allowance & costs': [
  'Each session shares 40 new incoming + outgoing messages per rolling hour across all peers. Retries/duplicates and acceptance do not count again. Counters survive restarts; cancelled records still count until their hour expires.',
  'At the receive limit, the sender keeps the message queued and retries. At the send limit, a new send fails visibly; retry after the time shown in Status. No messages are silently dropped.',
  'Related conversations also have default depth/message/turn ceilings of 40 and a 24-hour deadline. These are separate from the rolling-hour allowance, not lifetime session limits.',
  'One message can cause many model/tool calls: this is a traffic allowance, not a token/cost cap. Auto-start is exact-sender permission, not auto-reply. Send short requests/results/blockers, not transcripts.'
 ].join('\n\n'),
 'Recovery & troubleshooting': [
  'Unreachable machine: check both services, actual LAN IPs, port and firewall rules. Use static IPs/DHCP reservations; no hostname discovery, relay or NAT traversal is included.',
  'No sessions: enable another session in this project. For other projects/machines, approve both machine and project permissions on BOTH sessions.',
  'Upgrading from machine-wide v1 requires Service → Update/reinstall service and /peer enable again. Migration creates a private full database backup, disables old participation/auto-start, and pauses pending outgoing mail. Legacy messages are retained for inspection/dismissal, not automatic execution or replay.',
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
  '/peer cooperate — operator-only reciprocal cross-project approvals',
  '/peer pair | service — guided machine/service management',
  '/peer list — permitted sessions',
  '/peer inbox [PAGE] | outbox [PAGE] — raw message records; command pages start at 0',
  '/peer send MACHINE/SESSION message — send without starting a local turn',
  '/peer accept INBOX_ID — start a turn with this session’s model',
  '/peer delivery MESSAGE_ID — transport receipt, not execution proof',
  '/peer allow MACHINE | deny MACHINE — session machine permission (local for this computer)',
  '/peer auto MACHINE/SESSION on|off — automatic turns; enabling requires confirmation',
  '/peer steer MACHINE/SESSION on|off — separate urgent steering permission; requires auto-start first',
  'Use Sessions → Send urgent message and select an intent; agent peer_send accepts mode/kind and parent.',
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
export function sessionStatus(health:any,config:any,attached:boolean,session:string,usage:any=null){
 return [
  serviceStatus(health),
  `This session: ${config?.enabled?(attached?'enabled · attached':'enabled · disconnected; run /peer enable to retry'):'disabled — use /peer enable'}`,
  `Address: ${health.machine}/${session}`,
  usage?`Message allowance: ${usage.used}/${usage.limit} in rolling hour (incoming + outgoing, all peers); ${usage.remaining} remaining${usage.nextAvailable?`; next slot ${new Date(usage.nextAvailable).toISOString()}`:''}`:'Message allowance: connect session to inspect usage',
  `Project: ${config?.project?.label??'not confirmed'}`,
  `Project address: ${config?.project?`${health.machine}/${config.project.id}`:'enable to confirm project'}`,
  `Cross-project approvals: ${config?.allowedProjects?.length??0}`,
  `Allowed machines: ${config?.peers?.length??0} · auto-start senders: ${config?.auto?.length??0} · urgent steering senders: ${config?.steer?.length??0}`,
  'Machine pairing does not grant project cooperation; both sessions must approve separately.',
  'Pairing and session permission are separate. /peer settings explains setup.'
 ].join('\n');
}
export function receiveMode(config:any,sender:string){
 return config?.steer?.includes(sender)?'auto + urgent':config?.auto?.includes(sender)?'auto when idle':'manual review';
}
export function queueReason(row:any){
 if(row.state==='uncertain')return 'Review required: previous work may have had side effects. Inspect before retrying.';
 if(row.state==='pending')return row.autoEligible?(row.message.mode==='urgent'?'Automatic urgent delivery: waiting for a supported steering boundary; not a hard interrupt.':'Automatic delivery: waits until this session is idle. No manual acceptance needed.'):'Manual review: backlog, missing sender permission or revoked eligibility. Granting permission does not promote this message.';
 if(row.state==='consumed')return 'Included in model context preparation; awaiting run settlement. This is not agreement.';
 if(row.state==='presented'||row.state==='processing')return 'Reserved or queued into Pi; not yet proof of model consumption or completed work.';
 if(row.state==='handled')return 'Containing run settled successfully; not proof of agreement or task success.';
 if(row.state==='received')return 'Stored by recipient; its agent may not have processed it. Cannot be recalled.';
 if(row.state==='queued')return 'Sender retains this message and retries while permissions, limits and deadline allow.';
 if(row.state==='paused')return 'Sending paused; resume from Outbox. Already in-flight sends may still arrive.';
 return 'Stored record retained; delivery and work cannot be inferred from this state.';
}
export const MESSAGE_INTENTS=['Plain — request or update','Proposal — needs confirmation','Decision — report, not approval','Blocker — what must wait','Result — brief outcome','Back'];
export function menuText(value:unknown,max=48){
 return String(value??'').replace(/[\x00-\x1f\x7f-\x9f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}

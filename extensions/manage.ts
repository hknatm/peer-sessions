import { installService,restartService,uninstallService } from '../src/setup.mjs';
import { readConfig,saveConfig } from '../src/config.mjs';
import { join, origin } from '../src/pairing.mjs';
import { HELP,serviceStatus } from './guidance.ts';
import net from 'node:net';
import { requestLocal } from '../src/client.mjs';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export function pairingAddress(value:string){
 const input=value.trim();
 if(!input)throw new Error('Enter this computer’s LAN IP, e.g. 192.168.1.20:7443. Escape cancels.');
 let url=input;
 if(!input.includes('://')){
  if(net.isIP(input))url=`https://${net.isIP(input)===6?`[${input}]`:input}:7443`;
  else url=`https://${input}`;
 }
 let endpoint:URL;
 try{endpoint=new URL(origin(url));}catch(error:any){
  if(error.code==='ERR_INVALID_URL')throw new Error('Invalid address. Use a LAN IP, e.g. 192.168.1.20:7443.');
  throw error;
 }
 if(!endpoint.port&&!input.includes('://')&&!/\]:\d+$|^[^:]+:\d+$/.test(input))endpoint.port='7443';
 if(Number(endpoint.port||443)<1024)throw new Error('Choose an unprivileged port, e.g. https://192.168.1.20:7443.');
 if(['0.0.0.0','[::]'].includes(endpoint.hostname))throw new Error('Use a concrete IP assigned to this computer, not a wildcard listener.');
 return endpoint;
}

export async function changeListener(dir:string,listen:{host:string,port:number},{restart=restartService}={}){
 const previous=readConfig(dir);
 saveConfig(dir,{...previous,listen});
 try{await restart(dir);}catch(error:any){
  try{
   const current=readConfig(dir);
   if(current.machine!==previous.machine)throw new Error('Machine identity changed');
   saveConfig(dir,{...current,listen:previous.listen});
   await restart(dir);
  }catch{
   throw new Error('LAN listener activation and recovery failed. Queues and identity retained; inspect /peer → Service before retrying.');
  }
  throw new Error(`LAN listener activation failed (${error.code??'service error'}); previous listener restored. Check this computer’s assigned IP, port availability and /peer → Service.`);
 }
}

export async function ensureService(dir:string,ctx:ExtensionContext){
 try{return await requestLocal(dir,'health');}catch(error:any){if(!['ENOENT','ECONNREFUSED'].includes(error.code))throw error;}
 if(!ctx.hasUI||!await ctx.ui.confirm('Set up peer messaging?', 'Install/start a private user-level service that restarts after failure and login. LAN is off until pairing. This never launches Pi or calls a model.'))throw new Error('Service setup cancelled');
 await installService(dir);return requestLocal(dir,'health');
}
export async function pairMachines(dir:string,ctx:ExtensionContext){
 if(!ctx.hasUI)throw new Error('Guided pairing requires interactive UI');
 const mode=await ctx.ui.select('Pair machines — HTTPS; auth is automatic',['Create invitation','Join with invitation','Approve waiting request','Cancel invitation','Connection guidance']);if(!mode)return;
 if(mode==='Connection guidance'){ctx.ui.notify(HELP['Connection & authentication']+'\n\n'+HELP['Pairing steps'],'info');return;}
 await ensureService(dir,ctx);
 if(mode==='Cancel invitation'){await requestLocal(dir,'pair-cancel');return;}
 if(mode==='Approve waiting request'){
  const pending=await requestLocal(dir,'pair-pending');if(!pending.length){ctx.ui.notify('No request yet. Ask the other machine to join, then run /peer pair again.','info');return;}
  const request=pending[0];
  const decision=await ctx.ui.select(`Verify ${request.peer.label} · ${request.peer.url}\nSHA256: ${request.peer.fingerprint}\nCompare through a trusted channel. Session permission is separate.`,['Approve verified machine','Reject request','Back']);
  if(!decision||decision==='Back')return;
  const accepted=decision==='Approve verified machine';
  await requestLocal(dir,'pair-approve',{request:request.request,accepted});ctx.ui.notify(accepted?'Machine paired. On BOTH hosts: /peer → Permissions → Session machine permissions → allow the other machine. Auto-start stays off.':'Request rejected.','info');return;
 }
 ctx.ui.notify('Use THIS computer’s LAN IP, not your model API URL. Example: 192.168.1.20:7443 → HTTPS. Certificates/auth are automatic; no token needed. No /path or query parameters.','info');
 let endpoint:URL;
 while(true){
  const url=await ctx.ui.input('This computer’s LAN IP or HTTPS address (Escape cancels)','192.168.1.20:7443');if(url===undefined)return;
  try{endpoint=pairingAddress(url);break;}catch(error:any){ctx.ui.notify(error.message+' Try e.g. 192.168.1.20:7443.','error');}
 }
 const config=readConfig(dir);const port=Number(endpoint.port||443);
 const listen={host:endpoint.hostname.replace(/^\[|\]$/g,''),port};
 if(JSON.stringify(config.listen)!==JSON.stringify(listen)){
  if(!await ctx.ui.confirm('Enable secure LAN listener?',`Listen on ${listen.host}:${listen.port}. Only approved peers can message. Restrict firewall access to your trusted LAN.`))return;
  ctx.ui.notify('Activating HTTPS listener…','info');
  await changeListener(dir,listen);
 }
 if(mode==='Create invitation'){
  const {invitation}=await requestLocal(dir,'pair-invite',{url:endpoint.origin});
  await ctx.ui.editor('Private invitation — expires in 5 minutes. Copy to other machine’s /peer pair UI. Do not paste into chat.',invitation);
  ctx.ui.notify('Waiting for join. Run /peer pair → Approve waiting request after the other machine joins.','info');
 }else{
  const code=await ctx.ui.input('Paste invitation privately (never in chat)');if(!code)return;
  const controller=new AbortController();const cancel=()=>controller.abort();process.once('SIGINT',cancel);
  let paired;
  try{paired=await join(dir,code,endpoint.origin,{signal:controller.signal,confirm:async(peer:any)=>ctx.ui.confirm('Verify inviting machine',`${peer.label}\n${peer.url}\nSHA256: ${peer.fingerprint}\nCompare this fingerprint through a trusted channel.`),onWaiting:()=>ctx.ui.notify('Waiting for approval on the other machine (up to 5 minutes).','info')});}
  finally{process.removeListener('SIGINT',cancel);}
  await requestLocal(dir,'reload-trust');ctx.ui.notify(`Paired with ${paired.label}. On BOTH hosts: /peer → Permissions → Session machine permissions → allow the other machine. Auto-start stays off.`,'info');
 }
}
export async function serviceManagement(dir:string,ctx:ExtensionContext){
 const choice=await ctx.ui.select('Machine service',['Status','Update/reinstall service','Restart service','Stop/uninstall service (keep queues)']);
 if(choice==='Status'){
  try{ctx.ui.notify(serviceStatus(await requestLocal(dir,'health')),'info');}
  catch(error:any){if(!['ENOENT','ECONNREFUSED'].includes(error.code))throw error;ctx.ui.notify('Service unavailable. Choose Update/reinstall service to set up or repair it (confirmation required). Queues and identity are preserved.','warning');}
 }
 else if(choice==='Update/reinstall service'&&await ctx.ui.confirm('Activate installed package service release?','The service restarts. Queues and identity are preserved; failed activation attempts rollback.')){await installService(dir);ctx.ui.notify('Service release activated.','info');}
 else if(choice==='Restart service'){ctx.ui.notify('Restarting machine service…','info');await restartService(dir);ctx.ui.notify('Service restarted. Enabled sessions reconnect on their next poll.','info');}
 else if(choice?.startsWith('Stop/')&&await ctx.ui.confirm('Stop machine service?','All local sessions disconnect. Messages and identity remain stored.')){uninstallService(dir);ctx.ui.notify('Service stopped/uninstalled. Queues and identity retained.','info');}
}

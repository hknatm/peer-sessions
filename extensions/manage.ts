import { installService,restartService,uninstallService } from '../src/setup.mjs';
import { readConfig,saveConfig } from '../src/config.mjs';
import { join } from '../src/pairing.mjs';
import { requestLocal } from '../src/client.mjs';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export async function ensureService(dir:string,ctx:ExtensionContext){
 try{return await requestLocal(dir,'health');}catch(error:any){if(!['ENOENT','ECONNREFUSED'].includes(error.code))throw error;}
 if(!ctx.hasUI||!await ctx.ui.confirm('Set up peer messaging?', 'Install/start a private user-level service that restarts after failure and login. LAN is off until pairing. This never launches Pi or calls a model.'))throw new Error('Service setup cancelled');
 await installService(dir);return requestLocal(dir,'health');
}
export async function pairMachines(dir:string,ctx:ExtensionContext){
 if(!ctx.hasUI)throw new Error('Guided pairing requires interactive UI');
 await ensureService(dir,ctx);
 const mode=await ctx.ui.select('Pair machines',['Create invitation','Join with invitation','Approve waiting request','Cancel invitation']);if(!mode)return;
 if(mode==='Cancel invitation'){await requestLocal(dir,'pair-cancel');return;}
 if(mode==='Approve waiting request'){
  const pending=await requestLocal(dir,'pair-pending');if(!pending.length){ctx.ui.notify('No request yet. Ask the other machine to join, then run /peer pair again.','info');return;}
  const request=pending[0];
  const accepted=await ctx.ui.confirm('Approve this machine?',`${request.peer.label}\n${request.peer.url}\nSHA256: ${request.peer.fingerprint}\nVerify this fingerprint on the other machine before approving. Session permission is still separate.`);
  await requestLocal(dir,'pair-approve',{request:request.request,accepted});ctx.ui.notify(accepted?'Machine paired. Allow it for this session in /peer permissions.':'Request rejected.','info');return;
 }
 const url=await ctx.ui.input('This machine’s LAN address','https://192.168.x.x:7443');if(!url)return;
 const {origin}=await import('../src/pairing.mjs');const endpoint=new URL(origin(url));
 const config=readConfig(dir);const port=Number(endpoint.port||443);if(port<1024)throw new Error('Choose an unprivileged LAN port, e.g. 7443');
 const listen={host:endpoint.hostname.replace(/^\[|\]$/g,''),port};
 if(JSON.stringify(config.listen)!==JSON.stringify(listen)){
  if(!await ctx.ui.confirm('Enable secure LAN listener?',`Listen on ${listen.host}:${listen.port}. Only approved peers can message. Restrict firewall access to your trusted LAN.`))return;
  saveConfig(dir,{...config,listen});await restartService(dir);
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
  await requestLocal(dir,'reload-trust');ctx.ui.notify(`Paired with ${paired.label}. Enable permission for this session in /peer permissions.`,'info');
 }
}
export async function serviceManagement(dir:string,ctx:ExtensionContext){
 const choice=await ctx.ui.select('Machine service',['Status','Update/reinstall service','Restart service','Stop/uninstall service (keep queues)']);
 if(choice==='Status')ctx.ui.notify(JSON.stringify(await requestLocal(dir,'health'),null,2),'info');
 else if(choice==='Update/reinstall service'&&await ctx.ui.confirm('Activate installed package service release?','The service restarts. Queues and identity are preserved; failed activation attempts rollback.')){await installService(dir);ctx.ui.notify('Service release activated.','info');}
 else if(choice==='Restart service')await restartService(dir);
 else if(choice?.startsWith('Stop/')&&await ctx.ui.confirm('Stop machine service?','All local sessions disconnect. Messages and identity remain stored.'))uninstallService(dir);
}

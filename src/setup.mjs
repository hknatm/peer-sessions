import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { initialize, privateDir, readConfig } from './config.mjs';
import { requestLocal } from './client.mjs';
import { ensure } from './protocol.mjs';

const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LABEL='dev.pi.peer-sessions';
const OWNER_MARK='PI_PEER_SESSIONS_MANAGED';
const runtimeFiles=['cli.mjs','client.mjs','config.mjs','protocol.mjs','service.mjs','store.mjs','pairing.mjs','setup.mjs','project.mjs'];
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const unit=s=>'"'+String(s).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';
export function serviceSpec({platform=process.platform,home=os.homedir(),dir,entry,node=process.execPath,uid=process.getuid?.()}) {
 ensure(['darwin','linux'].includes(platform),'Supported platforms: macOS and Linux');
 for(const value of [home,dir,entry,node])ensure(typeof value==='string'&&!/[\x00-\x1f\x7f]/.test(value),'Unsafe service path');
 if(platform==='darwin')return {file:path.join(home,'Library/LaunchAgents',`${LABEL}.plist`),content:`<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${OWNER_MARK} -->\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(entry)}</string><string>serve</string></array><key>EnvironmentVariables</key><dict><key>PI_PEERS_DIR</key><string>${xml(dir)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>Umask</key><integer>63</integer><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>\n`,domain:`gui/${uid}`,target:`gui/${uid}/${LABEL}`};
 return {file:path.join(home,'.config/systemd/user/pi-peer-sessions.service'),content:`# ${OWNER_MARK}\n[Unit]\nDescription=Pi peer session messaging\n[Service]\nExecStart=${unit(node)} ${unit(entry)} serve\nEnvironment=${unit(`PI_PEERS_DIR=${dir}`)}\nRestart=on-failure\nRestartSec=10\nUMask=0077\nStandardOutput=null\nStandardError=journal\n[Install]\nWantedBy=default.target\n`};
}
export function stageRuntime(dir,root=ROOT) {
 privateDir(dir);const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const hash=crypto.createHash('sha256');for(const file of runtimeFiles)hash.update(fs.readFileSync(path.join(root,'src',file)));
 const runtime=path.join(dir,'runtime',`${pkg.version}-${hash.digest('hex').slice(0,16)}`);privateDir(path.dirname(runtime));
 if(!fs.existsSync(runtime)){
  const tmp=runtime+'.tmp-'+crypto.randomUUID();fs.mkdirSync(tmp,{mode:0o700});
  for(const file of runtimeFiles)fs.copyFileSync(path.join(root,'src',file),path.join(tmp,file));
  fs.writeFileSync(path.join(tmp,'package.json'),JSON.stringify({type:'module',version:pkg.version}),{mode:0o600});fs.renameSync(tmp,runtime);
 }
 for(const file of runtimeFiles)ensure(fs.readFileSync(path.join(runtime,file)).equals(fs.readFileSync(path.join(root,'src',file))),'Staged service runtime content mismatch');
 return {entry:path.join(runtime,'cli.mjs'),version:pkg.version};
}
function manager(spec,operation,run) {
 if(process.platform==='darwin'){
  if(operation==='stop'){try{run('launchctl',['bootout',spec.target]);}catch(e){if(!/Could not find service|No such process/i.test(String(e.stderr)))throw e;}}
  else if(operation==='start')run('launchctl',['bootstrap',spec.domain,spec.file]);
 }else{
  if(operation==='stop')run('systemctl',['--user','stop','pi-peer-sessions.service']);
  else{run('systemctl',['--user','daemon-reload']);run('systemctl',['--user','enable','--now','pi-peer-sessions.service']);}
 }
}
export async function waitHealthy(dir){let last;for(let i=0;i<40;i++){try{return await requestLocal(dir,'health');}catch(e){last=e;await new Promise(r=>setTimeout(r,250));}}throw new Error(`Peer service did not become healthy (${last?.code??'protocol error'}). Run /peer status.`);}
export async function installService(dir,{verifyRuntime=true,root=ROOT,run=(cmd,args)=>execFileSync(cmd,args,{stdio:['ignore','pipe','pipe']}),home=os.homedir()}={}) {
 initialize(dir);const staged=stageRuntime(dir,root),spec=serviceSpec({home,dir,entry:staged.entry});
 const previous=fs.existsSync(spec.file)?fs.readFileSync(spec.file,'utf8'):null;
 // Never overwrite a different user's/custom unit with this label.
 if(previous)ensure(previous.includes(OWNER_MARK),'Existing service file not owned by this package');
 fs.mkdirSync(path.dirname(spec.file),{recursive:true});
 try{
  if(previous){manager(spec,'stop',run);}
  fs.writeFileSync(spec.file,spec.content,{mode:0o600});manager(spec,'start',run);
  const health=await waitHealthy(dir);ensure(health.machine===readConfig(dir).machine,'Service identity mismatch');ensure(!verifyRuntime || health.runtime===staged.entry,'Different service answered activation health check');return {version:staged.version,machine:health.machine};
 }catch(error){
  try{manager(spec,'stop',run);}catch{}
  if(previous){fs.writeFileSync(spec.file,previous,{mode:0o600});try{manager(spec,'start',run);}catch{throw new Error('Service activation and rollback failed; queues retained. Inspect user service manager.');}}
  else if(fs.existsSync(spec.file))fs.unlinkSync(spec.file);
  throw new Error(`Service setup failed; ${previous?'previous service restored':'no service installed'}. Queues preserved. ${error.code??''}`);
 }
}
export async function restartService(dir){const spec=serviceSpec({dir,entry:''});ensure(fs.existsSync(spec.file),'User service not installed; use /peer enable');ensure(fs.readFileSync(spec.file,'utf8').includes(OWNER_MARK),'Service file not owned by this package');if(process.platform==='darwin')execFileSync('launchctl',['kickstart','-k',spec.target]);else execFileSync('systemctl',['--user','restart','pi-peer-sessions.service']);return waitHealthy(dir);}
export function uninstallService(dir){const spec=serviceSpec({dir,entry:''});if(!fs.existsSync(spec.file))return;ensure(fs.readFileSync(spec.file,'utf8').includes(OWNER_MARK),'Service file not owned by this package');const run=(cmd,args)=>execFileSync(cmd,args,{stdio:['ignore','pipe','pipe']});manager(spec,'stop',run);if(process.platform==='linux')run('systemctl',['--user','disable','pi-peer-sessions.service']);fs.unlinkSync(spec.file);if(process.platform==='linux')run('systemctl',['--user','daemon-reload']);}

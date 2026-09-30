#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialize,identity,readConfig,saveConfig } from './config.mjs';
import { startService } from './service.mjs';
import { requestLocal } from './client.mjs';
import { installService,restartService,uninstallService } from './setup.mjs';
import { ensure,id } from './protocol.mjs';

const dir=process.env.PI_PEERS_DIR??path.join(os.homedir(),'.pi/peer-sessions');
const [command,...args]=process.argv.slice(2);
try{
 if(command==='init'){const c=initialize(dir);console.log(`Initialized ${c.machine}; LAN disabled unless previously configured.`);}
 else if(command==='identity'){const {certificate,...info}=identity(dir);console.log(JSON.stringify(info,null,2));}
 else if(command==='install-service'){ensure(args.includes('--yes'),'Pass --yes to approve a user background service. Prefer /peer enable in Pi.');console.log(JSON.stringify(await installService(dir)));}
 else if(command==='restart-service')console.log(JSON.stringify(await restartService(dir)));
 else if(command==='uninstall-service'){ensure(args.includes('--yes'),'Pass --yes to stop/remove the user service; queues remain.');uninstallService(dir);console.log('User service removed. State and queues retained.');}
 else if(command==='serve'){
  const service=await startService(dir);console.log('Peer service started; never launches Pi.');let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await service.close();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
 }
 else if(command==='status')console.log(JSON.stringify(await requestLocal(dir,'health'),null,2));
 else if(command==='revoke'){id(args[0]);const c=readConfig(dir);delete c.peers[args[0]];saveConfig(dir,c);try{await requestLocal(dir,'reload-trust');}catch(e){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw new Error('Revocation saved but live reload failed; stop the service.');}console.log('Machine revoked; mail retained.');}
 else console.log('Pi peer sessions: init | identity | install-service --yes | restart-service | uninstall-service --yes | serve | status | revoke MACHINE\nUse /peer enable and /peer pair in Pi for guided setup. PI_PEERS_DIR selects private state.');
}catch(error){console.error(error.message);process.exitCode=1;}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ensure, CONFIG_VERSION, fingerprint } from './protocol.mjs';

export function privateDir(dir) {
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const stat=fs.lstatSync(dir);ensure(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode&0o077)===0,'State directory must be a private real directory (chmod 700)');
}
export function readConfig(dir) { return JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8')); }
export function saveConfig(dir,config) {
 privateDir(dir);const temp=path.join(dir,`.config-${crypto.randomUUID()}.tmp`);const fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(config,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.renameSync(temp,path.join(dir,'config.json'));const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
 finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function initialize(dir) {
 ensure(Number(process.versions.node.split('.')[0])>=24,'Peer service requires Node.js 24+');privateDir(dir);
 if(fs.existsSync(path.join(dir,'config.json'))){const c=readConfig(dir);ensure(c.version===CONFIG_VERSION,'Unsupported state version');return c;}
 ensure(!fs.existsSync(path.join(dir,'identity.key')),'Partial identity found; inspect instead of overwriting');
 const machine=crypto.randomUUID();
 execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-days','3650','-subj',`/CN=${machine}`,'-keyout',path.join(dir,'identity.key'),'-out',path.join(dir,'identity.crt')],{stdio:'ignore'});
 fs.chmodSync(path.join(dir,'identity.key'),0o600);const config={version:CONFIG_VERSION,machine,label:'This machine',peers:{},listen:null};saveConfig(dir,config);return config;
}
export function identity(dir) {const config=readConfig(dir),certificate=fs.readFileSync(path.join(dir,'identity.crt'),'utf8');return {machine:config.machine,label:config.label??config.machine,certificate,fingerprint:fingerprint(new crypto.X509Certificate(certificate).raw)};}
export function addPeer(dir,peer) {
 const c=readConfig(dir);ensure(peer.machine!==c.machine,'Cannot pair this machine with itself');
 const pin=fingerprint(new crypto.X509Certificate(peer.certificate).raw);
 ensure(/^[a-zA-Z0-9_-]{1,128}$/.test(peer.machine),'Invalid machine identity');
 if(c.peers[peer.machine])ensure(c.peers[peer.machine].fingerprint===pin,'Peer identity changed; revoke and verify again');
 const certificate=path.join(dir,`peer-${peer.machine}.crt`),secretFile=path.join(dir,`peer-${peer.machine}.secret`);
 for(const file of [certificate,secretFile])if(fs.existsSync(file))ensure(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink(),'Unsafe peer credential path');
 fs.writeFileSync(certificate,peer.certificate,{mode:0o600});fs.chmodSync(certificate,0o600);fs.writeFileSync(secretFile,peer.secret,{mode:0o600});fs.chmodSync(secretFile,0o600);
 c.peers[peer.machine]={url:peer.url,label:peer.label,certificate,secretFile,fingerprint:pin};saveConfig(dir,c);return c;
}

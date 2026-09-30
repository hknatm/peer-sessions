import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadHostRuntime} from './host-runtime.mjs';

const root=new URL('..',import.meta.url).pathname;
test('packed npm installation: standalone imports, no duplicated Pi peers, extension loads',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-pack-'));
 try{
 const packed=JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts','--pack-destination',dir],{cwd:root,encoding:'utf8'}))[0];
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({private:true}));
 execFileSync('npm',['install','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund',path.join(dir,packed.filename)],{cwd:dir,stdio:'pipe'});
 const installed=path.join(dir,'node_modules/peer-sessions');assert.ok(fs.existsSync(path.join(installed,'src/service.mjs')));
 assert.ok(!fs.existsSync(path.join(dir,'node_modules/@earendil-works/pi-coding-agent')));assert.ok(!fs.existsSync(path.join(dir,'node_modules/typebox')));
 const help=execFileSync(process.execPath,[path.join(installed,'src/cli.mjs')],{encoding:'utf8'});assert.ok(help.includes('/peer enable'));
 const {jiti}=await loadHostRuntime();const extension=(await jiti.import(path.join(installed,'extensions/peer.ts'))).default;
 const commands=[];extension({on(){},registerCommand(name){commands.push(name);},registerTool(){}});assert.deepEqual(commands.sort(),['peer','peers']);
 const actual=execFileSync('tar',['-tzf',path.join(dir,packed.filename)],{encoding:'utf8'});assert.ok(!actual.includes('test/')&&!actual.includes('state/')&&!actual.includes('identity.key'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

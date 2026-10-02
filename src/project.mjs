import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { ensure, id, text } from './protocol.mjs';
const exec=promisify(execFile);

export function projectAt(root){
 const canonical=fs.realpathSync(root);
 ensure(fs.statSync(canonical).isDirectory(),'Project root must be a directory');
 const label=path.basename(canonical).replace(/[\x00-\x1f\x7f-\x9f]/g,' ').slice(0,100)||'Project';
 return {id:'p_'+crypto.createHash('sha256').update(canonical).digest('hex'),label,root:canonical};
}
export function insideProject(cwd,root){
 const relative=path.relative(fs.realpathSync(root),fs.realpathSync(cwd));
 return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
}
export async function gitProject(cwd){
 const canonical=fs.realpathSync(cwd);
 try{
  const {stdout}=await exec('git',['-C',canonical,'rev-parse','--show-toplevel'],{timeout:3000,maxBuffer:16384,env:{...process.env,GIT_DIR:undefined,GIT_WORK_TREE:undefined,GIT_COMMON_DIR:undefined,GIT_CONFIG:undefined,GIT_CONFIG_COUNT:undefined,GIT_CONFIG_PARAMETERS:undefined,GIT_CONFIG_GLOBAL:os.devNull,GIT_CONFIG_NOSYSTEM:'1'}});
  return projectAt(stdout.trim());
 }catch(error){
  if(error.code==='ENOENT'||error.code===128)return null;
  throw new Error('Project detection failed. Check Git availability and repository access before enabling peers.');
 }
}
export function validateProject(value){
 ensure(value&&typeof value==='object','Project identity required');id(value.id);text(value.label,100);
 return {id:value.id,label:value.label};
}
export function projectRef(machine,project){return `${id(machine)}/${id(project)}`;}

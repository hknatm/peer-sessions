import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.mjs';
import {gitProject,projectAt,insideProject} from '../src/project.mjs';
const p={id:'p',label:'Project'},q={id:'q',label:'Other'};
function configure(s,sid,project,allowed=[]){s.configure(sid,{enabled:true,project,allowedProjects:allowed,peers:['local']});return s.attach(sid,sid).token;}

test('project roots: subdirectories/symlinks agree; separate worktrees and non-Git folders do not silently merge',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-root-'));
 try{
  const repo=path.join(dir,'repo'),other=path.join(dir,'other');fs.mkdirSync(repo);fs.mkdirSync(other);execFileSync('git',['init',repo],{stdio:'ignore'});
  fs.mkdirSync(path.join(repo,'sub'));fs.symlinkSync(repo,path.join(dir,'alias'));
  assert.equal((await gitProject(path.join(repo,'sub'))).id,(await gitProject(path.join(dir,'alias'))).id);
  assert.equal(await gitProject(other),null);assert.notEqual(projectAt(other).id,projectAt(repo).id);
  assert.ok(insideProject(path.join(repo,'sub'),repo));assert.equal(insideProject(other,repo),false);
  execFileSync('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','test'],{stdio:'ignore'});
  const worktree=path.join(dir,'worktree');execFileSync('git',['-C',repo,'worktree','add','--detach',worktree],{stdio:'ignore'});
  assert.notEqual((await gitProject(worktree)).id,(await gitProject(repo)).id);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('same project discovery, reciprocal cross-project grants, revoke/claim/send enforcement and no auto inheritance',()=>{
 const s=new Store(':memory:','host');try{
  const a=configure(s,'a',p),b=configure(s,'b',p),c=configure(s,'c',q);
  const list=()=>s.listing('host',{session:'a',project:p});
  assert.deepEqual(list().map(r=>r.address),['host/b']);assert.equal(s.session('a').auto.length,0);
  assert.throws(()=>s.send('a',a,{to:'host/c',toProject:'q',body:'blocked',requestId:'bad'}),/project not permitted/);
  s.configure('a',{...s.session('a'),enabled:true,allowedProjects:['host/q']});assert.deepEqual(list().map(r=>r.address),['host/b']);
  assert.throws(()=>s.send('a',a,{to:'host/c',toProject:'q',body:'blocked',requestId:'bad'}),/both sessions/);
  s.configure('c',{...s.session('c'),enabled:true,allowedProjects:['host/p']});assert.deepEqual(list().map(r=>r.address),['host/b','host/c']);
  const out=s.send('a',a,{to:'host/c',toProject:'q',body:'approved',requestId:'approved'});s.receive(out.message,'host');assert.equal(s.inbox('c',c)[0].eligible,null);
  s.configure('c',{...s.session('c'),enabled:true,auto:['host/a']});
  const automatic=s.send('a',a,{to:'host/c',toProject:'q',body:'auto candidate',requestId:'auto'});s.receive(automatic.message,'host');assert.equal(s.get('local_auto').eligible,c);
  s.configure('a',{...s.session('a'),enabled:true,allowedProjects:[]});assert.equal(s.get('local_auto').eligible,null);
  s.configure('a',{...s.session('a'),enabled:true,allowedProjects:['host/q']});assert.equal(s.get('local_auto').eligible,null);
  s.configure('c',{...s.session('c'),enabled:true,allowedProjects:[]});assert.deepEqual(list().map(r=>r.address),['host/b']);assert.throws(()=>s.claim('c',c,'local_approved',true),/revoked/);
  assert.throws(()=>s.receive({...out.message,id:'new'},'host'),/not permitted/);
  s.detach('b',b);assert.equal(list()[0].state,'session-closed');
  assert.throws(()=>s.configure('a',{...s.session('a'),enabled:true,project:q}),/project changed/);
 }finally{s.close();}
});

test('project envelope spoofing and missing identity fail closed',()=>{
 const s=new Store(':memory:','host');try{
  assert.throws(()=>s.configure('legacy',{enabled:true,peers:['local']}),/project identity/);
  const a=configure(s,'a',p);configure(s,'b',p);const row=s.send('a',a,{to:'host/b',toProject:'p',body:'hello',requestId:'msg'});
  assert.throws(()=>s.receive({...row.message,fromProject:'q'},'host'),/not permitted|revoked/);
  assert.throws(()=>s.receive({...row.message,fromProject:undefined},'host'),/identifier/);
  assert.throws(()=>s.listing('host',{session:'a',project:q}),/mismatch/);
 }finally{s.close();}
});

test('v1 upgrade is backed up, transactional, disables old access and preserves legacy mail without replay',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peer-upgrade-')),file=path.join(dir,'db');let s;
 try{
  let db=new DatabaseSync(file);db.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT INTO metadata VALUES('machine','host');
   CREATE TABLE sessions(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL,label TEXT NOT NULL,peers TEXT NOT NULL,auto TEXT NOT NULL);
   CREATE TABLE messages(id TEXT PRIMARY KEY,direction TEXT NOT NULL,session TEXT NOT NULL,envelope TEXT NOT NULL,state TEXT NOT NULL,received INTEGER NOT NULL,eligible TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,next INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE conversations(id TEXT PRIMARY KEY,expires INTEGER NOT NULL,messages INTEGER NOT NULL,wakes INTEGER NOT NULL);
   INSERT INTO sessions VALUES('a',1,'A','["local"]','["host/b"]');PRAGMA user_version=1;`);
  const envelope=JSON.stringify({version:1,fromMachine:'host',fromSession:'a',toMachine:'host',toSession:'a',expires:Date.now()+60000,body:'legacy'});
  db.prepare("INSERT INTO messages(id,direction,session,envelope,state,received,eligible) VALUES('out','out','a',?,'queued',0,NULL)").run(envelope);
  db.prepare("INSERT INTO messages(id,direction,session,envelope,state,received,eligible) VALUES('in','in','a',?,'presented',0,'old')").run(envelope);db.close();
  s=new Store(file,'host');assert.equal(s.session('a').enabled,0);assert.deepEqual(s.session('a').auto,[]);assert.equal(s.get('out').state,'paused');assert.equal(s.get('in').state,'uncertain');assert.equal(s.get('in').eligible,null);
  const backups=fs.readdirSync(dir).filter(n=>n.includes('before-project-v2'));assert.equal(backups.length,1);assert.equal(fs.statSync(path.join(dir,backups[0])).mode&0o777,0o600);
  db=new DatabaseSync(path.join(dir,backups[0]));assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);assert.equal(db.prepare('SELECT enabled FROM sessions').get().enabled,1);db.close();
  const token=configure(s,'a',p);s.queueControl('a','resume');assert.equal(s.get('out').state,'paused');assert.throws(()=>s.claim('a',token,'in',true),/legacy/);assert.equal(s.get('in').message.body,'legacy');
  s.close();s=null;s=new Store(file,'host');assert.equal(fs.readdirSync(dir).filter(n=>n.includes('before-project-v2')).length,1);
  const failed=path.join(dir,'failed');db=new DatabaseSync(failed);db.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE sessions(id TEXT PRIMARY KEY,enabled INTEGER,auto TEXT);INSERT INTO sessions VALUES('a',1,'[]');PRAGMA user_version=1;`);db.close();
  assert.throws(()=>new Store(failed,'host'));db=new DatabaseSync(failed);assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);assert.equal(db.prepare('SELECT enabled FROM sessions').get().enabled,1);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='project_sessions'").get().n,0);db.close();
 }finally{s?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

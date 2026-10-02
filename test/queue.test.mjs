import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';

test('pause/resume/cancel/dismiss preserve records and refuse in-flight recall',()=>{
 const s=new Store(':memory:','host');try{
 s.configure('a',{enabled:true,project:{id:'p',label:'Project'},peers:['local']});s.configure('b',{enabled:true,project:{id:'p',label:'Project'},peers:['local']});const a=s.attach('a','a').token,b=s.attach('b','b').token;
 const first=s.send('a',a,{to:'host/b',toProject:'p',body:'one',requestId:'one'});s.queueControl('a','pause');assert.equal(s.outbox().length,0);assert.equal(s.get(first.id).state,'paused');s.queueControl('a','resume');assert.equal(s.outbox().length,1);
 s.inFlight.add(first.id);assert.throws(()=>s.queueControl('a','cancel',first.id),/in-flight/);s.inFlight.delete(first.id);s.queueControl('a','cancel',first.id);assert.equal(s.get(first.id).state,'cancelled');assert.equal(s.outbox().length,0);
 const second=s.send('a',a,{to:'host/b',toProject:'p',body:'two',requestId:'two'});s.receive(second.message,'host');s.delivery(second.id,'received');assert.throws(()=>s.queueControl('a','cancel',second.id),/Cannot cancel/);
 const incoming=s.inbox('b',b)[0];s.queueControl('b','dismiss',incoming.id);assert.equal(s.get(incoming.id).state,'cancelled');assert.equal(s.queue('a','out').length,2);assert.ok(s.queueSummary().length);
 }finally{s.close();}
});

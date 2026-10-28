import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPost} from '../src/post.js';
import {beginTask,readTask,saveTask,lockTask,applyResult} from '../src/journal.js';
async function fixture(t:any){const dir=await mkdtemp(join(tmpdir(),'redlet-journal-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,post:await loadPost(fileURLToPath(new URL('../examples/demo/post.json',import.meta.url)))};}
test('exclusive task lock prevents simultaneous publishers and releases cleanly',async t=>{
 const {dir,post}=await fixture(t);const release=await lockTask(dir,post.site,post.contentId);
 await assert.rejects(lockTask(dir,post.site,post.contentId),/locked|running/i);await release();const next=await lockTask(dir,post.site,post.contentId);await next();
});
test('durable attempt blocks another publish even after a new process reads it',async t=>{
 const {dir,post}=await fixture(t);const task=await beginTask(dir,post,'demo');task.status='submitting';task.submitted=null;task.attemptedAt='2026-10-23T18:00:00Z';await saveTask(dir,task);
 assert.equal((await readTask(dir,post.site,post.contentId)).attemptedAt,'2026-10-23T18:00:00Z');
 await assert.rejects(beginTask(dir,post,'demo'),/verify|already|attempt/i);
});
test('a changed bundle or account cannot reuse an existing content id',async t=>{
 const {dir,post}=await fixture(t);await beginTask(dir,post,'demo');
 await assert.rejects(beginTask(dir,{...post,body:'changed'},'demo'),/changed|different/i);
 await assert.rejects(beginTask(dir,post,'other'),/account|different/i);
});

test('changing selected tags cannot reuse a reserved content id',async t=>{
 const {dir,post}=await fixture(t);await beginTask(dir,{...post,tags:['AI']},'demo');
 await assert.rejects(beginTask(dir,{...post,tags:['独立开发']},'demo'),/changed|different/i);
 await assert.rejects(beginTask(dir,{...post,tags:[]},'demo'),/changed|different/i);
});
test('omitted and empty topic lists keep the existing task fingerprint',async t=>{
 const {dir,post}=await fixture(t);const task=await beginTask(dir,post,'demo');
 assert.equal(task.fingerprint,'495b00461ee67b40664b5c9440ad6eb5345f2ca95f7de0309d8a505b108245f6');
 assert.equal((await beginTask(dir,{...post,tags:[]},'demo')).fingerprint,task.fingerprint);
});
test('known preview failure can retry without losing original creation time',async t=>{
 const {dir,post}=await fixture(t);const first=await beginTask(dir,post,'demo');first.status='preview_failed';await saveTask(dir,first);
 const second=await beginTask(dir,post,'demo');assert.equal(second.status,'preparing');assert.equal(second.createdAt,first.createdAt);assert.equal(second.submitted,false);
});
test('later verification keeps the original submission timestamp',async t=>{
 const {dir,post}=await fixture(t);const task=await beginTask(dir,post,'demo');task.status='submitted_for_review';task.submitted=true;task.submittedAt='2026-10-23T18:00:01Z';await saveTask(dir,task);
 const later=await readTask(dir,post.site,post.contentId);later.status='published';later.verifiedAt='2026-10-23T19:00:00Z';await saveTask(dir,later);
 assert.equal((await readTask(dir,post.site,post.contentId)).submittedAt,'2026-10-23T18:00:01Z');await assert.rejects(beginTask(dir,post,'demo'),/verify|already|attempt/i);
});


for(const status of ['submitted_for_review','published','rejected'] as const)test(`a missing later query preserves the last confirmed ${status} across a disk round trip`,async t=>{
 const {dir,post}=await fixture(t);const task=await beginTask(dir,post,'demo');
 task.status=status;task.submitted=true;task.attemptedAt='2026-10-24T17:00:00Z';task.submittedAt='2026-10-24T17:00:01Z';task.verifiedAt='2026-10-24T18:00:00Z';task.noteId='0123456789abcdef01234567';await saveTask(dir,task);
 const before=Date.now();applyResult(task,{status:'verification_pending',submitted:null,reason:'Exact target not found'});const after=Date.now();await saveTask(dir,task);
 const later=await readTask(dir,post.site,post.contentId);
 assert.equal(later.status,'verification_pending');assert.equal(later.submitted,true);
 assert.deepEqual((later as any).lastConfirmed,{status,verifiedAt:'2026-10-24T18:00:00Z'});
 assert.ok(Date.parse((later as any).lastCheckedAt)>=before&&Date.parse((later as any).lastCheckedAt)<=after);
 assert.equal(later.verifiedAt,'2026-10-24T18:00:00Z');assert.equal(later.noteId,'0123456789abcdef01234567');assert.equal(later.attemptedAt,'2026-10-24T17:00:00Z');assert.equal(later.submittedAt,'2026-10-24T17:00:01Z');
 await assert.rejects(beginTask(dir,post,'demo'),/verify|already|attempt/i);
});

test('a fresh confirmed response replaces earlier confirmation while clearing the pending reason',async t=>{
 const {dir,post}=await fixture(t);const task=await beginTask(dir,post,'demo');task.attemptedAt='2026-10-24T17:00:00Z';task.submittedAt='2026-10-24T17:00:01Z';
 applyResult(task,{status:'submitted_for_review',submitted:true,verifiedAt:'2026-10-24T18:00:00Z'});
 applyResult(task,{status:'verification_pending',submitted:null,reason:'Cannot establish fresh results'});
 applyResult(task,{status:'published',submitted:true,noteId:'0123456789abcdef01234567',verifiedAt:'2026-10-24T19:00:00Z'});await saveTask(dir,task);
 const later=await readTask(dir,post.site,post.contentId);assert.equal(later.status,'published');assert.deepEqual((later as any).lastConfirmed,{status:'published',verifiedAt:'2026-10-24T19:00:00Z'});assert.equal(later.reason,undefined);assert.equal(later.submittedAt,'2026-10-24T17:00:01Z');
});

test('an old pending record with a verification timestamp cannot invent its previous status',async t=>{
 const {dir,post}=await fixture(t);const task=await beginTask(dir,post,'demo');task.status='verification_pending';task.submitted=true;task.verifiedAt='2026-10-24T18:00:00Z';
 applyResult(task,{status:'verification_pending',submitted:null,reason:'Still no exact target'});await saveTask(dir,task);
 const later=await readTask(dir,post.site,post.contentId);assert.equal((later as any).lastConfirmed,undefined);assert.ok(Number.isFinite(Date.parse((later as any).lastCheckedAt)));assert.equal(later.status,'verification_pending');
});

test('a submission acknowledgement records receipt time without claiming a confirmed platform status',async t=>{
 const {dir,post}=await fixture(t);const task=await beginTask(dir,post,'demo');task.attemptedAt='2026-10-24T17:00:00Z';
 applyResult(task,{status:'verification_pending',submitted:true,acknowledgedAt:'2026-10-24T17:00:01Z',reason:'Acknowledged'});await saveTask(dir,task);
 const later=await readTask(dir,post.site,post.contentId);assert.equal(later.submitted,true);assert.equal(later.submittedAt,'2026-10-24T17:00:01Z');assert.equal((later as any).lastConfirmed,undefined);assert.equal(later.verifiedAt,undefined);assert.ok(Number.isFinite(Date.parse((later as any).lastCheckedAt)));
});

test('invalid persisted confirmation metadata cannot be displayed as a trusted result',async t=>{
 const {dir,post}=await fixture(t);const task=await beginTask(dir,post,'demo');(task as any).lastConfirmed={status:'published',verifiedAt:'not a date'};await saveTask(dir,task);
 await assert.rejects(readTask(dir,post.site,post.contentId),/invalid|journal/i);
});

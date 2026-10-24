import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPost} from '../src/post.js';
import {beginTask,readTask,saveTask,lockTask} from '../src/journal.js';
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
test('known preview failure can retry without losing original creation time',async t=>{
 const {dir,post}=await fixture(t);const first=await beginTask(dir,post,'demo');first.status='preview_failed';await saveTask(dir,first);
 const second=await beginTask(dir,post,'demo');assert.equal(second.status,'preparing');assert.equal(second.createdAt,first.createdAt);assert.equal(second.submitted,false);
});
test('later verification keeps the original submission timestamp',async t=>{
 const {dir,post}=await fixture(t);const task=await beginTask(dir,post,'demo');task.status='submitted_for_review';task.submitted=true;task.submittedAt='2026-10-23T18:00:01Z';await saveTask(dir,task);
 const later=await readTask(dir,post.site,post.contentId);later.status='published';later.verifiedAt='2026-10-23T19:00:00Z';await saveTask(dir,later);
 assert.equal((await readTask(dir,post.site,post.contentId)).submittedAt,'2026-10-23T18:00:01Z');await assert.rejects(beginTask(dir,post,'demo'),/verify|already|attempt/i);
});

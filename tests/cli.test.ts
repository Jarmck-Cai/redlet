import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {loadPost} from '../src/post.js';
import {beginTask,saveTask,lockTask,applyResult,readTask} from '../src/journal.js';
const root=fileURLToPath(new URL('../',import.meta.url));
function cli(args: string[]) { return spawnSync(process.execPath,['--import','tsx','src/cli.ts',...args],{cwd:root,encoding:'utf-8',timeout:15000}); }
test('check reports actual local bundle without launching a browser',()=>{
 const result=cli(['check','examples/demo/post.json']);assert.equal(result.status,0);
 const value=JSON.parse(result.stdout);assert.equal(value.status,'bundle_valid');assert.equal(value.imageCount,2);assert.equal(value.contentId,'redlet-demo-001');
});
test('unknown command/flag fails instead of silently doing browser work',()=>{
 for(const args of [['unknown','examples/demo/post.json'],['preview','--auto-publish']]) {
  const result=cli(args);assert.equal(result.status,2);assert.match(result.stderr,/unknown|unexpected/i);
 }
});
test('invalid manifest fails before profile or receipt creation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const result=cli(['preview','missing.json','--account','Redlet demo','--state-dir',dir]);
 assert.equal(result.status,2);assert.match(result.stderr,/manifest/);assert.deepEqual(await readdir(dir),[]);
});
test('preview without a bound account gives the login step before opening browser',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const result=cli(['preview','examples/demo/post.json','--state-dir',dir]);
 assert.equal(result.status,2);assert.match(result.stderr,/login/);assert.deepEqual(await readdir(dir),[]);
});

test('publish requires the exact content id confirmation before any browser or journal',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const extra of [[],['--confirm','wrong']]){const result=cli(['publish','examples/demo/post.json','--state-dir',dir,...extra]);assert.equal(result.status,2);assert.match(result.stderr,/confirm|content.id/i);assert.deepEqual(await readdir(dir),[]);}
});
test('verify requires an existing attempted task before opening the browser',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const result=cli(['verify','not-a-task','--site','rednote','--state-dir',dir]);assert.equal(result.status,2);assert.match(result.stderr,/ENOENT|task/i);assert.deepEqual(await readdir(dir),[]);
});

test('verify locks before reading a record that another writer is updating',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));const post=await loadPost(join(root,'examples/demo/post.json'));
 const task=await beginTask(dir,post,'demo');task.attemptedAt='2026-10-23T18:00:00Z';(task as any).schemaVersion=2;await saveTask(dir,task);const release=await lockTask(dir,post.site,post.contentId);
 try{const result=cli(['verify',post.contentId,'--site','rednote','--state-dir',dir]);assert.equal(result.status,2);assert.match(result.stderr,/locked|running/i);}finally{await release();}
});

test('an attempted content id cannot start another browser even with explicit publish confirmation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));const post=await loadPost(join(root,'examples/demo/post.json'));const task=await beginTask(dir,post,'demo');task.status='submitting';task.attemptedAt='2026-10-23T18:00:00Z';task.submitted=null;await saveTask(dir,task);
 const result=cli(['publish','examples/demo/post.json','--confirm',post.contentId,'--account','demo','--state-dir',dir]);assert.equal(result.status,2);assert.match(result.stderr,/verify|already attempted/i);assert.ok(!(await readdir(dir)).includes('profiles'));
});


test('status reads a known local result without a browser, lock, or private account output',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const post=await loadPost(join(root,'examples/demo/post.json'));const task=await beginTask(dir,post,'private account name');
 task.status='published';task.submitted=true;task.attemptedAt='2026-10-24T17:00:00Z';task.submittedAt='2026-10-24T17:00:01Z';task.verifiedAt='2026-10-24T19:00:00Z';task.noteId='0123456789abcdef01234567';await saveTask(dir,task);
 const release=await lockTask(dir,post.site,post.contentId);
 try{
  const record=join(dir,'tasks','rednote',(await readdir(join(dir,'tasks','rednote'))).find(n=>n.endsWith('.json'))!);
  const before=await readFile(record,'utf-8');const result=cli(['status',post.contentId,'--site','rednote','--state-dir',dir]);
  assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);
  assert.equal(value.status,'published');assert.equal(value.contentId,'redlet-demo-001');assert.equal(value.submittedAt,'2026-10-24T17:00:01Z');assert.equal(value.verifiedAt,'2026-10-24T19:00:00Z');
  assert.equal(value.noteId,'0123456789abcdef01234567');assert.equal(value.source,'local');
  assert.equal(value.account,undefined);assert.equal(value.fingerprint,undefined);assert.equal(value.screenshot,undefined);
  assert.equal(await readFile(record,'utf-8'),before);assert.ok(!(await readdir(dir)).includes('profiles'));
 }finally{await release();}
});

test('status also shows a prepared task without implying that it was submitted',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const post=await loadPost(join(root,'examples/demo/post.json'));await beginTask(dir,post,'demo');
 const result=cli(['status',post.contentId,'--state-dir',dir]);assert.equal(result.status,0,result.stderr);
 const value=JSON.parse(result.stdout);assert.equal(value.status,'preparing');assert.equal(value.submitted,false);assert.equal(value.attemptedAt,undefined);
 assert.ok(!(await readdir(dir)).includes('profiles'));
});

test('status of an unknown id fails without creating a new task or browser profile',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const result=cli(['status','unknown','--state-dir',dir]);assert.equal(result.status,2);assert.match(result.stderr,/ENOENT|task/i);assert.deepEqual(await readdir(dir),[]);
});


test('local status distinguishes a failed check from the previous positive confirmation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));const post=await loadPost(join(root,'examples/demo/post.json'));const task=await beginTask(dir,post,'demo');
 task.status='submitted_for_review';task.submitted=true;task.attemptedAt='2026-10-24T17:00:00Z';task.submittedAt='2026-10-24T17:00:01Z';task.verifiedAt='2026-10-24T18:00:00Z';
 applyResult(task,{status:'verification_pending',submitted:null,reason:'Target not found'});await saveTask(dir,task);
 const result=cli(['status',post.contentId,'--state-dir',dir]);assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);
 assert.equal(value.status,'verification_pending');assert.deepEqual(value.lastConfirmed,{status:'submitted_for_review',verifiedAt:'2026-10-24T18:00:00Z'});assert.ok(Number.isFinite(Date.parse(value.lastCheckedAt)));assert.equal(value.reason,'Target not found');assert.equal(value.submitted,true);assert.ok(!(await readdir(dir)).includes('profiles'));
});


test('verify startup failure emits pending evidence, keeps prior confirmation and releases its lock',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'redlet-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));const post=await loadPost(join(root,'examples/demo/post.json'));const task=await beginTask(dir,post,'demo');
 task.status='published';task.submitted=true;task.attemptedAt='2026-10-24T17:00:00Z';task.submittedAt='2026-10-24T17:00:01Z';task.verifiedAt='2026-10-24T18:00:00Z';await saveTask(dir,task);
 // A file at the profile path fails before Chrome can launch; no live platform is contacted.
 await mkdir(join(dir,'profiles'));await writeFile(join(dir,'profiles','rednote'),'profile path deliberately blocked');
 const result=cli(['verify',post.contentId,'--state-dir',dir]);assert.equal(result.status,2);assert.match(result.stderr,/EEXIST|exist/i);
 assert.ok(result.stdout.trim().startsWith('{'),'failed verification must still emit structured task evidence');const value=JSON.parse(result.stdout);
 assert.equal(value.status,'verification_pending');assert.equal(value.submitted,true);assert.deepEqual(value.lastConfirmed,{status:'published',verifiedAt:'2026-10-24T18:00:00Z'});assert.ok(Number.isFinite(Date.parse(value.lastCheckedAt)));assert.equal(value.submittedAt,'2026-10-24T17:00:01Z');
 const saved=await readTask(dir,post.site,post.contentId);assert.equal(saved.status,'verification_pending');assert.deepEqual(saved.lastConfirmed,value.lastConfirmed);assert.equal(saved.lastCheckedAt,value.lastCheckedAt);
 assert.ok((await readdir(join(dir,'tasks','rednote'))).every(n=>!n.endsWith('.lock')));await assert.rejects(beginTask(dir,post,'demo'),/verify|already|attempt/i);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {loadPost} from '../src/post.js';
import {beginTask,saveTask,lockTask} from '../src/journal.js';
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

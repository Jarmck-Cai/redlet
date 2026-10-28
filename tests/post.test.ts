import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPost } from '../src/post.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6foAAAAASUVORK5CYII=','base64');
async function fixture(t: any, patch: Record<string,unknown>={}) {
  const dir=await mkdtemp(join(tmpdir(),'redlet-post-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'images'));
  await writeFile(join(dir,'images','one.png'),png);
  await writeFile(join(dir,'body.txt'),'第一段 <tag> & "文字"\r\n\r\n第二段🙂\r\n');
  const value={schema_version:1,content_id:'demo-001',title:'一次预览',body_file:'body.txt',images:['images/one.png'],site:'rednote',ai_generated:true,visibility:'private',...patch};
  await writeFile(join(dir,'post.json'),JSON.stringify(value));
  return {dir,path:join(dir,'post.json')};
}
test('loads assets relative to bundle and preserves literal multiline Unicode text',async t=>{
  const f=await fixture(t); const post=await loadPost(f.path);
  assert.equal(post.title,'一次预览');
  assert.equal(post.body,'第一段 <tag> & "文字"\n\n第二段🙂\n');
  assert.equal(post.images[0].path,join(f.dir,'images','one.png'));
  assert.match(post.images[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(post.aiGenerated,true); assert.equal(post.visibility,'private');
});
test('accepts inline body and counts emoji as one title character',async t=>{
  const f=await fixture(t,{body_file:undefined,body:'保留\n\n空行',title:'🙂'.repeat(20)});
  const p=await loadPost(f.path);assert.equal(p.title,'🙂'.repeat(20));assert.equal(p.body,'保留\n\n空行');
});
for (const [name,patch,message] of [
  ['missing images',{images:[]},/images/],
  ['duplicate image path',{images:['images/one.png','images/one.png']},/duplicate/],
  ['directory traversal',{images:['../outside.png']},/inside/],
  ['remote image',{images:['https://example.com/a.png']},/local/],
  ['missing file',{images:['missing.png']},/read/],
  ['both body inputs',{body:'should not win'},/exactly one/],
  ['unknown internal notes',{internal_notes:'do not publish'},/unknown/],
  ['unsafe content id',{content_id:'../oops'},/content_id/],
  ['long title',{title:'🙂'.repeat(21)},/title/],
  ['empty body',{body_file:undefined,body:'   '},/body/],
  ['unrecognised visibility',{visibility:'friends'},/visibility/],
  ['nonboolean AI declaration',{ai_generated:'false'},/ai_generated/],
  ['unsupported site',{site:'other'},/site/],
] as const) test(`rejects ${name} before browser work`,async t=>{
  const f=await fixture(t,patch);await assert.rejects(loadPost(f.path),message);
});
test('rejects an image extension whose bytes are not an image',async t=>{
  const f=await fixture(t);await writeFile(join(f.dir,'images','one.png'),'not an image');
  await assert.rejects(loadPost(f.path),/format/);
});

test('normalizes explicit tags, removes duplicates and preserves user order',async t=>{
 const f=await fixture(t,{tags:[' #AI ','独立开发','AI',' #效率工具']});
 assert.deepEqual((await loadPost(f.path)).tags,['AI','独立开发','效率工具']);
});
test('omitted or empty tags preserve the original body',async t=>{
 const f=await fixture(t);const old=await loadPost(f.path);assert.deepEqual(old.tags,[]);
 const g=await fixture(t,{tags:[]});const empty=await loadPost(g.path);assert.deepEqual(empty.tags,[]);assert.equal(empty.body,old.body);
});
for(const tags of [null,'AI',[1],[' '],['##AI'],['AI#开发'],['AI\n开发'],['AI\t开发'],Array.from({length:11},(_,i)=>'话题'+i)])test(`rejects invalid tags ${JSON.stringify(tags)}`,async t=>{
 const f=await fixture(t,{tags});await assert.rejects(loadPost(f.path),/tags|tag/i);
});
test('counts the generated topic suffix inside the existing body limit',async t=>{
 const f=await fixture(t,{body_file:undefined,body:'字'.repeat(995),tags:['AI']});
 const p=await loadPost(f.path);assert.deepEqual(p.tags,['AI']);
 const g=await fixture(t,{body_file:undefined,body:'字'.repeat(996),tags:['AI']});await assert.rejects(loadPost(g.path),/1000|length|characters/i);
});

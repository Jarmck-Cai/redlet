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

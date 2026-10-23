import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';
import { fileURLToPath } from 'node:url';
import { loadPost } from '../src/post.js';
import { preparePreview } from '../src/creator.js';
let browser: Browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
after(async()=>{await browser?.close();});
async function fixture(t: any, uploadStatus=200) {
 const page=await browser.newPage();t.after(()=>page.close());
 const html=await readFile(new URL('./fixtures/creator.html',import.meta.url),'utf-8');
 await page.route('https://creator.rednote.com/**',route=>route.request().url().endsWith('/upload-image')?route.fulfill({status:uploadStatus,body:'upload result'}):route.fulfill({body:html,contentType:'text/html'}));
 await page.route('https://upload-ae-ali.rnote.com/**',route=>route.fulfill({status:uploadStatus,body:'upload result',headers:{'access-control-allow-origin':'*','access-control-allow-methods':'PUT,OPTIONS'}}));
 await page.goto('https://creator.rednote.com/publish/publish');
 const post=await loadPost(fileURLToPath(new URL('../examples/demo/post.json',import.meta.url)));
 return {page,post};
}
async function state(page: Page) {return page.evaluate(()=>({
 title:(document.querySelector('input.d-text') as HTMLInputElement).value,
 lines:Array.from(document.querySelector('.ProseMirror')!.childNodes).map(n=>n.textContent),
 uploads:(window as any).uploadNames,submitted:(window as any).submitted,
 ai:document.querySelector('#declaration .d-select-content')!.textContent,
 visibility:document.querySelector('.permission-card-wrapper .d-select-content')!.textContent
}));}
test('prepares literal multiline text, ordered images and settings without submitting',async t=>{
 const {page,post}=await fixture(t);
 post.body='第一行 <tag> & "文字"\n\n第二段🙂';
 const result=await preparePreview(page,post,'Redlet demo',1500);
 const actual=await state(page);
 assert.equal(actual.title,'Redlet 的第一份预览');
 assert.deepEqual(actual.lines,['第一行 <tag> & "文字"','','第二段🙂']);
 assert.deepEqual(actual.uploads,['01.png','02.png']);
 assert.equal(actual.submitted,0);assert.equal(actual.ai,'笔记含AI合成内容');assert.equal(actual.visibility,'仅自己可见');
 assert.equal(result.status,'preview_ready');assert.equal(result.submitted,false);assert.equal(result.imageCount,2);
});
test('account mismatch stops before uploading or changing text',async t=>{
 const {page,post}=await fixture(t);
 await assert.rejects(preparePreview(page,post,'Another account',1000),/account/i);
 assert.deepEqual((await state(page)).uploads,[]);assert.equal((await state(page)).title,'');
});
test('refuses to overwrite a nonempty editor',async t=>{
 const {page,post}=await fixture(t);await page.locator('input.d-text').fill('已有草稿');
 await assert.rejects(preparePreview(page,post,'Redlet demo',1000),/nonempty|draft/i);
 assert.equal((await state(page)).title,'已有草稿');assert.deepEqual((await state(page)).uploads,[]);
});
test('checks public visibility and no AI declaration when requested',async t=>{
 const {page,post}=await fixture(t);post.aiGenerated=false;post.visibility='public';
 const result=await preparePreview(page,post,'Redlet demo',1500);
 const actual=await state(page);assert.equal(actual.ai,'添加内容类型声明');assert.equal(actual.visibility,'公开可见');
 assert.equal(actual.submitted,0);assert.equal(result.aiGenerated,false);
});
test('detects platform image reordering instead of claiming success',async t=>{
 const {page,post}=await fixture(t);await page.evaluate(()=>{(window as any).reverseNext=true;});
 await assert.rejects(preparePreview(page,post,'Redlet demo',1000),/image order/i);
 assert.equal((await state(page)).submitted,0);
});
test('detects stalled upload instead of filling a false preview',async t=>{
 const {page,post}=await fixture(t);await page.evaluate(()=>{(window as any).skipNextUpload=true;});
 await assert.rejects(preparePreview(page,post,'Redlet demo',500),/upload/i);
 assert.equal((await state(page)).submitted,0);
});
test('detects an AI declaration that did not stick',async t=>{
 const {page,post}=await fixture(t);await page.evaluate(()=>{(window as any).ignoreAI=true;});
 await assert.rejects(preparePreview(page,post,'Redlet demo',1000),/AI/);
 assert.equal((await state(page)).submitted,0);
});

test('opens the visible image tab even when a hidden duplicate exists',async t=>{
 const {page,post}=await fixture(t);await page.locator('#fields').evaluate(el=>{el.hidden=true;});
 const result=await preparePreview(page,post,'Redlet demo',1500);assert.equal(result.status,'preview_ready');
});
test('protects an existing draft hidden until the image tab opens',async t=>{
 const {page,post}=await fixture(t);
 await page.locator('button[hidden]').evaluate(el=>el.remove());await page.locator('input.d-text').fill('已有草稿');await page.locator('#fields').evaluate(el=>{el.hidden=true;});
 await assert.rejects(preparePreview(page,post,'Redlet demo',1000),/nonempty|draft/i);
 assert.equal((await state(page)).title,'已有草稿');assert.deepEqual((await state(page)).uploads,[]);
});
test('preserves intentional trailing empty paragraphs',async t=>{
 const {page,post}=await fixture(t);post.body='Last paragraph\n\n\n';
 const result=await preparePreview(page,post,'Redlet demo',1500);
 assert.deepEqual((await state(page)).lines,['Last paragraph','','','']);assert.equal(result.bodyVerified,true);
});

test('detects a duplicated thumbnail whose bytes do not match the second image',async t=>{
 const {page,post}=await fixture(t);await page.evaluate(()=>{(window as any).repeatFirst=true;});
 await assert.rejects(preparePreview(page,post,'Redlet demo',1500),/image.*(identity|bytes)/i);
 assert.equal((await state(page)).submitted,0);
});
test('detects a failed upload response even when a valid thumbnail is shown',async t=>{
 const {page,post}=await fixture(t,500);
 await assert.rejects(preparePreview(page,post,'Redlet demo',1500),/upload.*500/i);
 assert.equal((await state(page)).submitted,0);
});

test('ignores a near-transparent duplicate tab used during hydration',async t=>{
 const {page,post}=await fixture(t);await page.locator('#fields').evaluate(el=>{el.hidden=true;});
 await page.locator('button[hidden]').evaluate(el=>{el.hidden=false;el.style.opacity='0.00001';});
 const result=await preparePreview(page,post,'Redlet demo',1500);assert.equal(result.status,'preview_ready');
});
test('waits for upload tabs rendered after the account header',async t=>{
 const {page,post}=await fixture(t);await page.locator('#fields').evaluate(el=>{el.hidden=true;});
 await page.locator('#image-tab').evaluate(el=>{el.hidden=true;setTimeout(()=>{el.hidden=false;},120);});
 const result=await preparePreview(page,post,'Redlet demo',1500);assert.equal(result.status,'preview_ready');
});

test('recognises the platform upload host PUT without a content-type header',async t=>{
 const {page,post}=await fixture(t);await page.evaluate(()=>{(window as any).untypedPut=true;});
 const result=await preparePreview(page,post,'Redlet demo',1800);
 assert.equal(result.status,'preview_ready');assert.equal(result.uploadTransportVerified,true);assert.equal(result.imageBytesVerified,true);
});

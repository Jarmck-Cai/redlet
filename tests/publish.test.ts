import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,type Browser} from 'playwright';
import {loadPost} from '../src/post.js';
import {preparePreview} from '../src/creator.js';
import {submitPreview,verifyTarget} from '../src/publish.js';
let browser:Browser;before(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});after(async()=>browser?.close());
async function editor(t:any){const page=await browser.newPage();t.after(()=>page.close());const html=await readFile(new URL('./fixtures/creator.html',import.meta.url),'utf-8');await page.route('https://creator.rednote.com/**',r=>r.request().url().endsWith('/upload-image')?r.fulfill({body:'ok'}):r.fulfill({body:html,contentType:'text/html'}));await page.goto('https://creator.rednote.com/publish/publish');const post=await loadPost(fileURLToPath(new URL('../examples/demo/post.json',import.meta.url)));await preparePreview(page,post,'Redlet demo',1500);return {page,post};}
async function manager(t:any,notes:any[]){const page=await browser.newPage();t.after(()=>page.close());const html=await readFile(new URL('./fixtures/manager.html',import.meta.url),'utf-8');await page.route('https://creator.rednote.com/**',r=>r.fulfill({body:html,contentType:'text/html'}));await page.goto('https://creator.rednote.com/new/note-manager');await page.evaluate(notes=>{(window as any).notes=notes;},notes);return page;}
const id='0123456789abcdef01234567';
test('submission persists its marker before exactly one final click',async t=>{
 const {page,post}=await editor(t);await page.getByRole('button',{name:'发布',exact:true}).evaluate(el=>{el.setAttribute('onclick',`if(!window.recorded)throw Error('missing marker');window.submitted++;const ack=document.createElement('div');ack.textContent='发布成功';document.body.append(ack);`);});
 const result=await submitPreview(page,post,'Redlet demo',async()=>{await page.evaluate(()=>{(window as any).recorded=true;});},700);
 assert.equal(result.submitted,true);assert.equal(result.status,'verification_pending');assert.equal(await page.evaluate(()=>(window as any).submitted),1);
});
test('a changed body after preview prevents any publish attempt',async t=>{
 const {page,post}=await editor(t);await page.locator('.ProseMirror').fill('changed');let marked=false;
 await assert.rejects(submitPreview(page,post,'Redlet demo',async()=>{marked=true;},500),/body|changed/i);assert.equal(marked,false);assert.equal(await page.evaluate(()=>(window as any).submitted),0);
});
test('a changed visibility after preview prevents the final click',async t=>{
 const {page,post}=await editor(t);await page.locator('.permission-card-wrapper .d-select-content span').evaluate(el=>{el.textContent='公开可见';});
 await assert.rejects(submitPreview(page,post,'Redlet demo',async()=>{},500),/visibility/i);assert.equal(await page.evaluate(()=>(window as any).submitted),0);
});
test('failed durable marker means no click; missing acknowledgement remains uncertain',async t=>{
 const {page,post}=await editor(t);await assert.rejects(submitPreview(page,post,'Redlet demo',async()=>{throw Error('disk full');},400),/disk full/);assert.equal(await page.evaluate(()=>(window as any).submitted),0);
 const result=await submitPreview(page,post,'Redlet demo',async()=>{},300);assert.equal(result.submitted,null);assert.equal(result.status,'verification_pending');assert.equal(await page.evaluate(()=>(window as any).submitted),1);
});
for(const [tab,status] of [['已发布','published'],['审核中','submitted_for_review'],['未通过','rejected']] as const)test(`exact target in ${tab} has its own status, id and only an observed link`,async t=>{
 const page=await manager(t,[{title:'本篇记录',tab,id,url:'https://www.xiaohongshu.com/explore/'+id},{title:'another private note',tab,id:'aaaaaaaaaaaaaaaaaaaaaaaa'}]);
 const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',1200);
 assert.equal(result.status,status);assert.equal(result.noteId,id);assert.equal(result.publicUrl,'https://www.xiaohongshu.com/explore/'+id);assert.equal(result.submitted,true);
 assert.equal(await page.locator('input').inputValue(),'本篇记录');
});
test('a similar title or missing target never becomes published and has no invented URL',async t=>{
 const page=await manager(t,[{title:'本篇记录的续篇',tab:'已发布',id}]);const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',900);assert.equal(result.status,'verification_pending');assert.equal(result.submitted,null);assert.equal(result.publicUrl,undefined);
});
test('duplicate exact titles or an unexpected note id stay unresolved',async t=>{
 const page=await manager(t,[{title:'本篇记录',tab:'已发布',id},{title:'本篇记录',tab:'已发布',id:'aaaaaaaaaaaaaaaaaaaaaaaa'}]);let result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',900);assert.equal(result.status,'verification_pending');assert.match(result.reason??'',/ambiguous|duplicate/i);
 await page.evaluate(()=>{(window as any).notes.pop();});result=await verifyTarget(page,{site:'rednote',title:'本篇记录',noteId:'bbbbbbbbbbbbbbbbbbbbbbbb'},'Redlet demo',900);assert.equal(result.status,'verification_pending');assert.match(result.reason??'',/identity|id/i);
});

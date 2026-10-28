import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,type Browser} from 'playwright';
import {loadPost} from '../src/post.js';
import {preparePreview,assertPreviewUnchanged} from '../src/creator.js';
import {submitPreview} from '../src/publish.js';

let browser:Browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
after(async()=>browser?.close());
async function fixture(t:any,tags=['AI','独立开发']){
 const page=await browser.newPage();t.after(()=>page.close());
 const html=await readFile(new URL('./fixtures/creator.html',import.meta.url),'utf-8');
 await page.route('https://creator.rednote.com/**',r=>r.request().url().endsWith('/upload-image')?r.fulfill({body:'ok'}):r.fulfill({body:html,contentType:'text/html'}));
 await page.goto('https://creator.rednote.com/publish/publish');
 const post=await loadPost(fileURLToPath(new URL('../examples/demo/post.json',import.meta.url)));post.tags=tags;
 return {page,post};
}

test('appends native topics in order while preserving original blank and trailing paragraphs',async t=>{
 const {page,post}=await fixture(t);post.body='第一段 <tag> & 文字\n\n最后一段\n\n';
 const result=await preparePreview(page,post,'Redlet demo',1800);
 assert.deepEqual(result.topics,[{name:'AI',id:'aaaaaaaaaaaaaaaaaaaaaaaa'},{name:'独立开发',id:'bbbbbbbbbbbbbbbbbbbbbbbb'}]);
 assert.equal(result.tagsVerified,true);
 assert.deepEqual((await page.locator('.tiptap > p').allTextContents()).slice(0,-1),['第一段 <tag> & 文字','','最后一段','','']);
 assert.equal(await page.evaluate(()=>(window as any).submitted),0);
});
test('selects the exact topic instead of the first similar candidate',async t=>{
 const {page,post}=await fixture(t,['AI']);
 await page.evaluate(()=>{(window as any).topicOptions.AI=[{name:'AI工具',id:'dddddddddddddddddddddddd'},{name:'AI',id:'aaaaaaaaaaaaaaaaaaaaaaaa'}];});
 const result=await preparePreview(page,post,'Redlet demo',1800);assert.deepEqual(result.topics,[{name:'AI',id:'aaaaaaaaaaaaaaaaaaaaaaaa'}]);
});
for(const [label,options] of [
 ['missing',[]],
 ['similar only',[{name:'AI工具',id:'dddddddddddddddddddddddd'}]],
 ['ambiguous',[{name:'AI',id:'aaaaaaaaaaaaaaaaaaaaaaaa'},{name:'AI',id:'bbbbbbbbbbbbbbbbbbbbbbbb'}]],
] as const)test(`stops before submission when the requested topic is ${label}`,async t=>{
 const {page,post}=await fixture(t,['AI']);await page.evaluate(options=>{(window as any).topicOptions.AI=options;},options);
 await assert.rejects(preparePreview(page,post,'Redlet demo',650),/AI/);
 assert.equal(await page.locator('a.tiptap-topic').count(),0);assert.equal(await page.evaluate(()=>(window as any).submitted),0);
});
test('waits for the current query instead of accepting a stale exact-name suggestion',async t=>{
 const {page,post}=await fixture(t,['AI']);await page.evaluate(()=>{
  (window as any).topicDelay=150;(window as any).staleTopic={query:'A',option:{name:'AI',id:'cccccccccccccccccccccccc'}};
 });
 const result=await preparePreview(page,post,'Redlet demo',1800);assert.deepEqual(result.topics,[{name:'AI',id:'aaaaaaaaaaaaaaaaaaaaaaaa'}]);
});
test('plain hashtag text cannot stand in for an associated topic',async t=>{
 const {page,post}=await fixture(t,['AI']);await page.evaluate(()=>{(window as any).plainTopic=true;});
 await assert.rejects(preparePreview(page,post,'Redlet demo',650),/AI|topic|tag/i);assert.equal(await page.evaluate(()=>(window as any).submitted),0);
});
test('invalid native topic metadata cannot pass preview verification',async t=>{
 const {page,post}=await fixture(t,['AI']);await page.evaluate(()=>{(window as any).topicOptions.AI=[{name:'AI',id:'not-a-topic-id'}];});
 await assert.rejects(preparePreview(page,post,'Redlet demo',650),/AI|topic|tag/i);
});
test('a legacy body containing a literal hashtag is preserved without creating topics',async t=>{
 const {page,post}=await fixture(t,[]);post.body='代码里的 # 也是普通文字\n#AI';
 const result=await preparePreview(page,post,'Redlet demo',1800);assert.deepEqual(result.topics,[]);
 assert.deepEqual(await page.locator('.tiptap > p').allTextContents(),['代码里的 # 也是普通文字','#AI']);
});

test('a verified topic preview can pass both final checks and submit exactly once',async t=>{
 const {page,post}=await fixture(t);const preview=await preparePreview(page,post,'Redlet demo',1800);
 await page.getByRole('button',{name:'发布',exact:true}).evaluate(el=>{el.setAttribute('onclick',"window.submitted++;const ack=document.createElement('div');ack.textContent='发布成功';document.body.append(ack);");});
 await assertPreviewUnchanged(page,post,'Redlet demo',800,preview.topics);
 let marked=false;const result=await submitPreview(page,post,'Redlet demo',async()=>{marked=true;},800,preview.topics);
 assert.equal(marked,true);assert.equal(result.submitted,true);assert.equal(await page.evaluate(()=>(window as any).submitted),1);
});
for(const mutation of ['remove','plain text','different id','different order'] as const)test(`a topic changed to ${mutation} after preview blocks the attempt marker`,async t=>{
 const {page,post}=await fixture(t);const preview=await preparePreview(page,post,'Redlet demo',1800);
 await page.locator('a.tiptap-topic').first().evaluate((el,mutation)=>{
  if(mutation==='remove')el.remove();
  if(mutation==='plain text')el.replaceWith(document.createTextNode('#AI'));
  if(mutation==='different id'){const data=JSON.parse(el.getAttribute('data-topic')!);data.id='cccccccccccccccccccccccc';el.setAttribute('data-topic',JSON.stringify(data));}
  if(mutation==='different order')el.parentElement!.append(el);
 },mutation);
 let marked=false;await assert.rejects(submitPreview(page,post,'Redlet demo',async()=>{marked=true;},800,preview.topics),/topic|tag/i);
 assert.equal(marked,false);assert.equal(await page.evaluate(()=>(window as any).submitted),0);
});
test('a topic identity changed after the durable marker still blocks the final click',async t=>{
 const {page,post}=await fixture(t,['AI']);const preview=await preparePreview(page,post,'Redlet demo',1800);let marked=false;
 await assert.rejects(submitPreview(page,post,'Redlet demo',async()=>{
  marked=true;await page.locator('a.tiptap-topic').evaluate(el=>{const data=JSON.parse(el.getAttribute('data-topic')!);data.id='cccccccccccccccccccccccc';el.setAttribute('data-topic',JSON.stringify(data));});
 },800,preview.topics),/topic|tag/i);
 assert.equal(marked,true);assert.equal(await page.evaluate(()=>(window as any).submitted),0);
});
test('topic submission requires the actual preview identities',async t=>{
 const {page,post}=await fixture(t,['AI']);await preparePreview(page,post,'Redlet demo',1800);
 let marked=false;await assert.rejects(submitPreview(page,post,'Redlet demo',async()=>{marked=true;},800),/topic|tag/i);assert.equal(marked,false);
});
test('an unrequested native topic cannot be inserted into a legacy preview',async t=>{
 const {page,post}=await fixture(t,[]);const preview=await preparePreview(page,post,'Redlet demo',1800);
 await page.locator('.tiptap > p').last().evaluate(el=>{const a=document.createElement('a');a.className='tiptap-topic';a.setAttribute('contenteditable','false');a.setAttribute('data-topic',JSON.stringify({name:'AI',id:'aaaaaaaaaaaaaaaaaaaaaaaa'}));a.textContent='#AI';el.append(a);});
 await assert.rejects(assertPreviewUnchanged(page,post,'Redlet demo',800,preview.topics),/topic|tag/i);
});

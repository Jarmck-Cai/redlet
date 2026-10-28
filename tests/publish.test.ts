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
async function manager(t:any,notes:any[],options:{delays?:Record<string,number>;staleOnReview?:boolean;initialAll?:boolean;cachedSearch?:boolean;loseSearchOnce?:boolean}={}){const page=await browser.newPage();t.after(()=>page.close());let html=await readFile(new URL('./fixtures/manager.html',import.meta.url),'utf-8');
 if(options.loseSearchOnce)html=html.replace("document.querySelector('input').oninput=()=>{","document.querySelector('input').oninput=()=>{if(!window.lostSearch){window.lostSearch=true;setTimeout(()=>{const q=document.querySelector('input');q.value='';q.setAttribute('value','');load();},100);}");
 if(options.cachedSearch)html=html.replace("document.querySelector('.tab-item').classList.add('tab-item--active');load();","document.querySelector('.tab-item').classList.add('tab-item--active');render();");
 if(options.initialAll)html=html.replace('window.notes=[];', 'window.notes=[];window.firstLoad=true;').replace("const num={'已发布':'1','审核中':'2','未通过':'3'}[tab];","const num=window.firstLoad?'0':{'已发布':'1','审核中':'2','未通过':'3'}[tab];window.firstLoad=false;");
 if(options.staleOnReview)html=html.replace("tab.classList.add('tab-item--active');load();","tab.classList.add('tab-item--active');load();if(tab.textContent==='审核中')fetch('/api/galaxy/v2/creator/note/user/posted?tab=1&page=0&stale=1').then(r=>r.json()).then(n=>{window.renderedNotes=n;render();});");
 await page.route('https://creator.rednote.com/**',async r=>{const u=new URL(r.request().url());if(u.pathname==='/api/galaxy/v2/creator/note/user/posted'){const tab=u.searchParams.get('tab')!;await new Promise(resolve=>setTimeout(resolve,u.searchParams.has('stale')?350:options.delays?.[tab]??20));const label=({'1':'已发布','2':'审核中','3':'未通过'} as any)[tab];await r.fulfill({body:JSON.stringify(u.searchParams.has('stale')?[{title:'本篇记录',tab:'审核中',id}]:(tab==='0'?notes:notes.filter(n=>n.tab===label))),contentType:'application/json'});}else await r.fulfill({body:html,contentType:'text/html'});});
 await page.goto('https://creator.rednote.com/new/note-manager');return page;}
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
 assert.equal(await page.locator('input').inputValue(),tab==='已发布'?'本篇记录':'');
});
test('a similar title or missing target never becomes published and has no invented URL',async t=>{
 const page=await manager(t,[{title:'本篇记录的续篇',tab:'已发布',id}]);const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',900);assert.equal(result.status,'verification_pending');assert.equal(result.submitted,null);assert.equal(result.publicUrl,undefined);
});
test('duplicate exact titles or an unexpected note id stay unresolved',async t=>{
 const notes=[{title:'本篇记录',tab:'已发布',id},{title:'本篇记录',tab:'已发布',id:'aaaaaaaaaaaaaaaaaaaaaaaa'}];const page=await manager(t,notes);let result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',900);assert.equal(result.status,'verification_pending');assert.match(result.reason??'',/ambiguous|duplicate/i);
 notes.pop();result=await verifyTarget(page,{site:'rednote',title:'本篇记录',noteId:'bbbbbbbbbbbbbbbbbbbbbbbb'},'Redlet demo',900);assert.equal(result.status,'verification_pending');assert.match(result.reason??'',/identity|id/i);
});

test('waits for delayed current-tab results before deciding a title is absent',async t=>{
 const page=await manager(t,[{title:'本篇记录',tab:'已发布',id}],{delays:{'1':2300}});
 const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',3000);assert.equal(result.status,'published');assert.equal(result.noteId,id);
});
test('out-of-order response from another tab cannot validate the active tab',async t=>{
 const page=await manager(t,[],{staleOnReview:true});const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',1600);assert.equal(result.status,'verification_pending');assert.match(result.reason??'',/fresh|settle|result/i);
});

test('initial all-results response is not treated as the published filter',async t=>{
 const page=await manager(t,[{title:'本篇记录',tab:'审核中',id}],{initialAll:true});const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',1400);assert.equal(result.status,'submitted_for_review');assert.equal(result.noteId,id);
});

test('cached published-title search verifies the rendered target without a new list request',async t=>{
 const page=await manager(t,[{title:'本篇记录',tab:'已发布',id}],{initialAll:true,cachedSearch:true});const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',1000);assert.equal(result.status,'published');assert.equal(result.noteId,id);
});

test('reapplies a search that initial hydration clears before reading the target',async t=>{
 const page=await manager(t,[{title:'本篇记录',tab:'已发布',id}],{loseSearchOnce:true});const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',1600);assert.equal(result.status,'published');assert.equal(await page.locator('input').inputValue(),'本篇记录');
});

async function closedPublisher(page:any,disabled=false){
 await page.getByRole('button',{name:'发布',exact:true}).evaluate((el:any)=>el.remove());
 await page.evaluate((disabled:boolean)=>{
  (window as any).saved=0;
  customElements.define('xhs-publish-btn',class extends HTMLElement{connectedCallback(){const root=this.attachShadow({mode:'closed'});root.innerHTML='<style>:host{display:block;width:600px;height:90px}button{width:120px;height:44px;margin:10px}</style><button type="button" class="ce-btn white">暂存离开</button><button type="button" class="ce-btn bg-red" aria-disabled="false" aria-busy="false">发布</button>';root.querySelector('.white')!.addEventListener('click',()=>{(window as any).saved++;});root.querySelector('.bg-red')!.addEventListener('click',()=>{(window as any).submitted++;const el=document.createElement('div');el.textContent='发布成功';document.body.append(el);});}});
  const host=document.createElement('xhs-publish-btn');for(const [key,value] of Object.entries({'is-publish':'true','submit-text':'发布','submit-disabled':disabled?'true':'false','submit-loading':'false'}))host.setAttribute(key,value);document.querySelector('.publish-page-content')!.append(host);
 },disabled);
}
test('closed publish component clicks its real publish button, preserving the neighbouring draft action',async t=>{
 const {page,post}=await editor(t);await closedPublisher(page);let recorded=false;const result=await submitPreview(page,post,'Redlet demo',async()=>{recorded=true;},1000);assert.equal(recorded,true);assert.equal(result.submitted,true);assert.equal(await page.evaluate(()=>(window as any).submitted),1);assert.equal(await page.evaluate(()=>(window as any).saved),0);
});
test('disabled closed publish component stops before saving an attempt or clicking either action',async t=>{
 const {page,post}=await editor(t);await closedPublisher(page,true);let recorded=false;await assert.rejects(submitPreview(page,post,'Redlet demo',async()=>{recorded=true;},500),/disabled|enabled/i);assert.equal(recorded,false);assert.equal(await page.evaluate(()=>(window as any).submitted),0);assert.equal(await page.evaluate(()=>(window as any).saved),0);
});

for(const [firstTab,secondTab] of [['已发布','审核中'],['审核中','未通过']] as const)test(`same title in ${firstTab} and ${secondTab} cannot bind a task to either note`,async t=>{
 const page=await manager(t,[{title:'本篇记录',tab:firstTab,id:'aaaaaaaaaaaaaaaaaaaaaaaa'},{title:'本篇记录',tab:secondTab,id:'bbbbbbbbbbbbbbbbbbbbbbbb'}]);
 const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',1600);
 assert.equal(result.status,'verification_pending');assert.equal(result.submitted,null);assert.equal(result.noteId,undefined);assert.equal(result.publicUrl,undefined);assert.match(result.reason??'',/ambiguous|duplicate/i);
});

test('title-only match must still have the same note id when its status view is revisited',async t=>{
 const notes=[{title:'本篇记录',tab:'已发布',id:'aaaaaaaaaaaaaaaaaaaaaaaa'}];const page=await manager(t,notes);
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/galaxy/v2/creator/note/user/posted'&&url.searchParams.get('tab')==='2')notes[0].id='bbbbbbbbbbbbbbbbbbbbbbbb';});
 const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',1600);
 assert.equal(result.status,'verification_pending');assert.equal(result.noteId,undefined);assert.equal(result.publicUrl,undefined);
});

test('title-only card without a usable note id cannot bind a task identity',async t=>{
 const page=await manager(t,[{title:'本篇记录',tab:'已发布'}]);const result=await verifyTarget(page,{site:'rednote',title:'本篇记录'},'Redlet demo',1600);
 assert.equal(result.status,'verification_pending');assert.equal(result.noteId,undefined);assert.match(result.reason??'',/identity|id/i);
});

import type {Page,Request} from 'playwright';
import type {PostBundle} from './post.js';
import {assertPreviewUnchanged,readAccount} from './creator.js';
import {finalPublishAction} from './publish-button.js';
export interface PublicationResult {
 status:'verification_pending'|'submitted_for_review'|'published'|'rejected';submitted:true|null;
 noteId?:string;publicUrl?:string;reason?:string;verifiedAt?:string;acknowledgedAt?:string;
}
export interface Target {site:PostBundle['site'];title:string;noteId?:string}
const pending=(reason:string):PublicationResult=>({status:'verification_pending',submitted:null,reason});
export async function submitPreview(page:Page,post:PostBundle,expectedAccount:string,beforeClick:()=>Promise<void>,timeout=30000):Promise<PublicationResult>{
 await assertPreviewUnchanged(page,post,expectedAccount,timeout);
 const click=await finalPublishAction(page,timeout);
 const success=page.getByText(/^发布成功(?:[，,！!。].*)?$/).filter({visible:true});
 if(await success.count())throw new Error('A stale success message is already present');
 await beforeClick();
 await assertPreviewUnchanged(page,post,expectedAccount,timeout);
 try{
  await click();
  await success.waitFor({state:'visible',timeout});
  return {status:'verification_pending',submitted:true,acknowledgedAt:new Date().toISOString(),reason:'Submission acknowledged; final target status still needs verification'};
 }catch{return pending('Publish attempt made; acknowledgement unavailable. Verify this task, do not resubmit.');}
}
function escapeRegex(s:string){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
// Observe ordinary page requests for freshness; this code never calls the list API.
function watchManager(page:Page,host:string){
 const pendingRequests=new Set<Request>();let completed=0,lastTab='',lastCompletion=0,failed=false;const matched=new Map<string,number>();
 const listener=(request:Request)=>{
  const u=new URL(request.url());if(u.hostname!==host||u.pathname!=='/api/galaxy/v2/creator/note/user/posted'||u.searchParams.get('page')!=='0')return;
  pendingRequests.add(request);const tab=u.searchParams.get('tab')??'';
  void(async()=>{try{const response=await request.response();if(!response||response.status()<200||response.status()>=300||await response.finished())failed=true;lastTab=tab;completed++;matched.set(tab,completed);lastCompletion=Date.now();}catch{failed=true;}finally{pendingRequests.delete(request);}})();
 };
 page.on('request',listener);
 return {version:()=>completed,idle:()=>!failed&&pendingRequests.size===0&&Date.now()-lastCompletion>=80,stop:()=>page.off('request',listener),async ready(tab:string,after:number,timeout:number){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
   if(failed)return false;
   if((tab==='*'?completed:(matched.get(tab)??0))>after&&pendingRequests.size===0&&(tab==='*'||lastTab===tab)&&Date.now()-lastCompletion>=80&&await page.locator('.d-v-loading').filter({visible:true}).count()===0)return true;
   if((tab==='*'?completed:(matched.get(tab)??0))>after&&pendingRequests.size===0&&tab!=='*'&&lastTab!==tab)return false;
   await page.waitForTimeout(40);
  }
  return false;
 }};
}
export async function verifyTarget(page:Page,target:Target,expectedAccount:string,timeout=30000):Promise<PublicationResult>{
 const host=target.site==='rednote'?'creator.rednote.com':'creator.xiaohongshu.com';
 if(new URL(page.url()).hostname!==host)throw new Error('Unexpected creator origin');
 if(await readAccount(page,timeout)!==expectedAccount.trim())throw new Error('Creator account does not match task');
 const responses=watchManager(page,host);
 try{
  // Reload intentionally: observe the complete initial request lifecycle, including cached results.
  await page.goto(`https://${host}/new/note-manager`,{waitUntil:'domcontentloaded'});
  const active=page.locator('.tab-list .tab-item--active');await active.waitFor({state:'visible',timeout});
  const tabs=[['已发布','published','1'],['审核中','submitted_for_review','2'],['未通过','rejected','3']] as const;
  if(!await responses.ready('*',0,timeout))return pending('Cannot establish fresh initial status results');
  const search=page.getByPlaceholder('搜索已发布的笔记',{exact:true});await search.waitFor({state:'visible',timeout});
  // Search selects the published view itself and can use cached data. Initial
  // hydration may clear its input once; require persistent readback after all
  // observed list requests and loading have settled, reapplying only the query.
  const searchDeadline=Date.now()+timeout;let stableSince=0,lastVersion=-1,searchReady=false;
  while(Date.now()<searchDeadline){
   if(!await responses.ready('*',0,Math.max(1,searchDeadline-Date.now())))break;
   if(await search.inputValue()!==target.title){await search.fill(target.title);stableSince=0;}
   const state=await search.evaluate((input,title)=>{const el=input as HTMLInputElement;const active=document.querySelector('.tab-list .tab-item--active');return el.value===title&&el.getAttribute('value')===title&&active?.textContent?.trim()==='已发布';},target.title);
   const version=responses.version();
   if(state&&responses.idle()&&version===lastVersion){if(!stableSince)stableSince=Date.now();if(Date.now()-stableSince>=350){searchReady=true;break;}}else stableSince=0;
   lastVersion=version;await page.waitForTimeout(40);
  }
  if(!searchReady)return pending('Title search did not settle after initial hydration');
  let titleMatch:PublicationResult|undefined;
  for(const [label,status,value] of tabs){
   const tab=page.locator('.tab-list .tab-item').filter({hasText:new RegExp('^'+label+'$')});
   if(await tab.count()!==1)return pending('Cannot identify the target status tab');
   let baseline=0;
   if(!await tab.evaluate(el=>el.classList.contains('tab-item--active'))){baseline=responses.version();await tab.click({timeout});}
   if(!await responses.ready(value==='1'?'*':value,baseline,timeout))return pending('Cannot establish fresh current-tab results');
   if(!await tab.evaluate(el=>el.classList.contains('tab-item--active')))return pending('Status tab changed during verification');
   if(value==='1'&&await search.inputValue()!==target.title)return pending('Title search changed during verification');
   // Reviewing/rejected tabs clear the published-only search. Resolve only the exact
   // target locator there; never snapshot, export or read other cards/list responses.
   const consistent=await page.locator('.note-card').filter({visible:true}).evaluateAll((cards,published)=>cards.every(card=>{
    try{const channel=JSON.parse(card.getAttribute('data-impression')??'{}').index?.value?.channelTabName;return published?channel==='published':typeof channel==='string'&&!['published','all'].includes(channel);}catch{return false;}
   }),value==='1');
   if(!consistent)return pending('Result card view metadata is stale or does not match the current status');
   const title=page.locator('.note-card__title').filter({hasText:new RegExp('^'+escapeRegex(target.title)+'$')});
   const cards=page.locator('.note-card').filter({has:title,visible:true});const count=await cards.count();
   if(count>1)return pending('Ambiguous duplicate exact titles; no automatic match');
   if(count===0)continue;
   const details=await cards.evaluate(el=>{
    let id:string|undefined;try{id=JSON.parse(el.getAttribute('data-impression')??'{}').noteTarget?.value?.noteId;}catch{}
    const links=Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]')).map(a=>a.href);return {id,links};
   });
   const noteId=typeof details.id==='string'&&/^[a-f0-9]{24}$/.test(details.id)?details.id:undefined;
   if(target.noteId&&noteId!==target.noteId)return pending('Target note identity/id does not match the journal');
   const publicUrl=details.links.find(link=>{try{const u=new URL(link);return u.protocol==='https:'&&!u.search&&!u.hash&&!u.username&&!u.password&&['www.xiaohongshu.com','www.rednote.com','xiaohongshu.com','rednote.com'].includes(u.hostname)&&new RegExp('^/(explore|discovery/item)/'+(noteId??'[a-f0-9]{24}')+'$').test(u.pathname);}catch{return false;}});
   if(await readAccount(page,timeout)!==expectedAccount.trim())throw new Error('Creator account changed during verification');
   const result:PublicationResult={status,submitted:true,noteId,publicUrl,verifiedAt:new Date().toISOString()};
   if(target.noteId)return result;
   if(!noteId)return pending('Exact title has no usable note id; cannot bind task identity');
   if(titleMatch)return pending('Ambiguous duplicate exact titles across status views; no automatic match');
   titleMatch=result;
  }
  if(titleMatch?.noteId){
   // A title-only match must be unique across these loaded status views. Revisit
   // it with the observed id so the returned evidence and page still agree.
   responses.stop();
   return verifyTarget(page,{...target,noteId:titleMatch.noteId},expectedAccount,timeout);
  }
  return pending('Exact title not found in currently loaded results; keep verifying, do not republish');
 }finally{responses.stop();}
}

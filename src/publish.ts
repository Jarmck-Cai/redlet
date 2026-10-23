import type {Page} from 'playwright';
import type {PostBundle} from './post.js';
import {assertPreviewUnchanged,readAccount} from './creator.js';
export interface PublicationResult {
 status:'verification_pending'|'submitted_for_review'|'published'|'rejected';submitted:true|null;
 noteId?:string;publicUrl?:string;reason?:string;verifiedAt?:string;acknowledgedAt?:string;
}
export interface Target {site:PostBundle['site'];title:string;noteId?:string}
const pending=(reason:string):PublicationResult=>({status:'verification_pending',submitted:null,reason});
export async function submitPreview(page:Page,post:PostBundle,expectedAccount:string,beforeClick:()=>Promise<void>,timeout=30000):Promise<PublicationResult>{
 await assertPreviewUnchanged(page,post,expectedAccount,timeout);
 const button=page.getByRole('button',{name:'发布',exact:true}).filter({visible:true});
 if(await button.count()!==1||!await button.isEnabled())throw new Error('Cannot identify one enabled final publish button');
 const success=page.getByText(/^发布成功(?:[，,！!。].*)?$/).filter({visible:true});
 if(await success.count())throw new Error('A stale success message is already present');
 await beforeClick();
 await assertPreviewUnchanged(page,post,expectedAccount,timeout);
 try{
  await button.click({timeout});
  await success.waitFor({state:'visible',timeout});
  return {status:'verification_pending',submitted:true,acknowledgedAt:new Date().toISOString(),reason:'Submission acknowledged; final target status still needs verification'};
 }catch{return pending('Publish attempt made; acknowledgement unavailable. Verify this task, do not resubmit.');}
}
function escapeRegex(s:string){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
export async function verifyTarget(page:Page,target:Target,expectedAccount:string,timeout=30000):Promise<PublicationResult>{
 const host=target.site==='rednote'?'creator.rednote.com':'creator.xiaohongshu.com';
 if(new URL(page.url()).hostname!==host)throw new Error('Unexpected creator origin');
 if(await readAccount(page,timeout)!==expectedAccount.trim())throw new Error('Creator account does not match task');
 if(new URL(page.url()).pathname!=='/new/note-manager')await page.goto(`https://${host}/new/note-manager`,{waitUntil:'domcontentloaded'});
 await page.locator('.tab-list .tab-item--active').waitFor({state:'visible',timeout});
 const search=page.getByPlaceholder('搜索已发布的笔记',{exact:true});await search.waitFor({state:'visible',timeout});
 // The initial manager hydration replaces its input; let it settle before entering the query.
 await page.waitForTimeout(Math.min(1200,timeout/3));
 for(const [label,status] of [['已发布','published'],['审核中','submitted_for_review'],['未通过','rejected']] as const){
  const tab=page.locator('.tab-list .tab-item').filter({hasText:new RegExp('^'+label+'$')});
  if(await tab.count()!==1)return pending('Cannot identify the target status tab');
  await tab.click({timeout});await search.fill(target.title);await search.press('Enter');
  try{await page.waitForFunction(title=>{const input=document.querySelector<HTMLInputElement>('input[placeholder="搜索已发布的笔记"]');return input?.value===title&&input.getAttribute('value')===title;},target.title,{timeout});}catch{return pending('Title search did not settle');}
  await page.waitForTimeout(Math.min(700,timeout/3));
  if(!await tab.evaluate(el=>el.classList.contains('tab-item--active')))return pending('Status tab changed during verification');
  if(await search.inputValue()!==target.title)return pending('Title search changed during verification');
  const title=page.locator('.note-card__title').filter({hasText:new RegExp('^'+escapeRegex(target.title)+'$')});
  const cards=page.locator('.note-card').filter({has:title,visible:true});
  const count=await cards.count();
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
  return {status,submitted:true,noteId,publicUrl,verifiedAt:new Date().toISOString()};
 }
 return pending('Exact title not found in published, reviewing or rejected results');
}

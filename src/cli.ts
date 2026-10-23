#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadPost } from './post.js';
import { preparePreview, readAccount } from './creator.js';
import {submitPreview,verifyTarget,type PublicationResult} from './publish.js';
import {beginTask,readTask,saveTask,lockTask,type TaskRecord} from './journal.js';
import { openCreator, creatorUrl, bindAccount, boundAccount, type Site } from './browser.js';
const usage=`Redlet — local Xiaohongshu publishing workflow

  redlet check <post.json>
  redlet login [--site rednote|xiaohongshu] [--account DISPLAY_NAME]
  redlet preview <post.json> [--account DISPLAY_NAME] [--close]
  redlet publish <post.json> --confirm CONTENT_ID [--account DISPLAY_NAME]
  redlet verify <content_id> [--site rednote|xiaohongshu]

  --state-dir DIR    Local profiles and receipts (default: .runtime)
  --close            Close browser after saving the verified preview

Login is manual in Redlet's own browser profile. Preview uploads the specified
images and may create a platform draft. Only publish clicks the final button.
An attempted content id is never automatically submitted again; use verify.
`;
async function main(): Promise<number> {
  const {values,positionals}=parseArgs({args:process.argv.slice(2),allowPositionals:true,strict:true,options:{
    help:{type:'boolean',short:'h'},site:{type:'string'},account:{type:'string'},'state-dir':{type:'string'},close:{type:'boolean'},confirm:{type:'string'}
  }});
  if (values.help || !positionals.length) { console.log(usage);return 0; }
  const [command,manifest]=positionals;
  if (!['check','login','preview','publish','verify'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (positionals.length>(command==='login'?1:2)) throw new Error('Unexpected positional arguments');
  if (values.site && !['login','verify'].includes(command)) throw new Error('--site is only used with login/verify; preview/publish use the bundle site');
  if (values.close && command!=='preview') throw new Error('--close is only used with preview');
  if(values.confirm && command!=='publish')throw new Error('--confirm is only used with publish');
  const stateDir=resolve(values['state-dir']??'.runtime');
  if(command==='verify'){
    if(!manifest)throw new Error('A content id is required for task verification');
    const site=values.site??'rednote';if(site!=='rednote'&&site!=='xiaohongshu')throw new Error('Unknown site');
    const task=await readTask(stateDir,site,manifest);
    if(!task.attemptedAt)throw new Error('Task has not attempted submission');
    if(values.account&&values.account.trim()!==task.account)throw new Error('Account differs from task');
    const release=await lockTask(stateDir,site,manifest);
    try{return await publicationCommand(stateDir,task,undefined);}finally{await release();}
  }
  if (command==='login') {
    const site=values.site??'rednote';
    if (site!=='rednote' && site!=='xiaohongshu') throw new Error('Unknown site');
    const context=await openCreator(site,stateDir);
    const interrupt=()=>{void context.close();};process.once('SIGINT',interrupt);
    try {
      const page=await context.newPage();await page.goto(creatorUrl(site),{waitUntil:'domcontentloaded'});
      console.error('Complete login manually in the Redlet browser. Waiting for the account header (up to 20 minutes)...');
      const name=await readAccount(page,20*60*1000);
      if (values.account && values.account.trim()!==name) throw new Error('Creator account does not match --account');
      await bindAccount(site,stateDir,name);
      console.log(JSON.stringify({status:'login_ready',site,displayName:name}));return 0;
    } finally { process.removeListener('SIGINT',interrupt);await context.close(); }
  }
  if (!manifest) throw new Error('A post.json manifest is required');
  const post=await loadPost(manifest);
  if (command==='check') {
    console.log(JSON.stringify({status:'bundle_valid',contentId:post.contentId,title:post.title,bodyCharacters:Array.from(post.body).length,imageCount:post.images.length,site:post.site,aiGenerated:post.aiGenerated,visibility:post.visibility},null,2));return 0;
  }
  if(command==='publish'&&values.confirm!==post.contentId)throw new Error('Publish requires --confirm matching the exact content_id');
  const expected=(values.account??post.expectedAccount??await boundAccount(post.site,stateDir))?.trim();
  if (!expected) throw new Error(`No account binding. Run: redlet login --site ${post.site}`);
  if(command==='publish'){
    const release=await lockTask(stateDir,post.site,post.contentId);
    try{const task=await beginTask(stateDir,post,expected);return await publicationCommand(stateDir,task,post);}finally{await release();}
  }
  const context=await openCreator(post.site,stateDir);
  const interrupt=()=>{void context.close();};process.once('SIGINT',interrupt);
  const folder=join(stateDir,'receipts');const stem=`${post.contentId}-${Date.now()}`;
  try {
    const page=await context.newPage();await page.goto(creatorUrl(post.site),{waitUntil:'domcontentloaded'});
    const result=await preparePreview(page,post,expected);
    await mkdir(folder,{recursive:true});
    const screenshot=join(folder,`${stem}.png`);
    await page.locator('.publish-page-content').screenshot({path:screenshot,mask:[page.getByText(expected,{exact:true}),page.getByRole('img',{name:'头像',exact:true})],maskColor:'#e5e7eb'});
    const receipt=join(folder,`${stem}.json`);
    await writeFile(receipt,JSON.stringify({...result,screenshot},null,2)+'\n','utf-8');
    console.log(JSON.stringify({status:result.status,submitted:false,contentId:post.contentId,imageCount:post.images.length,receipt,screenshot},null,2));
    if (!values.close) {
      console.error('Preview is ready. Review it in the browser; close the Redlet browser to finish. No submission was performed.');
      await context.waitForEvent('close',{timeout:0});
    }
    return 0;
  } catch (error) {
    await mkdir(folder,{recursive:true});
    await writeFile(join(folder,`${stem}.json`),JSON.stringify({status:'preview_failed',submitted:false,contentId:post.contentId,error:error instanceof Error?error.message:String(error),checkedAt:new Date().toISOString()},null,2)+'\n','utf-8');
    throw error;
  } finally { process.removeListener('SIGINT',interrupt);await context.close(); }
}

function applyResult(task:TaskRecord,result:PublicationResult){
 task.status=result.status;task.submitted=result.submitted??task.submitted;
 if(result.acknowledgedAt&&!task.submittedAt)task.submittedAt=result.acknowledgedAt;
 if(result.noteId)task.noteId=result.noteId;if(result.publicUrl)task.publicUrl=result.publicUrl;
 if(result.verifiedAt)task.verifiedAt=result.verifiedAt;
 if(result.reason)task.reason=result.reason;else delete task.reason;
}
async function publicationCommand(stateDir:string,task:TaskRecord,post?:Awaited<ReturnType<typeof loadPost>>):Promise<number>{
 let context:Awaited<ReturnType<typeof openCreator>>|undefined;
 try{
  context=await openCreator(task.site,stateDir);const page=await context.newPage();await page.goto(creatorUrl(task.site),{waitUntil:'domcontentloaded'});
  if(post){
   const existing=await verifyTarget(page,{site:task.site,title:task.title},task.account);
   if(existing.submitted===true||existing.reason!=='Exact title not found in published, reviewing or rejected results')throw new Error('An existing/ambiguous title or unavailable target search prevents a new submission');
   await page.goto(creatorUrl(task.site),{waitUntil:'domcontentloaded'});await preparePreview(page,post,task.account);
   const folder=join(stateDir,'receipts');await mkdir(folder,{recursive:true});const screenshot=join(folder,`${post.contentId}-${Date.now()}-preview.png`);
   await page.locator('.publish-page-content').screenshot({path:screenshot,mask:[page.getByText(task.account,{exact:true}),page.getByRole('img',{name:'头像',exact:true})],maskColor:'#e5e7eb'});
   task.screenshot=screenshot;await saveTask(stateDir,task);
   const result=await submitPreview(page,post,task.account,async()=>{task.status='submitting';task.submitted=null;task.attemptedAt=new Date().toISOString();await saveTask(stateDir,task);});
   applyResult(task,result);await saveTask(stateDir,task);
  }
  const result=await verifyTarget(page,task,task.account);applyResult(task,result);await saveTask(stateDir,task);
  if(['published','submitted_for_review','rejected'].includes(task.status)){
   const titles=page.locator('.note-card__title').filter({hasText:new RegExp('^'+task.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
   const card=page.locator('.note-card').filter({has:titles,visible:true});
   if(await card.count()===1){const screenshot=join(stateDir,'receipts',`${task.contentId}-${Date.now()}-result.png`);await mkdir(join(stateDir,'receipts'),{recursive:true});await card.screenshot({path:screenshot}).catch(()=>undefined);}
  }
  console.log(JSON.stringify({status:task.status,submitted:task.submitted,contentId:task.contentId,noteId:task.noteId,publicUrl:task.publicUrl,attemptedAt:task.attemptedAt,submittedAt:task.submittedAt,verifiedAt:task.verifiedAt,reason:task.reason},null,2));
  return task.status==='published'||task.status==='submitted_for_review'?0:3;
 }catch(error){
  task.status=task.attemptedAt?'verification_pending':'preview_failed';if(!task.attemptedAt)task.submitted=false;
  task.reason=error instanceof Error?error.message:String(error);await saveTask(stateDir,task);throw error;
 }finally{await context?.close();}
}

try { process.exitCode=await main(); }
catch (error) { console.error(error instanceof Error?error.message:String(error));process.exitCode=2; }

#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadPost } from './post.js';
import { preparePreview, readAccount } from './creator.js';
import { openCreator, creatorUrl, bindAccount, boundAccount, type Site } from './browser.js';
const usage=`Redlet — local Xiaohongshu editor preview

  redlet check <post.json>
  redlet login [--site rednote|xiaohongshu] [--account DISPLAY_NAME]
  redlet preview <post.json> [--account DISPLAY_NAME] [--close]

  --state-dir DIR    Local profiles and receipts (default: .runtime)
  --close            Close browser after saving the verified preview

Login is manual in Redlet's own browser profile. Preview uploads the specified
images and may create a platform draft. It never clicks the final publish button.
`;
async function main(): Promise<number> {
  const {values,positionals}=parseArgs({args:process.argv.slice(2),allowPositionals:true,strict:true,options:{
    help:{type:'boolean',short:'h'},site:{type:'string'},account:{type:'string'},'state-dir':{type:'string'},close:{type:'boolean'}
  }});
  if (values.help || !positionals.length) { console.log(usage);return 0; }
  const [command,manifest]=positionals;
  if (!['check','login','preview'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (positionals.length>(command==='login'?1:2)) throw new Error('Unexpected positional arguments');
  if (values.site && command!=='login') throw new Error('--site is only used with login; preview uses the bundle site');
  if (values.close && command!=='preview') throw new Error('--close is only used with preview');
  const stateDir=resolve(values['state-dir']??'.runtime');
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
  const expected=(values.account??post.expectedAccount??await boundAccount(post.site,stateDir))?.trim();
  if (!expected) throw new Error(`No account binding. Run: redlet login --site ${post.site}`);
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
try { process.exitCode=await main(); }
catch (error) { console.error(error instanceof Error?error.message:String(error));process.exitCode=2; }

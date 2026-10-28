import { chromium, type BrowserContext } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { PostBundle } from './post.js';
export type Site=PostBundle['site'];
export const creatorUrl=(site: Site)=>`https://creator.${site==='rednote'?'rednote':'xiaohongshu'}.com/publish/publish`;
export async function openCreator(site: Site, stateDir: string): Promise<BrowserContext> {
  const profile=resolve(stateDir,'profiles',site);
  await mkdir(profile,{recursive:true});
  return chromium.launchPersistentContext(profile,{headless:false,viewport:{width:1280,height:900},...(process.platform==='win32'?{channel:'chrome'}:{})});
}
export async function boundAccount(site: Site, stateDir: string): Promise<string|undefined> {
  try {
    const binding=JSON.parse(await readFile(join(stateDir,'accounts',`${site}.json`),'utf-8'));
    if (binding.site===site && typeof binding.display_name==='string' && binding.display_name.trim()) return binding.display_name.trim();
  } catch { /* No usable binding: the caller gives the login step. */ }
  return undefined;
}
export async function bindAccount(site: Site, stateDir: string, displayName: string): Promise<void> {
  const folder=join(stateDir,'accounts');await mkdir(folder,{recursive:true});
  await writeFile(join(folder,`${site}.json`),JSON.stringify({site,display_name:displayName,checked_at:new Date().toISOString()},null,2)+'\n','utf-8');
}

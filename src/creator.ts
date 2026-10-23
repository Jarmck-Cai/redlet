import type { Page, Locator } from 'playwright';
import type { PostBundle } from './post.js';
export interface PreviewResult {
  status: 'preview_ready'; submitted: false; contentId: string; imageCount: number;
  images: { index: number; filename: string; sha256: string }[];
  titleVerified: true; bodyVerified: true; imageOrderVerified: true;
  aiGenerated: boolean; visibility: 'public' | 'private'; accountMatched: true; verifiedAt: string;
}
const titleSelector='div.d-input input, input[placeholder*="填写标题"]';
const editorSelector='div.tiptap[contenteditable="true"], div.ProseMirror[contenteditable="true"]';
const cardSelector='.img-preview-area .pr';
const imageSelector=`${cardSelector} img.preview`;
function canonical(text: string): string { return text.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/\n+$/,''); }
async function unique(locator: Locator, label: string): Promise<Locator> {
  const visible=locator.filter({visible:true});
  if (await visible.count()!==1) throw new Error(`Cannot identify a unique ${label} control`);
  return visible;
}
export async function readAccount(page: Page, timeout=30000): Promise<string> {
  const url=new URL(page.url());
  if (!['creator.rednote.com','creator.xiaohongshu.com'].includes(url.hostname)) throw new Error('Unexpected creator origin');
  const account=page.locator('.user-info .name-box').filter({visible:true});
  try { await account.waitFor({state:'visible',timeout}); } catch { throw new Error('Login required: run redlet login in the dedicated browser'); }
  if (await account.count()!==1) throw new Error('Ambiguous account identity');
  const name=(await account.innerText()).trim();
  if (!name) throw new Error('Cannot read account display name');
  return name;
}
async function readBody(editor: Locator): Promise<string> {
  return editor.evaluate(el=>Array.from(el.childNodes).map(node=>node.textContent??'').join('\n'));
}
async function imageSources(page: Page): Promise<string[]> {
  return page.locator(imageSelector).evaluateAll(els=>els.map(el=>(el as HTMLImageElement).currentSrc||(el as HTMLImageElement).src));
}
export async function preparePreview(page: Page, post: PostBundle, expectedAccount: string, timeout=30000): Promise<PreviewResult> {
  page.setDefaultTimeout(timeout);
  const origin=post.site==='rednote'?'creator.rednote.com':'creator.xiaohongshu.com';
  if (new URL(page.url()).hostname!==origin) throw new Error('Unexpected creator origin for this bundle');
  if (!expectedAccount.trim() || await readAccount(page,timeout)!==expectedAccount.trim()) throw new Error('Creator account does not match the expected account');
  const existingTitle=page.locator(titleSelector).filter({visible:true});
  const existingBody=page.locator(editorSelector).filter({visible:true});
  if (await page.locator(cardSelector).count() || (await existingTitle.count() && await existingTitle.inputValue()) || (await existingBody.count() && canonical(await readBody(existingBody)).trim())) throw new Error('Refusing to overwrite a nonempty editor or draft');
  if (!await existingTitle.count()) await page.getByText('上传图文',{exact:true}).click();
  let sources: string[]=[];
  for (let index=0;index<post.images.length;index++) {
    const input=page.locator('input[type="file"][multiple][accept*=".png"], input[type="file"][multiple][accept*="image"]');
    if (await input.count()!==1) throw new Error('Cannot identify the image upload control');
    await input.setInputFiles(post.images[index].path);
    try {
      await page.waitForFunction(({selector,count})=>{
        const images=Array.from(document.querySelectorAll<HTMLImageElement>(selector));
        return images.length===count && images.every(img=>img.complete && img.naturalWidth>0);
      },{selector:imageSelector,count:index+1},{timeout});
    } catch { throw new Error(`Image upload did not finish (${index+1}/${post.images.length})`); }
    const current=await imageSources(page);
    if (sources.some((source,i)=>current[i]!==source)) throw new Error('Image order changed during upload');
    sources=current;
  }
  const title=await unique(page.locator(titleSelector),'title');
  const editor=await unique(page.locator(editorSelector),'body');
  await title.fill(post.title);
  await editor.fill('');
  const lines=post.body.replace(/\n+$/,'').split('\n');
  for (let i=0;i<lines.length;i++) {
    if (i) await editor.press('Enter');
    if (lines[i]) await page.keyboard.insertText(lines[i]);
  }
  const declaration=await unique(page.locator('.d-select-content').filter({hasText:/^(添加内容类型声明|笔记含AI合成内容)$/}),'AI declaration');
  const aiLabel='笔记含AI合成内容';
  if (post.aiGenerated && (await declaration.innerText()).trim()!==aiLabel) {
    await declaration.click();
    await (await unique(page.locator('.d-option-name').filter({hasText:aiLabel}),'AI declaration option')).click();
  }
  const visibility=await unique(page.locator('.permission-card-wrapper .d-select-content'),'visibility');
  const visibilityLabel=post.visibility==='private'?'仅自己可见':'公开可见';
  if ((await visibility.innerText()).trim()!==visibilityLabel) {
    await visibility.click();
    await (await unique(page.locator('.custom-option .name').filter({hasText:new RegExp(`^${visibilityLabel}$`)}),'visibility option')).click();
  }
  if (await title.inputValue()!==post.title) throw new Error('Title readback differs from bundle');
  if (canonical(await readBody(editor))!==canonical(post.body)) throw new Error('Body readback differs from bundle (including paragraph breaks)');
  const finalSources=await imageSources(page);
  if (finalSources.length!==post.images.length || finalSources.some((src,i)=>src!==sources[i])) throw new Error('Image order/count readback differs from bundle');
  const aiValue=(await declaration.innerText()).trim();
  if ((post.aiGenerated && aiValue!==aiLabel) || (!post.aiGenerated && aiValue!=='添加内容类型声明')) throw new Error('AI declaration readback differs from bundle');
  if ((await visibility.innerText()).trim()!==visibilityLabel) throw new Error('Visibility readback differs from bundle');
  if (await readAccount(page,timeout)!==expectedAccount.trim()) throw new Error('Creator account changed during preview');
  return {status:'preview_ready',submitted:false,contentId:post.contentId,imageCount:post.images.length,
    images:post.images.map((image,index)=>({index:index+1,filename:image.filename,sha256:image.sha256})),
    titleVerified:true,bodyVerified:true,imageOrderVerified:true,aiGenerated:post.aiGenerated,visibility:post.visibility,accountMatched:true,verifiedAt:new Date().toISOString()};
}

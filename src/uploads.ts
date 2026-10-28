import type { Page, Request } from 'playwright';
// Observe the normal file-input upload; no direct platform publishing API calls.
export async function captureImageUpload(page: Page, action: ()=>Promise<void>, timeout: number): Promise<void> {
  const pending=new Set<Request>();let completed=0;let failure='';let lastChange=Date.now();
  const start=(request: Request)=>{
    const type=request.headers()['content-type']??'';
    const host=new URL(request.url()).hostname;
    const platformUpload=/(^|-)upload(-|\.)/.test(host) && ['rnote.com','rednote.com','xiaohongshu.com','xhscdn.com'].some(domain=>host.endsWith(`.${domain}`));
    if (['POST','PUT'].includes(request.method()) && (/image\/|application\/octet-stream|multipart\/form-data/i.test(type) || (request.method()==='PUT' && platformUpload))) {
      pending.add(request);lastChange=Date.now();
    }
  };
  const finish=async(request: Request)=>{
    if (!pending.has(request)) return;
    const response=await request.response();
    if (!response || response.status()<200 || response.status()>=300) failure=`Image upload failed (HTTP ${response?.status()??'unknown'})`;
    pending.delete(request);completed++;lastChange=Date.now();
  };
  const failed=(request: Request)=>{
    if (pending.has(request)) { pending.delete(request);failure='Image upload request failed'; }
  };
  page.on('request',start);page.on('requestfinished',finish);page.on('requestfailed',failed);
  try {
    await action();const deadline=Date.now()+timeout;
    while (Date.now()<deadline) {
      if (failure) throw new Error(failure);
      if (completed>0 && pending.size===0 && Date.now()-lastChange>=150) return;
      await page.waitForTimeout(50);
    }
    throw new Error('Image upload could not be verified: no completed file upload');
  } finally { page.off('request',start);page.off('requestfinished',finish);page.off('requestfailed',failed); }
}
export async function imageHashes(page: Page, selector: string, timeout: number): Promise<string[]> {
  try {
    return await page.locator(selector).evaluateAll(async(els,milliseconds)=>Promise.all(els.map(async el=>{
      const image=el as HTMLImageElement;const source=image.currentSrc||image.src;
      if (!source.startsWith('blob:') && !source.startsWith('data:')) throw new Error('Local thumbnail bytes unavailable');
      const response=await fetch(source,{signal:AbortSignal.timeout(milliseconds)});
      if (!response.ok) throw new Error('Cannot read local thumbnail');
      const digest=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
      return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    })),timeout);
  } catch { throw new Error('Image bytes cannot be verified from the local thumbnail'); }
}

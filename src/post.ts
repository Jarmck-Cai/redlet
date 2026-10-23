import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
export interface ImageAsset { path: string; filename: string; sha256: string }
export interface PostBundle { contentId: string; title: string; body: string; images: ImageAsset[]; site: 'rednote' | 'xiaohongshu'; aiGenerated: boolean; visibility: 'public' | 'private'; expectedAccount?: string }
const fields = new Set(['schema_version','content_id','title','body','body_file','images','site','ai_generated','visibility','expected_account']);
function fail(message: string): never { throw new Error(message); }
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a nonempty string`);
  return value;
}
function inside(base: string, file: string): boolean { const rel=relative(base,file); return rel!=='' && !rel.startsWith('..') && !isAbsolute(rel); }
async function asset(base: string, value: unknown, max: number): Promise<{path:string;bytes:Buffer}> {
  const name=text(value,'asset');
  if (/^[a-z][a-z0-9+.-]*:/i.test(name) || isAbsolute(name)) fail('asset must be a relative local path');
  const candidate=resolve(base,name);
  if (!inside(base,candidate)) fail('asset must stay inside the bundle directory');
  let path: string;
  try { path=await realpath(candidate); } catch { return fail(`cannot read asset: ${name}`); }
  if (!inside(base,path)) fail('asset must stay inside the bundle directory after symlink resolution');
  const info=await stat(path);
  if (!info.isFile() || info.size===0 || info.size>max) fail(`asset has invalid size or is not a file: ${name}`);
  try { return {path,bytes:await readFile(path)}; } catch { return fail(`cannot read asset: ${name}`); }
}
function utf8(bytes: Buffer, label: string): string {
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { return fail(`${label} must be UTF-8 text`); }
}
export async function loadPost(manifest: string): Promise<PostBundle> {
  const full=await realpath(resolve(manifest)).catch(()=>fail('cannot read manifest'));
  const size=(await stat(full)).size;
  if (size>64*1024) fail('manifest exceeds 64 KiB');
  let raw: any;
  try { raw=JSON.parse(utf8(await readFile(full),'manifest').replace(/^\uFEFF/,'')); } catch { return fail('manifest must be valid UTF-8 JSON'); }
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) fail('manifest must be an object');
  for (const key of Object.keys(raw)) if (!fields.has(key)) fail(`unknown manifest field: ${key}`);
  if (raw.schema_version!==1) fail('schema_version must be 1');
  const contentId=text(raw.content_id,'content_id');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(contentId)) fail('content_id must contain only letters, numbers, _ or -');
  const title=text(raw.title,'title').trim();
  if (Array.from(title).length>20) fail('title exceeds 20 characters');
  if (('body' in raw) === ('body_file' in raw)) fail('provide exactly one of body or body_file');
  const base=await realpath(dirname(full));
  const body=('body' in raw ? text(raw.body,'body') : utf8((await asset(base,raw.body_file,32*1024)).bytes,'body')).replace(/\r\n?/g,'\n');
  if (!body.trim() || Array.from(body).length>1000) fail('body must contain 1–1000 characters');
  if (!Array.isArray(raw.images) || raw.images.length<1 || raw.images.length>18) fail('images must contain 1–18 local images');
  if (raw.site!=='rednote' && raw.site!=='xiaohongshu') fail('site must be rednote or xiaohongshu');
  if (typeof raw.ai_generated!=='boolean') fail('ai_generated must be boolean');
  if (raw.visibility!=='public' && raw.visibility!=='private') fail('visibility must be public or private');
  const expectedAccount=raw.expected_account===undefined ? undefined : text(raw.expected_account,'expected_account').trim();
  const images: ImageAsset[]=[]; const seen=new Set<string>();
  for (const input of raw.images) {
    const {path,bytes}=await asset(base,input,32*1024*1024);
    const key=process.platform==='win32'?path.toLowerCase():path;
    if (seen.has(key)) fail('duplicate image path'); seen.add(key);
    const ext=extname(path).toLowerCase();
    const png=ext==='.png' && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg=['.jpg','.jpeg'].includes(ext) && bytes.subarray(0,3).equals(Buffer.from([255,216,255]));
    const webp=ext==='.webp' && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    if (!png && !jpg && !webp) fail(`unsupported image format: ${basename(path)}`);
    images.push({path,filename:basename(path),sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return {contentId,title,body,images,site:raw.site,aiGenerated:raw.ai_generated,visibility:raw.visibility,expectedAccount};
}

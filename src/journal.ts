import {createHash,randomUUID} from 'node:crypto';
import {access,mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import type {PostBundle} from './post.js';
import type {PublicationResult} from './publish.js';
export type TaskStatus='preparing'|'preview_failed'|'submitting'|'verification_pending'|'submitted_for_review'|'published'|'rejected';
export type ConfirmedStatus='submitted_for_review'|'published'|'rejected';
export interface TaskRecord {
 schemaVersion:1;contentId:string;site:PostBundle['site'];title:string;fingerprint:string;account:string;
 status:TaskStatus;submitted:boolean|null;createdAt:string;updatedAt:string;attemptedAt?:string;submittedAt?:string;verifiedAt?:string;
 noteId?:string;publicUrl?:string;reason?:string;screenshot?:string;lastCheckedAt?:string;
 lastConfirmed?:{status:ConfirmedStatus;verifiedAt:string};
}
const statuses:TaskStatus[]=['preparing','preview_failed','submitting','verification_pending','submitted_for_review','published','rejected'];
const confirmed=(status:string):status is ConfirmedStatus=>['submitted_for_review','published','rejected'].includes(status);
const timestamp=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function location(stateDir:string,site:PostBundle['site'],id:string){
 if(!['rednote','xiaohongshu'].includes(site)||!id.trim())throw new Error('Invalid task identity');
 const folder=join(stateDir,'tasks',site);return {folder,file:join(folder,createHash('sha256').update(id).digest('hex')+'.json')};
}
function fingerprint(post:PostBundle){return createHash('sha256').update(JSON.stringify({title:post.title,body:post.body,images:post.images.map(i=>i.sha256),ai:post.aiGenerated,visibility:post.visibility,site:post.site,...(post.tags.length?{tags:post.tags}:{})})).digest('hex');}
async function durable(file:string,text:string,exclusive=false){const f=await open(file,exclusive?'wx':'w',0o600);try{await f.writeFile(text,'utf-8');await f.sync();}finally{await f.close();}}
export async function lockTask(stateDir:string,site:PostBundle['site'],id:string,existingOnly=false):Promise<()=>Promise<void>>{
 const {folder,file}=location(stateDir,site,id);if(existingOnly)await access(file);await mkdir(folder,{recursive:true});const lock=file+'.lock';
 try{await durable(lock,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}),true);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Error('Task is locked by another running command; inspect the local lock after a crash');throw e;}
 return async()=>{await unlink(lock);};
}
export async function readTask(stateDir:string,site:PostBundle['site'],id:string):Promise<TaskRecord>{
 const {file}=location(stateDir,site,id);const task=JSON.parse(await readFile(file,'utf-8'));
 if(task.schemaVersion!==1||task.site!==site||task.contentId!==id||!statuses.includes(task.status)||typeof task.title!=='string'||typeof task.account!=='string'||!/^[a-f0-9]{64}$/.test(task.fingerprint)||![true,false,null].includes(task.submitted))throw new Error('Invalid task journal; refusing to publish');
 if(task.lastCheckedAt!==undefined&&!timestamp(task.lastCheckedAt))throw new Error('Invalid task journal check timestamp');
 if(task.lastConfirmed!==undefined&&(!task.lastConfirmed||!confirmed(task.lastConfirmed.status)||!timestamp(task.lastConfirmed.verifiedAt)))throw new Error('Invalid task journal confirmation');
 return task;
}
export async function saveTask(stateDir:string,task:TaskRecord):Promise<void>{
 const {folder,file}=location(stateDir,task.site,task.contentId);await mkdir(folder,{recursive:true});task.updatedAt=new Date().toISOString();
 const temporary=file+'.'+randomUUID()+'.tmp';try{await durable(temporary,JSON.stringify(task,null,2)+'\n',true);await rename(temporary,file);}finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export async function beginTask(stateDir:string,post:PostBundle,account:string):Promise<TaskRecord>{
 const {folder,file}=location(stateDir,post.site,post.contentId);await mkdir(folder,{recursive:true});let existing:TaskRecord|undefined;
 try{existing=await readTask(stateDir,post.site,post.contentId);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const hash=fingerprint(post);
 if(existing){
  if(existing.fingerprint!==hash||existing.account!==account)throw new Error('Existing content id has different content or account');
  if(existing.attemptedAt||!['preparing','preview_failed'].includes(existing.status))throw new Error('Submission already attempted; use verify instead of publishing again');
  existing.status='preparing';existing.submitted=false;delete existing.reason;await saveTask(stateDir,existing);return existing;
 }
 const now=new Date().toISOString();const task:TaskRecord={schemaVersion:1,contentId:post.contentId,site:post.site,title:post.title,fingerprint:hash,account,status:'preparing',submitted:false,createdAt:now,updatedAt:now};
 try{await durable(file,JSON.stringify(task,null,2)+'\n',true);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Error('Task already reserved by another publisher');throw e;}return task;
}

export function applyResult(task:TaskRecord,result:PublicationResult){
 // Upgrade a positively confirmed v1 record before a transient query replaces its current status.
 if(!task.lastConfirmed&&confirmed(task.status)&&task.submitted===true&&timestamp(task.verifiedAt))task.lastConfirmed={status:task.status,verifiedAt:task.verifiedAt};
 task.lastCheckedAt=new Date().toISOString();
 task.status=result.status;task.submitted=result.submitted??task.submitted;
 if(result.acknowledgedAt&&!task.submittedAt)task.submittedAt=result.acknowledgedAt;
 if(result.noteId)task.noteId=result.noteId;if(result.publicUrl)task.publicUrl=result.publicUrl;
 if(result.verifiedAt){
  task.verifiedAt=result.verifiedAt;
  if(confirmed(result.status)&&result.submitted===true)task.lastConfirmed={status:result.status,verifiedAt:result.verifiedAt};
 }
 if(result.reason)task.reason=result.reason;else delete task.reason;
}

import type {Locator} from 'playwright';

export interface VerifiedTopic {name:string;id:string}
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{24}$/i.test(id);
const canonical=(text:string)=>text.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ');
const escapeRegex=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export async function verifyBodyTopics(editor:Locator,body:string,names:readonly string[],expected?:readonly VerifiedTopic[]):Promise<VerifiedTopic[]>{
 const snapshot=await editor.evaluate(el=>{
  const roots=Array.from(el.childNodes);
  const topics=Array.from(el.querySelectorAll('.tiptap-topic')).map(node=>{
   let data:any;try{data=JSON.parse(node.getAttribute('data-topic')??'null');}catch{}
   const display=Array.from(node.childNodes).filter(child=>!(child instanceof Element&&child.classList.contains('content-hide'))).map(child=>child.textContent??'').join('');
   return {id:data?.id,name:data?.name,display,native:node.tagName==='A'&&node.getAttribute('contenteditable')==='false',root:roots.findIndex(root=>root.contains(node))};
  });
  let tailResidue='';
  if(roots.length){const walker=document.createTreeWalker(roots[roots.length-1],NodeFilter.SHOW_TEXT);while(walker.nextNode()){if(!walker.currentNode.parentElement?.closest('.tiptap-topic'))tailResidue+=walker.currentNode.textContent??'';}}
  return {lines:roots.map(node=>node.textContent??''),topics,tailResidue};
 });
 if(snapshot.topics.length!==names.length)throw new Error('Topic association count differs from selected tags');
 const topics:VerifiedTopic[]=snapshot.topics.map((topic,index)=>{
  if(!topic.native||!validId(topic.id)||topic.name!==names[index]||canonical(topic.display)!=='#'+names[index])throw new Error(`Topic association/id differs for "${names[index]}"`);
  if(names.length&&topic.root!==snapshot.lines.length-1)throw new Error('Topic association moved into the original body');
  return {name:topic.name,id:topic.id};
 });
 if(new Set(topics.map(topic=>topic.id)).size!==topics.length)throw new Error('Different selected tags share one topic identity');
 if(expected&&(expected.length!==topics.length||topics.some((topic,index)=>topic.name!==expected[index].name||topic.id!==expected[index].id)))throw new Error('Topic identity/order changed after preview');
 const original=names.length?snapshot.lines.slice(0,-1):snapshot.lines;
 if(canonical(original.join('\n'))!==canonical(body))throw new Error('Body readback differs from bundle (including paragraph breaks)');
 if(names.length&&!/^\s*$/.test(snapshot.tailResidue))throw new Error('Unexpected plain text beside selected topic associations');
 return topics;
}

export async function appendTopics(editor:Locator,names:readonly string[],timeout=30000):Promise<VerifiedTopic[]>{
 if(!names.length)return [];
 const page=editor.page(),selected:VerifiedTopic[]=[];
 await editor.press('ControlOrMeta+End');await editor.press('Escape');await editor.press('Enter');
 for(const name of names){
  await editor.pressSequentially('#'+name);
  try{
   await page.waitForFunction(query=>{
    const container=document.querySelector('#creator-editor-topic-container');
    return container?.parentElement?.getAttribute('text')===query&&Array.from(container.querySelectorAll('.item')).some(item=>item.getBoundingClientRect().height>0);
   },'#'+name,{timeout});
   const container=page.locator('#creator-editor-topic-container').filter({visible:true});
   if(await container.count()!==1)throw new Error('Cannot identify the current topic suggestion list');
   const matches=container.locator('.item').filter({has:page.locator('.name').filter({hasText:new RegExp('^'+escapeRegex('#'+name)+'$')})}).filter({visible:true});
   const count=await matches.count();
   if(count!==1)throw new Error(count?'Ambiguous exact topic candidates':'Exact topic candidate not found');
   let candidateId:string|undefined;
   try{const value=JSON.parse(await matches.getAttribute('data-impression')??'null')?.tagTarget?.value?.tagId;if(validId(value))candidateId=value;}catch{}
   await matches.click({timeout});
   await editor.locator('a.tiptap-topic[contenteditable="false"]').nth(selected.length).waitFor({state:'visible',timeout});
   const current=await editor.locator('.tiptap-topic').evaluateAll(nodes=>nodes.map(node=>{try{return JSON.parse(node.getAttribute('data-topic')??'null');}catch{return null;}}));
   if(current.length!==selected.length+1||current.some((topic,index)=>!validId(topic?.id)||topic.name!==names[index]||(index<selected.length?topic.id!==selected[index].id:!!candidateId&&topic.id!==candidateId)))throw new Error('Selected topic identity does not match the candidate');
   selected.push({name:current[selected.length].name,id:current[selected.length].id});
  }catch(error){throw new Error(`Cannot add topic "${name}": ${error instanceof Error?error.message:String(error)}`);}
 }
 return selected;
}

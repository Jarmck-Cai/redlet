import type {Page} from 'playwright';
interface DomNode {nodeName:string;nodeValue:string;backendNodeId:number;attributes?:string[];children?:DomNode[];shadowRoots?:DomNode[]}
const hostSelector='.publish-page-content xhs-publish-btn';
function attributes(node:DomNode){const values=new Map<string,string>();for(let i=0;i<(node.attributes?.length??0);i+=2)values.set(node.attributes![i],node.attributes![i+1]);return values;}
function text(node:DomNode):string{return node.nodeValue+(node.children??[]).map(text).join('');}
async function closedPublishPoint(page:Page):Promise<{x:number;y:number}>{
 const host=page.locator(hostSelector).filter({visible:true});
 if(await host.count()!==1)throw new Error('Cannot identify a unique publish component');
 const enabled=await host.evaluate(el=>el.getAttribute('is-publish')==='true'&&el.getAttribute('submit-text')==='发布'&&el.getAttribute('submit-disabled')==='false'&&el.getAttribute('submit-loading')==='false');
 if(!enabled)throw new Error('Publish component is disabled, loading or unrecognised');
 await host.scrollIntoViewIfNeeded();
 const session=await page.context().newCDPSession(page);
 try{
  // Inspect only this UI component, including its closed shadow root. No page
  // application state, cookies, network bodies or platform API calls are used.
  const doc=await session.send('DOM.getDocument',{depth:0});
  const found=await session.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:hostSelector});
  if(!found.nodeId)throw new Error('Publish component disappeared');
  const {node}=await session.send('DOM.describeNode',{nodeId:found.nodeId,depth:-1,pierce:true});
  const candidates:DomNode[]=[];
  function visit(n:DomNode){if(n.nodeName==='BUTTON'&&text(n).trim()==='发布'&&(attributes(n).get('class')??'').split(/\s+/).includes('bg-red'))candidates.push(n);for(const child of [...(n.children??[]),...(n.shadowRoots??[])])visit(child);}
  visit(node);
  if(candidates.length!==1)throw new Error('Cannot identify the exact inner publish button');
  const button=candidates[0],attrs=attributes(button);
  if(attrs.has('disabled')||attrs.get('aria-disabled')==='true'||attrs.get('aria-busy')==='true')throw new Error('Inner publish button is disabled or busy');
  const {model}=await session.send('DOM.getBoxModel',{backendNodeId:button.backendNodeId});
  const xs=model.border.filter((_,i)=>i%2===0),ys=model.border.filter((_,i)=>i%2===1);
  const point={x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2};
  if(Math.max(...xs)-Math.min(...xs)<=0||Math.max(...ys)-Math.min(...ys)<=0)throw new Error('Publish button has no visible area');
  if(!await host.evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return hit===el||!!hit&&el.contains(hit);},point))throw new Error('Publish button is obscured');
  return point;
 }finally{await session.detach();}
}
export async function finalPublishAction(page:Page,timeout=30000):Promise<()=>Promise<void>>{
 const host=page.locator(hostSelector).filter({visible:true});
 if(await host.count()){
  await closedPublishPoint(page);
  return async()=>{const point=await closedPublishPoint(page);await page.mouse.click(point.x,point.y);};
 }
 const button=page.getByRole('button',{name:'发布',exact:true}).filter({visible:true});
 if(await button.count()!==1||!await button.isEnabled())throw new Error('Cannot identify one enabled final publish button');
 return async()=>{if(await button.count()!==1||!await button.isEnabled())throw new Error('Final publish button changed or is disabled');await button.click({timeout});};
}

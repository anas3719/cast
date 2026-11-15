const {crypto,ORIGIN,REPO}=require('./admin-auth.cjs');
const {readCatalog}=require('./cast-catalog.cjs');
const fail=status=>{throw Object.assign(new Error('Profile publication unavailable'),{status});};
function createProfilePublisher({fetcher=fetch,env=process.env}={}){
  const checked=async r=>{if(!r.ok)fail(r.status===409||r.status===422?409:503);return r.json();};
  async function installation(){
    if(!env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_CLIENT_ID)fail(503);
    const {SignJWT,importPKCS8}=await import('jose');
    const pem=crypto.createPrivateKey(env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g,'\n')).export({type:'pkcs8',format:'pem'});
    const key=await importPKCS8(pem,'RS256');
    const jwt=await new SignJWT({}).setProtectedHeader({alg:'RS256'}).setIssuer(env.GITHUB_CLIENT_ID)
      .setIssuedAt(Math.floor(Date.now()/1000)-30).setExpirationTime('5m').sign(key);
    const call=(path,token,options={})=>fetcher('https://api.github.com'+path,{...options,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'Cast-Profile-Editor','Content-Type':'application/json'}});
    const app=await checked(await call(`${REPO}/installation`,jwt));
    const access=await checked(await call(`/app/installations/${app.id}/access_tokens`,jwt,{method:'POST',body:JSON.stringify({repositories:['cast'],permissions:{contents:'write'}})}));
    return (path,options)=>call(path,access.token,options);
  }
  async function plan(token){
    const r=await fetcher('https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-profile-edit',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Origin:ORIGIN,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{"action":"publish-plan"}'});
    if(!r.ok)fail(r.status===401?401:503);
    const p=await r.json();
    const {normalizeFields}=await import('./profile-edit-handler.mjs');
    if(!/^[A-Za-z0-9_-]{1,120}$/.test(p.profileId||''))fail(400);
    p.fields=normalizeFields(p.fields,p.simple);p.baseline=normalizeFields(p.baseline,p.simple);
    return p;
  }
  async function publish(token){
    const p=await plan(token),gh=await installation();
    for(let attempt=0;attempt<3;attempt++){
      const head=await checked(await gh(`${REPO}/git/ref/heads/main`));
      const parent=await checked(await gh(`${REPO}/git/commits/${head.object.sha}`));
      const get=async path=>{const f=await checked(await gh(`${REPO}/contents/${path}?ref=${head.object.sha}`));return Buffer.from(f.content,'base64').toString('utf8');};
      let path='cast-data.js',source=await get(path),parsed=readCatalog(source),member=parsed.members.find(m=>m.id===p.profileId);
      if(!member){path='photographers-data.js';source=await get(path);parsed=readCatalog(source,'photographers');member=parsed.members.find(m=>m.id===p.profileId);}
      if(!member)fail(409);
      const changes=Object.fromEntries(Object.entries(p.fields).filter(([k,v])=>v!==p.baseline[k]));
      for(const [k,v]of Object.entries(changes))if(String(member[k]||'')!==p.baseline[k]&&String(member[k]||'')!==v)fail(409);
      if(Object.entries(changes).every(([k,v])=>String(member[k]||'')===v))return {commit:head.object.sha};
      Object.assign(member,changes);
      const content=source.slice(0,parsed.start)+JSON.stringify(parsed.members,null,2).replace(/</g,'\\u003c')+source.slice(parsed.end);
      const version=crypto.createHash('sha256').update(content).digest('hex').slice(0,16),updates=[{path,content}];
      const pages=path==='cast-data.js'?['index.html','cast.html','cast-category.html','cast-men.html','cast-women.html','cast-boys.html','cast-girls.html','cast-senior-men.html','cast-senior-women.html']:['photographers.html'];
      for(const page of pages){const html=await get(page);const next=html.replace(new RegExp(path.replace('.','\\.')+'\\?v=[^"\'<>\\s]+','g'),path+'?v='+version);if(html!==next)updates.push({path:page,content:next});}
      const fresh=await plan(token);if(fresh.revision!==p.revision)fail(409);
      const entries=[];
      for(const u of updates){const blob=await checked(await gh(`${REPO}/git/blobs`,{method:'POST',body:JSON.stringify({encoding:'base64',content:Buffer.from(u.content).toString('base64')})}));entries.push({path:u.path,type:'blob',mode:'100644',sha:blob.sha});}
      const tree=await checked(await gh(`${REPO}/git/trees`,{method:'POST',body:JSON.stringify({base_tree:parent.tree.sha,tree:entries})}));
      const commit=await checked(await gh(`${REPO}/git/commits`,{method:'POST',body:JSON.stringify({message:'Update cast profile via private editing link',tree:tree.sha,parents:[head.object.sha]})}));
      const save=await gh(`${REPO}/git/refs/heads/main`,{method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})});
      if([409,422].includes(save.status))continue;await checked(save);return {commit:commit.sha};
    }fail(409);
  }
  return {publish};
}
module.exports={createProfilePublisher};

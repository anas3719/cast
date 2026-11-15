const {common,json,session,seal,unseal,ORIGIN}=require('../lib/admin-auth.cjs');
module.exports=async(req,res)=>{
  if(!common(req,res))return;
  if(req.method!=='POST'||req.headers.origin!==ORIGIN)return json(res,403,{message:'Forbidden'});
  const body=req.body;
  if(!body || Buffer.byteLength(JSON.stringify(body))>8192 || !/^[A-Za-z0-9_-]{1,120}$/.test(body.profileId||''))return json(res,400,{message:'Invalid request'});
  try{
    if(body.action==='wrap'){
      const token=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1];
      if(!token)return json(res,401,{message:'Unauthorized'});
      const proof=await fetch('https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-profile-edit',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
        headers:{Origin:ORIGIN,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{"action":"link-proof"}'});
      if(!proof.ok || (await proof.json()).profileId!==body.profileId)return json(res,401,{message:'Unauthorized'});
      return json(res,200,{encrypted:await seal({token,profileId:body.profileId},'cast-profile-link','36500d')});
    }
    if(body.action!=='unwrap')return json(res,400,{message:'Invalid request'});
    const owner=await session(req);
    if(owner.accessExpires<=Date.now())return json(res,401,{message:'Refresh required'});
    const value=await unseal(body.encrypted,'cast-profile-link');
    if(value.profileId!==body.profileId || !/^[a-f0-9]{64}$/.test(value.token||''))return json(res,403,{message:'Forbidden'});
    return json(res,200,{token:value.token});
  }catch{return json(res,503,{message:'Link service unavailable'});}
};

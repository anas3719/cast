const {common,json,crypto,ORIGIN,REPO}=require('../lib/admin-auth.cjs');
const {readCatalog}=require('../lib/cast-catalog.cjs');
const {createProfilePublisher}=require('../lib/profile-publisher.cjs');
module.exports=async(req,res)=>{
  if(!common(req,res))return;
  if(req.method!=='POST'||req.headers.origin!==ORIGIN)return json(res,403,{message:'Forbidden'});
  const token=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1];
  if(!token)return json(res,401,{message:'الرابط غير صالح.'});
  try {
    const result=await createProfilePublisher().publish(token);
    return json(res,200,result);
  }catch(e){return json(res,e.status||503,{message:e.status===409?'تغيّرت بيانات البروفايل في الإدارة. اطلب رابطًا جديدًا.':'حُفظ التعديل، لكن النشر غير متاح مؤقتًا. حاول مجددًا.'});}
};

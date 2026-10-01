const { common,json }=require('../lib/admin-auth.cjs');
const {createApprovalService}=require('../lib/approval-service.cjs');
const service=createApprovalService();
module.exports=async(req,res)=>{
  if(!common(req,res)) return;
  if(req.method!=='POST') return json(res,405,{code:'conflict'});
  try {
    const body=req.body;
    if(!body || typeof body!=='object' || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body))>32768) return json(res,400,{code:'conflict'});
    const result=['health','allocate','authorize'].includes(body.action)?await service.authorize(req,body):await service.step(body);
    return json(res,200,result);
  } catch(e) {
    const code=['connection','retry','conflict','expired'].includes(e.code)?e.code:'retry';
    return json(res,code==='expired'||code==='connection'?401:503,{code});
  }
};

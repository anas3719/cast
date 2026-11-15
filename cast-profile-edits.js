(function(){
  'use strict';
  const endpoint='https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-profile-edit';
  const labels={name:'الاسم',age:'العمر',height:'الطول',weight:'الوزن',nationality:'الجنسية',speaking:'التحدث',note:'ملاحظة'};
  const pick=(m,simple)=>Object.fromEntries((simple?['name']:Object.keys(labels)).map(k=>[k,String(m[k]||'')]));
  async function request(action,body={},token){
    let response;
    if(token) response=await fetch(endpoint,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({...body,action}),signal:AbortSignal.timeout(action==='submit'?130000:30000)});
    else {
      const login=window.castAdminLogin;
      if(!login || !await login.refresh()) throw new Error('سجّل الدخول بحساب GitHub أولًا.');
      response=await login.profileEdits(action,body);
    }
    const data=await response.json();
    if(!response.ok) throw new Error(data.message || 'تعذر إتمام الطلب.');
    return data;
  }
  const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
  const iconButton=(text,icon,handler)=>{const b=make('button',null,'button button-secondary');b.type='button';const i=make('i');i.dataset.lucide=icon;b.append(i,make('span',text));b.onclick=handler;return b;};
  function icons(){window.lucide?.createIcons();}
  if(document.body.classList.contains('profile-edit-page')){
    const status=document.querySelector('#edit-status'),form=document.querySelector('#edit-fields');
    const token=location.hash.slice(1);
    history.replaceState(null,'',location.pathname);
    if(!/^[a-f0-9]{64}$/.test(token)){status.textContent='الرابط غير صالح أو انتهت صلاحيته.';return;}
    const show=async()=>{
      try{
        const data=await request('load',{},token);
        form.replaceChildren();
        const grid=make('div',null,'registration-grid');
        for(const key of Object.keys(labels)){
          if(!Object.hasOwn(data.fields,key))continue;
          const value=data.fields[key];
          const label=make('label',null,'field'+(['name','note'].includes(key)?' registration-wide':''));label.append(make('span',labels[key]));
          const input=make(key==='speaking'?'select':key==='note'?'textarea':'input');input.name=key;
          if(key==='speaking')for(const v of ['','متحدث','متحدثة','غير متحدث','غير متحدثة']){const o=make('option',v||'يضاف لاحقًا');o.value=v;input.append(o);}
          else {input.maxLength=key==='note'?1000:120;if(['age','height','weight'].includes(key))input.inputMode='decimal';}
          input.value=value;if(key==='name')input.required=true;label.append(input);grid.append(label);
        }
        const save=make('button',null,'button button-primary');save.type='submit';const i=make('i');i.dataset.lucide='save';save.append(i,make('span','حفظ التعديلات'));form.append(grid,save);form.hidden=false;
        status.textContent=data.pending?'يوجد تعديل لم يكتمل نشره. اضغط حفظ للمحاولة مجددًا.':'تعديل البيانات';icons();
        form.onsubmit=async e=>{e.preventDefault();save.disabled=true;status.textContent='جاري الحفظ';try{
          await request('submit',{fields:Object.fromEntries(new FormData(form))},token);
          status.textContent='تم حفظ التعديلات وبدأ نشرها على الموقع. قد يستغرق ظهورها دقيقة.';
        }catch(error){status.textContent=error.message;}finally{save.disabled=false;}};
      }catch(error){status.textContent=error.message;}
    };show();return;
  }
  const toolbar=document.querySelector('.form-actions');
  if(!toolbar)return;
  const dialog=make('dialog',null,'admin-dialog profile-edits-dialog');dialog.setAttribute('aria-label','روابط وتعديلات البروفايلات');
  const head=make('div',null,'dialog-heading');head.append(make('h2','تعديلات الكاست'));const close=iconButton('إغلاق','x',()=>dialog.close());head.append(close);dialog.append(head);
  const status=make('p');status.setAttribute('role','status');const content=make('div');dialog.append(status,content);document.body.append(dialog);
  const run=async fn=>{try{await fn();}catch(e){status.textContent=e.message;}};
  const open=()=>{content.replaceChildren();status.textContent='';dialog.showModal();icons();};
  const create=iconButton('رابط تعديل البيانات','link',()=>run(async()=>{
    const selected=window.castProfileEditBridge.selected();if(!selected)return;open();status.textContent='جاري تجهيز الرابط';
    let currentUrl='';
    const input=make('input');input.readOnly=true;input.dir='ltr';input.style.width='100%';input.setAttribute('aria-label','رابط تعديل البيانات');
    const copy=iconButton('نسخ الرابط','copy',async()=>{try{await navigator.clipboard.writeText(currentUrl);status.textContent='تم نسخ الرابط';}catch{input.select();status.textContent='حدد الرابط وانسخه';}});copy.disabled=true;
    const rotate=iconButton('تغيير الرابط','refresh-cw',()=>{if(window.confirm('سيتم إلغاء الرابط القديم واستبداله برابط جديد. هل تريد المتابعة؟'))run(()=>getLink(true));});
    const revoke=iconButton('إلغاء الرابط','unlink',()=>run(async()=>{await request('revoke',{profileId:selected.member.id});input.value='';currentUrl='';copy.disabled=true;status.textContent='تم إلغاء الرابط.';}));
    async function getLink(shouldRotate=false){
      rotate.disabled=true;copy.disabled=true;status.textContent='جاري تجهيز الرابط';
      try{
        const data=await request('create',{profileId:selected.member.id,simple:selected.simple,fields:pick(selected.member,selected.simple),rotate:shouldRotate});
        currentUrl=data.url || '';input.value=currentUrl;copy.disabled=!currentUrl;
        status.textContent=data.revoked?'الرابط ملغى.':'رابط ثابت · فعّال';
      }finally{rotate.disabled=false;}
    }
    content.append(make('h3',selected.member.name),input,copy);
    content.append(rotate,revoke);icons();await getLink();
  }));
  create.hidden=true;toolbar.prepend(create);
  window.addEventListener('cast:profile-selected',e=>{create.hidden=!e.detail.id;});
  icons();
})();

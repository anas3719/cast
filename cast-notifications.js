(function(){
  'use strict';
  const button=document.createElement('button');button.type='button';button.className='icon-button notification-button';
  button.title='طلبات التسجيل الجديدة';button.setAttribute('aria-label','طلبات التسجيل الجديدة');
  const icon=document.createElement('i');icon.dataset.lucide='bell';icon.setAttribute('aria-hidden','true');
  const badge=document.createElement('span');badge.className='notification-count';badge.hidden=true;badge.setAttribute('aria-live','polite');
  button.append(icon,badge);document.querySelector('.header-actions')?.prepend(button);window.lucide?.createIcons();
  button.onclick=()=>document.querySelector('#review-registrations')?.click();
  let busy=false,timer;
  async function refresh(){
    clearTimeout(timer);
    if(busy || document.hidden){timer=setTimeout(refresh,30000);return;}
    if(!window.castAdminLogin?.connected){button.title='سجّل الدخول لعرض إشعارات التسجيل';timer=setTimeout(refresh,30000);return;}
    busy=true;
    try{
      const response=await window.castAdminLogin.registrations('count');
      if(!response.ok)throw new Error('unavailable');
      const {count}=await response.json();if(!Number.isSafeInteger(count)||count<0)throw new Error('invalid');
      badge.textContent=count>99?'99+':String(count);badge.hidden=count===0;
      button.title=`${count} طلب تسجيل جديد`;button.setAttribute('aria-label',button.title);
    }catch{button.title='تعذر تحديث الإشعارات مؤقتًا';}
    finally{busy=false;timer=setTimeout(refresh,30000);}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  document.querySelector('#registrations-dialog')?.addEventListener('close',refresh);
  refresh();
})();

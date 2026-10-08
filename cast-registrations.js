(function () {
  'use strict';
  const dialog = document.querySelector('#registrations-dialog');
  const list = document.querySelector('#registration-review-list');
  const editor = document.querySelector('#registration-review-editor');
  const status = document.querySelector('#registrations-status');
  const signIn = document.querySelector('#registrations-login');
  const login = window.castAdminLogin;
  const rules = window.castRegistrationRules;
  const statuses = { pending: 'بانتظار المراجعة', approving: 'جاري الاعتماد', approved: 'معتمد', rejected: 'مرفوض' };
  let record, epoch = 0, dirty = false, writing = false, uncertain = false;
  let pipelineReady=false,refreshTimer;
  let reviewMode = 'requests';
  function canApprove(value) {
    return pipelineReady && ['pending','approved','approving'].includes(value.status)
      && (value.status!=='approving' || ['needs_grant','needs_owner'].includes(value.approval?.status))
      && rules.reviewReadiness({...value,status:value.status==='approving'?'pending':value.status}).valid;
  }
  const driveButton = document.createElement('button');
  driveButton.type = 'button'; driveButton.className = 'button button-secondary';
  driveButton.textContent = 'ربط الدرايف';
  const officialButton = document.createElement('button');
  officialButton.type = 'button'; officialButton.className = 'button button-secondary'; officialButton.hidden = true;
  const folderIcon = document.createElement('i'); folderIcon.dataset.lucide = 'folder-symlink'; folderIcon.setAttribute('aria-hidden','true');
  const officialLabel = document.createElement('span'); officialLabel.textContent = 'ربط المجلدات الأساسية';
  officialButton.append(folderIcon,officialLabel);
  let officialConfigured = false, migrating = false;
  const driveStatus = document.createElement('p');
  driveStatus.setAttribute('role', 'status');
  signIn.after(driveButton, driveStatus);
  driveButton.after(officialButton);
  async function syncApprovedFolders() {
    if (migrating) return;
    migrating = true; officialButton.disabled = true;
    driveStatus.textContent = 'جاري ترتيب الملفات المعتمدة في المجلدات الأساسية';
    try {
      let offset = 0, total = 0;
      do {
        const result = await request('drive-migrate',{offset});
        total += result.migrated; offset = result.nextOffset;
      } while (offset !== null);
      driveStatus.textContent = 'الحفظ في مجلدات الكاست الأساسية · تم التحقق من '+total+' ملف معتمد';
    } catch (error) { driveStatus.textContent = 'الحفظ في المجلدات الأساسية مفعّل، لكن لم تكتمل مزامنة الملفات السابقة. '+error.message; }
    finally { migrating = false; officialButton.disabled = false; }
  }
  const driveFragment = new URLSearchParams(location.hash.slice(1));
  let driveReturn = driveFragment.get('cast-drive');
  const driveFailure = driveFragment.get('cast-drive-reason');
  if (driveReturn) history.replaceState(null, '', location.pathname + location.search);
  function leave() {
    if (writing) { status.textContent = 'انتظر حتى تكتمل عملية الحفظ.'; return false; }
    if (uncertain) { status.textContent = 'لم يتأكد الحفظ. أعد تحميل نفس الطلب للتحقق من البيانات قبل أي تعديل جديد.'; return false; }
    return !dirty || confirm('يوجد تعديل لم يُحفظ. تجاهله؟');
  }
  async function checkDrive() {
    try {
      const state = await request('drive-status');
      pipelineReady=state.connected && state.approvalReady
        && (!state.officialFoldersConfigured || state.officialFoldersReady);
      officialConfigured = state.officialFoldersConfigured === true;
      officialButton.hidden = !state.connected;
      officialLabel.textContent = officialConfigured ? 'مزامنة الملفات المعتمدة' : 'ربط المجلدات الأساسية';
      window.lucide?.createIcons();
      const approve=document.querySelector('#registration-approve');
      if(approve && record && !writing && !uncertain)approve.disabled=!canApprove(record);
      driveStatus.textContent = state.connected
        ? (state.officialFoldersConfigured ? 'الحفظ في مجلدات الكاست الأساسية' : 'الحفظ الحالي في مجلد التسجيلات المستقل')
          + (state.officialFoldersReady && !officialConfigured ? ' · المجلدات الأساسية متاحة للربط' : '')
        : 'لم يُربط الدرايف بعد';
      if (driveReturn === 'failed' && officialConfigured && state.officialFoldersReady) {
        driveStatus.textContent = 'الربط بالمجلدات الأساسية محفوظ وفعّال. لم يتأكد رد آخر محاولة الربط.';
      } else if (driveReturn === 'failed') {
        driveStatus.textContent = ['expired', 'expired-or-missing'].includes(driveFailure)
          ? 'انتهت جلسة الربط أو لم تصل إلى الخدمة. اضغط ربط الدرايف وأكمل الموافقة خلال 10 دقائق في نفس تبويب Chrome.'
          : driveFailure === 'folders' ? 'لم تُحدد المجلدات الأساسية السبعة. لم يتغير مسار الحفظ.'
          : driveFailure === 'denied' ? 'لم تُمنح صلاحية الدرايف. لم يُفعّل النشر.'
            : 'لم يكتمل الربط المحدود. لم يُفعّل النشر.';
      }
      else if (driveReturn === 'connected' && !state.connected) driveStatus.textContent = 'لم يتم تأكيد حفظ الربط بعد.';
      driveButton.textContent = state.connected ? 'إعادة ربط الدرايف' : 'ربط الدرايف';
      if (['connected','failed'].includes(driveReturn) && officialConfigured && state.officialFoldersReady) await syncApprovedFolders();
      driveReturn = null;
    } catch (error) { driveStatus.textContent = error.message; }
  }
  driveButton.addEventListener('click', async () => {
    if (!leave()) return;
    try { await login.connectDrive(); }
    catch (error) { driveStatus.textContent = error.message; }
  });
  officialButton.addEventListener('click', async () => {
    if (!leave()) return;
    if (officialConfigured) return syncApprovedFolders();
    dirty = false;
    try { await login.connectDrive(true); }
    catch (error) { driveStatus.textContent = error.message; }
  });
  const make = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function confirmApproval(name) {
    return new Promise(resolve=>{
      const prompt=make('dialog',undefined,'admin-dialog registration-approval-confirm');
      prompt.setAttribute('aria-labelledby','approval-confirm-title');
      const title=make('h2','اعتماد البروفايل');title.id='approval-confirm-title';
      prompt.append(title,make('p','نشر '+name+' وصورته وأعماله. رقم الواتساب يبقى خاصًا بالإدارة.'));
      const actions=make('div',undefined,'registration-actions');
      const approve=make('button','اعتماد ونشر الآن','button button-primary');approve.type='button';
      const cancel=make('button','إلغاء','button button-secondary');cancel.type='button';
      let settled=false;
      const done=value=>{if(settled)return;settled=true;prompt.close();prompt.remove();resolve(value);};
      approve.addEventListener('click',()=>done(true));cancel.addEventListener('click',()=>done(false));
      prompt.addEventListener('cancel',event=>{event.preventDefault();done(false);});
      actions.append(approve,cancel);prompt.append(actions);document.body.append(prompt);prompt.showModal();
    });
  }
  async function request(action, body = {}) {
    if (!login?.connected) {
      signIn.hidden = false;
      throw new Error('سجّل الدخول بحساب GitHub لعرض الطلبات الخاصة.');
    }
    const response = await login.registrations(action, body);
    const data = await response.json();
    if (response.status === 401) signIn.hidden = false;
    if (!response.ok) throw new Error(data.message || 'تعذر تحميل الطلبات.');
    return data;
  }
  function inputField(parent, key, title, value, options) {
    const label = make('label', undefined, 'field');
    label.append(make('span', title));
    const input = make(options ? 'select' : 'input');
    input.name = key;
    if (options) for (const [id, name] of options) {
      const option = make('option', name); option.value = id; input.append(option);
    }
    input.value = String(value ?? '');
    if (key === 'whatsapp') { input.type = 'tel'; input.dir = 'ltr'; }
    if (['age', 'height', 'weight', 'reviewedCount'].includes(key)) input.inputMode = 'decimal';
    label.append(input); parent.append(label);
    return input;
  }
  function queueRefresh(value) {
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(async()=>{
      if(!dialog.open || writing || uncertain || dirty || record?.id!==value.id)return;
      try {
        const current=(await request('detail',{id:value.id})).record;
        if(!dialog.open || record?.id!==value.id || writing || uncertain || dirty)return;
        const actionable=item=>['needs_owner','needs_grant'].includes(item.approval?.status)?item.approval.status:null;
        if(current.status!==value.status || current.revision!==value.revision
          || current.approval?.phase!==value.approval?.phase || actionable(current)!==actionable(value))render(current);
        else queueRefresh(value);
      } catch {
        status.textContent='تعذر تحديث حالة النشر مؤقتًا. ستتم إعادة المحاولة.';
        queueRefresh(value);
      }
    },8000);
  }
  function render(value) {
    clearTimeout(refreshTimer);
    if (value.status === 'approved' && reviewMode === 'requests') {
      list.querySelector('button[data-id="'+value.id+'"]')?.remove();
      editor.replaceChildren();
      record = null; dirty = false; uncertain = false;
      status.textContent = 'تم الاعتماد والنشر. البروفايل موجود في القائمة الأساسية للتعديل.';
      return;
    }
    record = value;
    dirty = false; uncertain = false;
    editor.replaceChildren();
    list.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === value.id)));
    const selected=list.querySelector('button[data-id="'+value.id+'"]');
    if(selected) {
      selected.querySelector('strong').textContent=value.profile.name;
      selected.querySelector('small').textContent=(rules.categories[value.profile.category]||'')+' · '+statuses[value.status];
    }
    const form = make('form', undefined, 'registration-review-form');
    form.noValidate = true;
    form.append(make('h3', value.profile.name), make('p', statuses[value.status] || value.status));
    if(value.status==='approving') {
      const phases=['تجهيز مجلد الدرايف','نقل الأعمال','تجهيز روابط الأعمال','نشر البروفايل','بانتظار ظهور البروفايل على الموقع'];
      form.append(make('p',value.approval?.status==='needs_owner'?'يلزم استكمال النشر من حساب الإدارة':phases[value.approval?.phase||0]));
    }
    const grid = make('div', undefined, 'registration-grid');
    inputField(grid, 'name', 'الاسم', value.profile.name);
    inputField(grid, 'gender', 'الجنس', value.profile.gender, [['male', 'ذكر'], ['female', 'أنثى']]);
    inputField(grid, 'age', 'العمر', value.profile.age);
    inputField(grid, 'height', 'الطول', value.profile.height);
    inputField(grid, 'weight', 'الوزن', value.profile.weight);
    inputField(grid, 'nationality', 'الجنسية (اختياري)', value.profile.nationality);
    inputField(grid, 'speaking', 'التحدث', value.profile.speaking, [['yes', 'متحدث / متحدثة'], ['no', 'غير متحدث / غير متحدثة']]);
    const privateLabel = make('div', undefined, 'registration-wide registration-private-label');
    inputField(privateLabel, 'whatsapp', 'رقم الواتساب: خاص بالإدارة', value.privateContact.whatsapp);
    grid.append(privateLabel); form.append(grid);
    if (value.works.mode === 'drive') {
      const anchor = make('a', 'فتح مجلد الأعمال');
      anchor.href = rules.driveFolder(value.works.folderUrl);
      anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      form.append(anchor);
      const checks = make('div', undefined, 'registration-grid');
      inputField(checks, 'reviewedCount', 'عدد الأعمال التي راجعتها (2–10)', value.works.reviewedCount);
      const label = make('label', undefined, 'registration-options');
      const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.name = 'accessible'; checkbox.checked = value.works.accessible;
      label.append(checkbox, make('span', 'المجلد متاح للعملاء وراجعت محتواه')); checks.append(label); form.append(checks);
    }
    const media = make('div', undefined, 'registration-review-media');
    for (const file of value.attachments) {
      if (!file.url) continue;
      const link = make('a'); link.href = file.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (file.type.startsWith('image/')) {
        const image = make('img'); image.src = file.url; image.alt = file.role === 'portrait' ? 'صورة البروفايل' : file.name;
        image.referrerPolicy = 'no-referrer'; link.append(image);
      } else {
        const video = make('video'); video.src = file.url; video.controls = true; video.preload = 'none'; media.append(video);
      }
      link.append(make('span', file.role === 'portrait' ? 'صورة البروفايل' : file.name)); media.append(link);
    }
    form.append(media);
    const note = make('label', undefined, 'field'); note.append(make('span', 'ملاحظة خاصة'));
    const textarea = make('textarea'); textarea.name = 'ownerNote'; textarea.maxLength = 4000; textarea.value = value.ownerNote || '';
    note.append(textarea); form.append(note);
    const message = make('p', '', 'registration-error'); message.setAttribute('role', 'alert'); form.append(message);
    const actions = make('div', undefined, 'registration-actions');
    const save = make('button', undefined, 'button button-primary'); save.type = 'submit';
    const icon = make('i'); icon.dataset.lucide = 'save'; icon.setAttribute('aria-hidden', 'true'); save.append(icon, make('span', 'حفظ البيانات'));
    const approve = make('button', value.status==='approving'?'استكمال النشر':'اعتماد ونشر', 'button button-secondary');
    approve.id='registration-approve';approve.type = 'button'; approve.disabled = !canApprove(value);
    approve.hidden = value.status === 'approved';
    approve.title = pipelineReady?'اعتماد البيانات والأعمال ونشر البروفايل':'النشر قيد التجهيز';
    const reject = make('button', 'رفض الطلب', 'button button-danger'); reject.type = 'button'; reject.disabled = value.status !== 'pending';
    reject.hidden = reviewMode === 'profile';
    save.disabled = !['pending', 'approved'].includes(value.status);
    actions.append(save, approve, reject); form.append(actions); editor.append(form);
    if(value.status==='approving') {
      form.querySelectorAll('input,select,textarea').forEach(input=>{input.disabled=true;});
      queueRefresh(value);
    }
    window.lucide?.createIcons();
    let saving = false;
    form.addEventListener('input', () => { dirty = true;approve.disabled=true; });
    form.addEventListener('change', () => { dirty = true;approve.disabled=true; });
    approve.addEventListener('click',async()=>{
      if(writing || uncertain || dirty || !canApprove(value))return;
      if(!await confirmApproval(value.profile.name))return;
      writing=true;save.disabled=true;approve.disabled=true;reject.disabled=true;
      try {
        await request('approve',{id:value.id,revision:value.revision});
        const current=await request('detail',{id:value.id});render(current.record);
        status.textContent='بدأ الاعتماد في الخلفية.';
      } catch(error) {
        uncertain=true;message.textContent=error.message+' تحقق من حالة الطلب قبل إعادة المحاولة.';
        const verify=make('button','التحقق من الطلب','button button-secondary');verify.type='button';
        verify.addEventListener('click',async()=>{verify.disabled=true;
          try{const current=await request('detail',{id:value.id});render(current.record);}
          catch(failure){message.textContent=failure.message;verify.disabled=false;}});actions.append(verify);
      } finally {writing=false;}
    });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving || uncertain) return;
      const fields = Object.fromEntries(new FormData(form));
      const validated = rules.validate({ ...fields, worksMode: value.works.mode, folderUrl: value.works.folderUrl });
      if (!validated.valid) { message.textContent = Object.values(validated.errors).join('؛ '); return; }
      fields.reviewedCount = fields.reviewedCount ? Number(rules.normalizeDigits(fields.reviewedCount)) : null;
      fields.accessible = fields.accessible === 'on';
      saving = true; writing = true; save.disabled = true; reject.disabled = true; message.textContent = '';
      try {
        const data = await request('edit', { id: value.id, revision: value.revision, fields });
        render(data.record); status.textContent = 'حُفظت البيانات الخاصة. لم تُنشر بيانات التواصل.';
      } catch (error) {
        uncertain = true;
        message.textContent = error.message + ' لم يتأكد الحفظ؛ تحقق من نفس الطلب قبل إعادة المحاولة.';
        status.textContent = message.textContent;
        const verify = make('button', 'التحقق من الطلب', 'button button-secondary'); verify.type = 'button';
        verify.addEventListener('click', async () => {
          verify.disabled = true;
          try { const current = await request('detail', { id: value.id }); render(current.record);
            status.textContent = 'هذه آخر بيانات محفوظة؛ راجعها قبل التعديل.'; }
          catch (failure) { status.textContent = failure.message; verify.disabled = false; }
        }); actions.append(verify);
      }
      finally { saving = false; writing = false; save.disabled = uncertain; reject.disabled = uncertain || value.status !== 'pending'; }
    });
    reject.addEventListener('click', async () => {
      if (!confirm('رفض طلب ' + value.profile.name + ' بدون نشره؟')) return;
      writing = true; reject.disabled = true;
      try { await request('reject', { id: value.id, revision: value.revision }); await load(); }
      catch (error) { message.textContent = error.message; reject.disabled = false; }
      finally { writing = false; }
    });
  }
  async function load() {
    const current = ++epoch;
    status.textContent = 'جاري تحميل الطلبات الخاصة';
    dirty = false; uncertain = false;
    list.replaceChildren(); editor.replaceChildren(); signIn.hidden = true;
    try {
      const data = await request('list'); if (current !== epoch || !dialog.open) return;
      const records = data.records.filter(item => item.status !== 'approved');
      status.textContent = records.length ? 'اختر طلبًا للمراجعة' : 'لا توجد طلبات تسجيل للمراجعة';
      for (const item of records) {
        const button = make('button'); button.type = 'button'; button.dataset.id = item.id;
        button.setAttribute('aria-pressed', 'false');
        button.append(make('strong', item.name), make('small', (rules.categories[item.category] || '') + ' · ' + statuses[item.status]));
        button.addEventListener('click', async () => {
          if (!leave()) return;
          const selected = ++epoch; status.textContent = 'جاري تحميل الطلب';
          try {
            const result = await request('detail', { id: item.id });
            if (selected !== epoch || !dialog.open) return;
            render(result.record); status.textContent = result.record.status==='approved'
              ? 'البروفايل منشور. بيانات التواصل والملاحظات خاصة بالإدارة.'
              : result.record.status==='approving' ? 'النشر جارٍ في الخلفية.' : 'الطلب خاص بالإدارة حتى الاعتماد';
          } catch (error) { if (selected === epoch) status.textContent = error.message; }
        }); list.append(button);
      }
    } catch (error) { if (current === epoch) status.textContent = error.message; }
  }
  document.querySelector('#review-registrations').addEventListener('click', () => {
    reviewMode = 'requests';document.querySelector('#registrations-title').textContent = 'طلبات التسجيل';
    dialog.showModal(); load(); checkDrive();
  });
  window.addEventListener('cast:registration-profile', async event => {
    const profileId = event.detail?.profileId;
    if (!/^registration-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(profileId || '') || !leave()) return;
    reviewMode = 'profile';document.querySelector('#registrations-title').textContent = 'بيانات التسجيل الخاصة';
    const current = ++epoch;list.replaceChildren();editor.replaceChildren();dialog.showModal();
    status.textContent = 'جاري تحميل بيانات التسجيل الخاصة';
    checkDrive();
    try {
      const data = await request('detail', { id: profileId.slice('registration-'.length) });
      if (current !== epoch || !dialog.open) return;
      if (data.record.profileId !== profileId) throw new Error('بيانات التسجيل لا تتطابق مع البروفايل.');
      render(data.record);status.textContent = 'رقم الواتساب والملاحظات محفوظة للإدارة فقط.';
    } catch (error) { if (current === epoch) status.textContent = error.message; }
  });
  document.querySelector('#close-registrations').addEventListener('click', () => { if (leave()) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (!leave()) event.preventDefault(); });
  window.addEventListener('beforeunload', event => {
    if (dirty || writing || uncertain) { event.preventDefault(); event.returnValue = ''; }
  });
  dialog.addEventListener('close', () => { clearTimeout(refreshTimer);++epoch; record = null; editor.replaceChildren(); list.replaceChildren(); });
  signIn.addEventListener('click', () => login.start());
  if (driveReturn) { dialog.showModal(); load(); checkDrive(); }
})();

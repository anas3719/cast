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
  const driveButton = document.createElement('button');
  driveButton.type = 'button'; driveButton.className = 'button button-secondary';
  driveButton.textContent = 'ربط الدرايف';
  const driveStatus = document.createElement('p');
  driveStatus.setAttribute('role', 'status');
  signIn.after(driveButton, driveStatus);
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
      driveStatus.textContent = state.connected ? 'ربط الدرايف محفوظ في الخدمة الخلفية' : 'لم يُربط الدرايف بعد';
      if (driveReturn === 'failed') {
        driveStatus.textContent = ['expired', 'expired-or-missing'].includes(driveFailure)
          ? 'انتهت جلسة الربط أو لم تصل إلى الخدمة. اضغط ربط الدرايف وأكمل الموافقة خلال 10 دقائق في نفس تبويب Chrome.'
          : driveFailure === 'denied' ? 'لم تُمنح صلاحية الدرايف. لم يُفعّل النشر.'
            : 'لم يكتمل الربط المحدود. لم يُفعّل النشر.';
      }
      else if (driveReturn === 'connected' && !state.connected) driveStatus.textContent = 'لم يتم تأكيد حفظ الربط بعد.';
      driveButton.textContent = state.connected ? 'إعادة ربط الدرايف' : 'ربط الدرايف';
      driveReturn = null;
    } catch (error) { driveStatus.textContent = error.message; }
  }
  driveButton.addEventListener('click', async () => {
    if (!leave()) return;
    try { await login.connectDrive(); }
    catch (error) { driveStatus.textContent = error.message; }
  });
  const make = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
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
  function render(value) {
    record = value;
    dirty = false; uncertain = false;
    editor.replaceChildren();
    list.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === value.id)));
    const form = make('form', undefined, 'registration-review-form');
    form.noValidate = true;
    form.append(make('h3', value.profile.name), make('p', statuses[value.status] || value.status));
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
        const video = make('video'); video.src = file.url; video.controls = true; video.preload = 'metadata'; media.append(video);
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
    const approve = make('button', 'اعتماد ونشر', 'button button-secondary'); approve.type = 'button'; approve.disabled = true;
    approve.title = 'يُفعّل بعد اكتمال ربط الدرايف والنشر';
    const reject = make('button', 'رفض الطلب', 'button button-danger'); reject.type = 'button'; reject.disabled = value.status !== 'pending';
    save.disabled = !['pending', 'approved'].includes(value.status);
    actions.append(save, approve, reject); form.append(actions); editor.append(form);
    window.lucide?.createIcons();
    let saving = false;
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('change', () => { dirty = true; });
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
      status.textContent = data.records.length ? 'اختر طلبًا للمراجعة' : 'لا توجد طلبات تسجيل حتى الآن';
      for (const item of data.records) {
        const button = make('button'); button.type = 'button'; button.dataset.id = item.id;
        button.setAttribute('aria-pressed', 'false');
        button.append(make('strong', item.name), make('small', (rules.categories[item.category] || '') + ' · ' + statuses[item.status]));
        button.addEventListener('click', async () => {
          if (!leave()) return;
          const selected = ++epoch; status.textContent = 'جاري تحميل الطلب';
          try {
            const result = await request('detail', { id: item.id });
            if (selected !== epoch || !dialog.open) return;
            render(result.record); status.textContent = 'الطلب خاص بالإدارة حتى الاعتماد';
          } catch (error) { if (selected === epoch) status.textContent = error.message; }
        }); list.append(button);
      }
    } catch (error) { if (current === epoch) status.textContent = error.message; }
  }
  document.querySelector('#review-registrations').addEventListener('click', () => { dialog.showModal(); load(); checkDrive(); });
  document.querySelector('#close-registrations').addEventListener('click', () => { if (leave()) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (!leave()) event.preventDefault(); });
  window.addEventListener('beforeunload', event => {
    if (dirty || writing || uncertain) { event.preventDefault(); event.returnValue = ''; }
  });
  dialog.addEventListener('close', () => { ++epoch; record = null; editor.replaceChildren(); list.replaceChildren(); });
  signIn.addEventListener('click', () => login.start());
  if (driveReturn) { dialog.showModal(); load(); checkDrive(); }
})();

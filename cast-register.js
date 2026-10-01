(function () {
  'use strict';
  const api = 'https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-registration';
  const rules = window.castRegistrationRules;
  const form = document.querySelector('#registration-form');
  const submit = document.querySelector('#submit-registration');
  const notice = document.querySelector('#registration-notice');
  const errorBox = document.querySelector('#submission-error');
  const portrait = document.querySelector('#portrait-file');
  const works = document.querySelector('#works-files');
  const cancel = document.querySelector('#cancel-upload');
  const progress = document.querySelector('#upload-progress');
  let open = false, busy = false, stopped = false, attempt, activeUpload, previewUrl, challenge = '', widget;
  const mimeByExtension = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

  async function request(action, body = {}, ticket = '') {
    const response = await fetch(api, { method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(ticket ? { Authorization: 'Bearer ' + ticket } : {}) },
      body: JSON.stringify({ ...body, action }),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.message || 'تعذر الاتصال. حاول مرة أخرى.'), { errors: data.errors });
    return data;
  }

  function fields() {
    const data = new FormData(form);
    // Challenge tokens rotate independently of the applicant's retry identity.
    return Object.fromEntries(['name', 'gender', 'age', 'height', 'weight', 'nationality',
      'speaking', 'whatsapp', 'worksMode', 'folderUrl'].map(key => [key, data.get(key) || '']));
  }
  function selection() {
    const data = fields();
    const chosen = [portrait.files[0], ...(data.worksMode === 'upload' ? [...works.files] : [])].filter(Boolean);
    return { data, chosen, manifest: chosen.map((file, index) => ({ name: file.name, size: file.size,
      type: file.type || mimeByExtension[file.name.split('.').pop().toLowerCase()] || '',
      role: index === 0 && portrait.files[0] ? 'portrait' : 'work' })) };
  }
  function showErrors(errors = {}) {
    document.querySelectorAll('.registration-error').forEach(element => { element.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(element => element.removeAttribute('aria-invalid'));
    for (const [key, message] of Object.entries(errors)) {
      const element = document.getElementById('error-' + key);
      if (element) element.textContent = message;
      else errorBox.textContent += (errorBox.textContent ? '؛ ' : '') + message;
      form.elements.namedItem(key)?.setAttribute?.('aria-invalid', 'true');
    }
  }
  function setBusy(value) {
    busy = value;
    // Keep selected files and values intact when a retryable upload fails.
    for (const input of form.querySelectorAll('input,button')) input.disabled = value;
    submit.disabled = value || !open;
    cancel.disabled = false;
    cancel.hidden = !value;
    document.querySelector('.registration-progress').hidden = !value;
    submit.querySelector('span').textContent = value ? 'جاري إرسال الطلب' : 'إرسال الطلب';
  }
  function receipt(data) {
    form.hidden = true;
    notice.hidden = true;
    document.querySelector('#receipt-number').textContent = data.id;
    const section = document.querySelector('#registration-receipt');
    section.hidden = false;
    section.focus();
    attempt = null;
  }
  function resetChallenge() {
    challenge = '';
    if (widget !== undefined && window.turnstile) window.turnstile.reset(widget);
  }
  function uploadFile(file, signed, config, doneBytes, totalBytes) {
    return new Promise((resolve, reject) => {
      if (stopped) return reject(new Error('توقف الرفع. يمكنك إعادة المحاولة بدون فقد البيانات.'));
      activeUpload = new tus.Upload(file, {
        endpoint: config.endpoint,
        headers: { 'x-signature': signed.token },
        metadata: { bucketName: config.bucket, objectName: signed.objectPath,
          contentType: signed.type, cacheControl: '3600' },
        chunkSize: 6 * 1024 * 1024, uploadDataDuringCreation: true,
        retryDelays: [0, 3000, 5000, 10000, 20000], removeFingerprintOnSuccess: true,
        fingerprint: async () => 'cast-registration-' + attempt.id + '-' + signed.slot,
        onProgress(uploaded) {
          progress.value = (doneBytes + uploaded) / totalBytes * 100;
          document.querySelector('#progress-label').textContent = 'رفع المرفقات ' + Math.round(progress.value) + '%';
        },
        onError() { reject(new Error('تعذر إكمال الرفع. بياناتك موجودة ويمكنك إعادة المحاولة.')); },
        onSuccess() { resolve(); },
      });
      const upload = activeUpload;
      upload.findPreviousUploads().then(previous => {
        if (stopped) throw new Error('توقف الرفع. يمكنك إعادة المحاولة.');
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }).catch(() => reject(new Error('توقف الرفع أو تعذر بدؤه. أعد المحاولة.')));
      upload.cancelRequest = () => reject(new Error('توقف الرفع. يمكنك إعادة المحاولة.'));
    });
  }

  form.addEventListener('change', event => {
    if (event.target.name === 'worksMode') {
      const drive = fields().worksMode === 'drive';
      document.querySelector('#drive-works').hidden = !drive;
      document.querySelector('#uploaded-works').hidden = drive;
    }
    if (event.target === portrait) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const image = document.querySelector('#portrait-preview');
      image.hidden = true;
      if (portrait.files[0]) {
        previewUrl = URL.createObjectURL(portrait.files[0]);
        image.src = previewUrl;
        image.onload = () => { image.hidden = false; };
        image.onerror = () => { image.hidden = true; };
      }
    }
    if (event.target === works) {
      const list = document.querySelector('#attachment-list');
      list.replaceChildren();
      for (const file of works.files) {
        const row = document.createElement('li'), name = document.createElement('bdi'), size = document.createElement('small');
        name.textContent = file.name;
        size.textContent = (file.size / 1024 ** 2).toFixed(1) + ' MB';
        row.append(name, size); list.append(row);
      }
    }
  });
  form.addEventListener('focusout', event => {
    if (!event.target.name || busy) return;
    const result = rules.validate(fields());
    const target = document.getElementById('error-' + event.target.name);
    if (target) target.textContent = result.errors[event.target.name] || '';
  });
  cancel.addEventListener('click', async () => {
    stopped = true;
    const upload = activeUpload;
    upload?.cancelRequest?.();
    await upload?.abort();
  });
  window.addEventListener('beforeunload', event => {
    if (busy || attempt) { event.preventDefault(); event.returnValue = ''; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !open) return;
    const selected = selection();
    const validated = rules.validate(selected.data);
    const attachments = rules.validateAttachments(selected.manifest, selected.data.worksMode,
      { imageBytes: 2 * 1024 ** 3, videoBytes: 2 * 1024 ** 3 });
    if (!portrait.files[0]) attachments.errors.portrait = 'أرفق صورة البروفايل';
    const errors = { ...validated.errors, ...attachments.errors };
    showErrors(errors);
    if (Object.keys(errors).length) {
      form.querySelector('[aria-invalid=true]')?.focus();
      if (!form.querySelector('[aria-invalid=true]')) { errorBox.textContent ||= Object.values(errors).join('؛ '); errorBox.focus(); }
      return;
    }
    const snapshot = JSON.stringify({ data: selected.data, files: selected.manifest });
    if (attempt && attempt.snapshot !== snapshot) attempt = null;
    if (!attempt) {
      const random = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
      attempt = { id: crypto.randomUUID(), ticket: random, snapshot, created: false, completed: new Set() };
    }
    setBusy(true); stopped = false; progress.value = 0;
    try {
      if (attempt.created) {
        const existing = await request('receipt', { id: attempt.id }, attempt.ticket);
        if (existing.status === 'pending') { receipt(existing); return; }
      } else {
        if (!challenge) throw new Error('أكمل التحقق الأمني أولًا.');
        await request('create', { id: attempt.id, ticket: attempt.ticket, challenge,
          fields: selected.data, files: selected.manifest });
        attempt.created = true;
      }
      if (stopped) throw new Error('توقف الرفع. أعد المحاولة.');
      const slots = selected.chosen.map((_, index) => index).filter(index => !attempt.completed.has(index));
      const config = await request('uploads', { id: attempt.id, slots }, attempt.ticket);
      let done = selected.chosen.reduce((sum, file, index) => sum + (attempt.completed.has(index) ? file.size : 0), 0);
      const total = selected.chosen.reduce((sum, file) => sum + file.size, 0);
      for (const signed of config.uploads) {
        if (!attempt.completed.has(signed.slot)) {
          await uploadFile(selected.chosen[signed.slot], signed, config, done, total);
          attempt.completed.add(signed.slot);
        }
        done += selected.chosen[signed.slot].size;
      }
      if (stopped) throw new Error('توقف الرفع. أعد المحاولة.');
      document.querySelector('#progress-label').textContent = 'جاري التحقق وحفظ الطلب';
      receipt(await request('submit', { id: attempt.id }, attempt.ticket));
    } catch (error) {
      if (error.errors) showErrors(error.errors);
      errorBox.textContent = error.message || 'تعذر الإرسال. أعد المحاولة.';
      errorBox.focus();
      resetChallenge();
    } finally { activeUpload = null; setBusy(false); }
  });

  window.lucide?.createIcons();
  request('availability').then(data => {
    open = data.open === true && Boolean(data.siteKey);
    submit.disabled = !open;
    if (!open) { notice.textContent = 'التسجيل غير متاح حاليًا.'; return; }
    notice.textContent = 'يُراجع طلبك قبل ظهوره في الموقع.';
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => {
      widget = window.turnstile.render('#security-challenge', { sitekey: data.siteKey, action: 'cast-register',
        callback: value => { challenge = value; }, 'expired-callback': () => { challenge = ''; },
        'error-callback': () => { challenge = ''; errorBox.textContent = 'تعذر التحقق الأمني. أعد المحاولة.'; } });
    };
    script.onerror = () => { errorBox.textContent = 'تعذر تحميل التحقق الأمني. أعد فتح الصفحة.'; };
    document.head.append(script);
  }).catch(() => { notice.textContent = 'تعذر الاتصال بخدمة التسجيل. حاول لاحقًا.'; });
})();

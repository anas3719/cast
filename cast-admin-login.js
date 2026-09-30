(function () {
  'use strict';
  const service = 'https://cast-admin-anas3719.vercel.app';
  const key = 'cast-admin-session-v1';
  const stateKey = 'cast-admin-login-state';
  let session = '';
  let returned = false;
  let error = '';
  let checkedAt = 0;
  let refreshPromise;
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('cast-session') || fragment.has('cast-login-error')) {
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const expected = sessionStorage.getItem(stateKey);
      sessionStorage.removeItem(stateKey);
      if (expected && fragment.get('state') === expected && fragment.get('cast-session')) {
        session = fragment.get('cast-session');
        localStorage.setItem(key, session);
        returned = true;
      } else error = 'لم يكتمل تسجيل الدخول. تأكد من حسابك وتثبيت تطبيق الكاست على مستودع cast.';
    } catch { error = 'تعذر حفظ جلسة الدخول في هذا المتصفح.'; }
  }
  try { session ||= localStorage.getItem(key) || ''; } catch { /* In-memory login still works. */ }
  function clear() {
    session = '';
    checkedAt = 0;
    try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
  }
  async function refresh() {
    if (!session) return false;
    if (Date.now() - checkedAt < 120000) return true;
    if (refreshPromise) return refreshPromise;
    const performRefresh = async () => {
      // Another tab may have rotated the refresh token while this tab waited.
      try { session = localStorage.getItem(key) || session; } catch { /* Use the in-memory session. */ }
      const response = await fetch(`${service}/api/auth?action=session`, {
        method: 'POST', headers: { Authorization: `Bearer ${session}` }, cache: 'no-store',
      });
      if (response.status === 401) { clear(); return false; }
      if (!response.ok) throw new Error('خدمة تسجيل الدخول غير متاحة مؤقتًا. تعديلاتك محفوظة كمسودة.');
      session = (await response.json()).session;
      try { localStorage.setItem(key, session); } catch { /* Keep the active session in memory. */ }
      checkedAt = Date.now();
      return true;
    };
    refreshPromise = (typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('cast-admin-session-refresh', performRefresh)
      : performRefresh()).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  window.castAdminLogin = {
    get connected() { return Boolean(session); },
    get returned() { return returned; },
    get error() { return error; },
    refresh, clear,
    async connectDrive() {
      if (!await refresh()) throw new Error('سجّل الدخول بحساب GitHub أولًا.');
      const response = await fetch(`${service}/api/drive-auth?action=prepare`, {
        method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${session}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'تعذر بدء ربط الدرايف.');
      const target = new URL(data.url);
      if (target.origin !== service || target.pathname !== '/api/drive-auth'
        || target.searchParams.get('action') !== 'start') throw new Error('رابط الربط غير صحيح.');
      location.assign(target.href);
    },
    async registrations(action, body = {}) {
      if (!await refresh()) throw new Error('سجّل الدخول بحساب GitHub لعرض الطلبات الخاصة.');
      return fetch('https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-registration', {
        method: 'POST', cache: 'no-store',
        headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, action }),
      });
    },
    start() {
      const nonce = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(stateKey, nonce);
      location.assign(`${service}/api/auth?action=start&nonce=${nonce}`);
    },
    async request(path, options = {}) {
      return fetch(`${service}/api/github`, { method: 'POST', cache: 'no-store',
        headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, method: options.method || 'GET', ...(options.body ? { body: JSON.parse(options.body) } : {}) }),
      });
    },
  };
})();

// api.js - Core State, Auth, and Fetch Logic
export const SCOPES =[
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
].join(' ');

export const State = {
  token: null,
  timerInterval: null,
  user: null,
  currentPanel: 'mail',
  allContacts:[], 
  mail: { label: 'INBOX', items:[], pageToken: null, isFetching: false },
  contacts: { items:[], pageToken: null },
  calendar: { date: new Date(), events:[], calendars:[], editingCalendarId: null },
  compose: { attachments:[], currentEmailId: null, currentThreadId: null },
  reply: { attachments:[], originalHtml: '', originalFrom: '', originalDate: '' }
};

export const Auth = {
  getClientId: () => localStorage.getItem('aether_client_id') || '',
  setClientId: (id) => localStorage.setItem('aether_client_id', id),
  
  getToken: () => sessionStorage.getItem('aether_token'),
  setToken: (t, exp) => { sessionStorage.setItem('aether_token', t); sessionStorage.setItem('aether_token_exp', exp); },
  getTokenExp: () => parseInt(sessionStorage.getItem('aether_token_exp') || '0'),
  clear: () => { sessionStorage.removeItem('aether_token'); sessionStorage.removeItem('aether_token_exp'); },
  
  check: () => {
    const stored = Auth.getToken();
    if (stored && Auth.getTokenExp() > Date.now() + 60000) {
      State.token = stored;
      return true;
    }
    Auth.clear();
    return false;
  },

  parseHash: () => {
    const hash = window.location.hash.substring(1);
    if (!hash) return false;
    const params = new URLSearchParams(hash);
    const t = params.get('access_token');
    if (t) {
      State.token = t;
      Auth.setToken(t, Date.now() + parseInt(params.get('expires_in') || '3600') * 1000);
      history.replaceState(null, '', window.location.pathname);
      return true;
    }
    return false;
  },

  startLogin: () => {
    const cid = Auth.getClientId();
    if (!cid) return false;
    const params = new URLSearchParams({
      client_id: cid,
      redirect_uri: window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/'),
      response_type: 'token',
      scope: SCOPES,
      prompt: 'select_account'
    });
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
    return true;
  }
};

export async function gapi(method, url, body = null, isFormData = false, retries = 3, delay = 1000) {
  if (!navigator.onLine) throw new Error("No internet connection.");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const opts = { method, headers: { Authorization: `Bearer ${State.token}` }, signal: controller.signal };
  if (body && !isFormData) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); } 
  else if (isFormData) { opts.body = body; }

  try {
    const res = await fetch(url, opts);
    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 401) throw new Error('Session expired');
      if (res.status === 429 && retries > 0) {
        await new Promise(r => setTimeout(r, delay));
        return gapi(method, url, body, isFormData, retries - 1, delay * 2);
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP Error ${res.status}`);
    }
    return res.status === 204 ? {} : await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error("Request timed out.");
    if (err.message === 'Failed to fetch') throw new Error("Network error. Could not connect to Google.");
    throw err;
  }
}
// api.js - Core State, Auth, and Fetch Logic (PKCE flow)
export const SCOPES = [
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
  allContacts: [],
  mail: { label: 'INBOX', items: [], pageToken: null, isFetching: false },
  contacts: { items: [], pageToken: null },
  calendar: { date: new Date(), events: [], calendars: [], editingCalendarId: null },
  compose: { attachments: [], currentEmailId: null, currentThreadId: null },
  reply: { attachments: [], originalHtml: '', originalFrom: '', originalDate: '' }
};

// ── PKCE helpers ──────────────────────────────────────────────────────────────
function base64urlEncode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(plain) {
  const enc = new TextEncoder().encode(plain);
  return crypto.subtle.digest('SHA-256', enc);
}
function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64urlEncode(arr.buffer).slice(0, len);
}

// ── Auth object ───────────────────────────────────────────────────────────────
export const Auth = {
  getClientId: () => localStorage.getItem('aether_client_id') || '',
  setClientId: (id) => localStorage.setItem('aether_client_id', id),

  // Access token — kept in sessionStorage (tab-scoped)
  getToken:    () => sessionStorage.getItem('aether_token'),
  getTokenExp: () => parseInt(sessionStorage.getItem('aether_token_exp') || '0'),
  setToken: (t, exp) => {
    sessionStorage.setItem('aether_token', t);
    sessionStorage.setItem('aether_token_exp', String(exp));
  },

  // Refresh token — kept in localStorage (survives tab close; cleared on sign-out)
  getRefreshToken: () => localStorage.getItem('aether_refresh_token'),
  setRefreshToken: (t) => localStorage.setItem('aether_refresh_token', t),

  clear: () => {
    sessionStorage.removeItem('aether_token');
    sessionStorage.removeItem('aether_token_exp');
    // Do NOT remove refresh token here — only remove on explicit sign-out
  },
  clearAll: () => {
    sessionStorage.removeItem('aether_token');
    sessionStorage.removeItem('aether_token_exp');
    localStorage.removeItem('aether_refresh_token');
    localStorage.removeItem('aether_pkce_verifier');
    localStorage.removeItem('aether_pkce_state');
  },

  check: () => {
    const stored = Auth.getToken();
    if (stored && Auth.getTokenExp() > Date.now() + 60000) {
      State.token = stored;
      return true;
    }
    Auth.clear();
    return false;
  },

  // Exchange the auth code for tokens using PKCE
  parseCode: async () => {
    const params = new URLSearchParams(window.location.search);
    const code  = params.get('code');
    const state = params.get('state');
    if (!code) return false;

    // Validate state to prevent CSRF
    const savedState = localStorage.getItem('aether_pkce_state');
    if (state !== savedState) {
      console.error('OAuth state mismatch');
      history.replaceState(null, '', window.location.pathname);
      return false;
    }

    const verifier = localStorage.getItem('aether_pkce_verifier');
    const clientId = Auth.getClientId();
    const redirectUri = Auth.getRedirectUri();

    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error_description || data.error);

      State.token = data.access_token;
      Auth.setToken(data.access_token, Date.now() + (data.expires_in || 3600) * 1000);
      if (data.refresh_token) Auth.setRefreshToken(data.refresh_token);

      // Clean URL
      history.replaceState(null, '', window.location.pathname);
      localStorage.removeItem('aether_pkce_verifier');
      localStorage.removeItem('aether_pkce_state');
      return true;
    } catch (e) {
      console.error('Token exchange failed', e);
      history.replaceState(null, '', window.location.pathname);
      return false;
    }
  },

  // Use refresh token to silently get a new access token
  refresh: async () => {
    const rt = Auth.getRefreshToken();
    if (!rt) return false;
    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: rt,
          client_id: Auth.getClientId(),
          grant_type: 'refresh_token',
        })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error_description || data.error);
      State.token = data.access_token;
      Auth.setToken(data.access_token, Date.now() + (data.expires_in || 3600) * 1000);
      return true;
    } catch (e) {
      console.warn('Silent refresh failed:', e.message);
      return false;
    }
  },

  getRedirectUri: () => {
    // Always redirect to the directory root (works for GitHub Pages /gm/ paths)
    return window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
  },

  startLogin: async () => {
    const cid = Auth.getClientId();
    if (!cid) return false;

    // Generate PKCE verifier + challenge
    const verifier = randomString(64);
    const challenge = base64urlEncode(await sha256(verifier));
    const oauthState = randomString(16);

    localStorage.setItem('aether_pkce_verifier', verifier);
    localStorage.setItem('aether_pkce_state', oauthState);

    const params = new URLSearchParams({
      client_id: cid,
      redirect_uri: Auth.getRedirectUri(),
      response_type: 'code',
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: oauthState,
      access_type: 'offline',   // request refresh token
      prompt: 'consent',        // always show consent to guarantee refresh token
    });
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
    return true;
  }
};

// ── API fetch wrapper ─────────────────────────────────────────────────────────
export async function gapi(method, url, body = null, isFormData = false, retries = 3, delay = 1000) {
  if (!navigator.onLine) throw new Error("No internet connection.");

  // Auto-refresh token if expiring within 2 minutes
  if (Auth.getTokenExp() - Date.now() < 120000) {
    const ok = await Auth.refresh();
    if (!ok && !Auth.check()) throw new Error('Session expired');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const opts = { method, headers: { Authorization: `Bearer ${State.token}` }, signal: controller.signal };
  if (body && !isFormData) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  else if (isFormData) { opts.body = body; }

  try {
    const res = await fetch(url, opts);
    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 401) {
        // Try one silent refresh before giving up
        const refreshed = await Auth.refresh();
        if (refreshed && retries > 0) return gapi(method, url, body, isFormData, retries - 1, delay);
        throw new Error('Session expired');
      }
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

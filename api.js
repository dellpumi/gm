// api.js - Core State, Auth, and Fetch Logic (PKCE + refresh token)
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
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
}
function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64urlEncode(arr.buffer).slice(0, len);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const Auth = {
  getClientId:     () => localStorage.getItem('aether_client_id') || '',
  setClientId:     (id) => localStorage.setItem('aether_client_id', id),

  getClientSecret: () => localStorage.getItem('aether_client_secret') || '',
  setClientSecret: (s) => localStorage.setItem('aether_client_secret', s),

  getToken:        () => sessionStorage.getItem('aether_token'),
  getTokenExp:     () => parseInt(sessionStorage.getItem('aether_token_exp') || '0'),
  setToken: (t, exp) => {
    sessionStorage.setItem('aether_token', t);
    sessionStorage.setItem('aether_token_exp', String(exp));
  },

  getRefreshToken: () => localStorage.getItem('aether_refresh_token'),
  setRefreshToken: (t) => localStorage.setItem('aether_refresh_token', t),

  // Clear only the access token (keep refresh token for silent re-auth)
  clear: () => {
    sessionStorage.removeItem('aether_token');
    sessionStorage.removeItem('aether_token_exp');
  },
  // Full clear — called on explicit sign-out only
  clearAll: () => {
    sessionStorage.removeItem('aether_token');
    sessionStorage.removeItem('aether_token_exp');
    localStorage.removeItem('aether_refresh_token');
    localStorage.removeItem('aether_pkce_verifier');
    localStorage.removeItem('aether_pkce_state');
    // Note: intentionally keep client_id and client_secret so user doesn't
    // have to re-enter them after signing out
  },

  check: () => {
    const t = Auth.getToken();
    if (t && Auth.getTokenExp() > Date.now() + 60000) {
      State.token = t;
      return true;
    }
    Auth.clear();
    return false;
  },

  getRedirectUri: () => {
    // Must exactly match what's registered in Google Cloud Console
    const p = window.location.pathname;
    return window.location.origin + p.replace(/\/[^/]*$/, '/');
  },

  // Exchange the ?code= returned by Google for tokens
  // Returns { ok: true } on success, or { ok: false, error: 'message' } on failure
  parseCode: async () => {
    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const retState = params.get('state');
    const errParam = params.get('error');

    // Clean URL regardless of outcome
    history.replaceState(null, '', window.location.pathname);

    if (errParam) {
      return { ok: false, error: `Google denied access: ${errParam}` };
    }
    if (!code) return { ok: false, error: null }; // no code — normal page load

    const savedState = localStorage.getItem('aether_pkce_state');
    if (retState !== savedState) {
      return { ok: false, error: 'Security check failed (state mismatch). Please try logging in again.' };
    }

    const verifier    = localStorage.getItem('aether_pkce_verifier');
    const clientId    = Auth.getClientId();
    const clientSecret = Auth.getClientSecret();
    const redirectUri = Auth.getRedirectUri();

    console.log('[Aether] PKCE exchange — redirect_uri:', redirectUri);

    try {
      const exchangeParams = {
        code,
        client_id:     clientId,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
        code_verifier: verifier,
      };
      if (clientSecret) exchangeParams.client_secret = clientSecret;

      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(exchangeParams)
      });
      const data = await resp.json();
      console.log('[Aether] Token exchange response:', JSON.stringify({ ...data, access_token: data.access_token ? '***' : undefined, refresh_token: data.refresh_token ? '***' : undefined }));

      if (data.error) {
        return { ok: false, error: `Token exchange failed: ${data.error_description || data.error}` };
      }

      State.token = data.access_token;
      Auth.setToken(data.access_token, Date.now() + (data.expires_in || 3600) * 1000);
      if (data.refresh_token) {
        Auth.setRefreshToken(data.refresh_token);
        console.log('[Aether] Refresh token stored ✓');
      } else {
        console.warn('[Aether] No refresh_token in response — session will expire in 1 hour');
      }

      localStorage.removeItem('aether_pkce_verifier');
      localStorage.removeItem('aether_pkce_state');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Network error during login: ${e.message}` };
    }
  },

  // Use refresh token to silently get a new access token
  // Returns true on success, false on failure
  refresh: async () => {
    const rt = Auth.getRefreshToken();
    if (!rt) return false;
    try {
      const refreshParams = {
        refresh_token: rt,
        client_id:     Auth.getClientId(),
        grant_type:    'refresh_token',
      };
      const cs = Auth.getClientSecret();
      if (cs) refreshParams.client_secret = cs;

      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(refreshParams)
      });
      const data = await resp.json();
      if (data.error) {
        console.warn('[Aether] Refresh failed:', data.error_description || data.error);
        // If refresh token is revoked/expired, remove it
        if (data.error === 'invalid_grant') Auth.clearAll();
        return false;
      }
      State.token = data.access_token;
      Auth.setToken(data.access_token, Date.now() + (data.expires_in || 3600) * 1000);
      console.log('[Aether] Token silently refreshed ✓');
      return true;
    } catch (e) {
      console.warn('[Aether] Refresh network error:', e.message);
      return false;
    }
  },

  startLogin: async () => {
    const cid = Auth.getClientId();
    if (!cid) return false;

    const verifier   = randomString(64);
    const challenge  = base64urlEncode(await sha256(verifier));
    const oauthState = randomString(16);

    localStorage.setItem('aether_pkce_verifier', verifier);
    localStorage.setItem('aether_pkce_state',    oauthState);

    const redirectUri = Auth.getRedirectUri();
    console.log('[Aether] Starting PKCE login — redirect_uri:', redirectUri);

    const params = new URLSearchParams({
      client_id:             cid,
      redirect_uri:          redirectUri,
      response_type:         'code',
      scope:                 SCOPES,
      code_challenge:        challenge,
      code_challenge_method: 'S256',
      state:                 oauthState,
      access_type:           'offline',
      prompt:                'consent',
    });
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
    return true;
  }
};

// ── API fetch wrapper ─────────────────────────────────────────────────────────
export async function gapi(method, url, body = null, isFormData = false, retries = 3, delay = 1000) {
  if (!navigator.onLine) throw new Error('No internet connection.');

  // Pre-emptive refresh if token expires within 2 minutes
  if (State.token && Auth.getTokenExp() - Date.now() < 120000) {
    await Auth.refresh();
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15000);

  const opts = { method, headers: { Authorization: `Bearer ${State.token}` }, signal: controller.signal };
  if (body && !isFormData) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  else if (isFormData) { opts.body = body; }

  try {
    const res = await fetch(url, opts);
    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 401) {
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
    if (err.name === 'AbortError') throw new Error('Request timed out.');
    if (err.message === 'Failed to fetch') throw new Error('Network error. Could not connect to Google.');
    throw err;
  }
}

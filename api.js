// api.js - Core State, Auth, and Fetch Logic (PKCE + refresh token + 9h session wall-clock)
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
  contacts: { items: [], allItems: [], pageToken: null },           // allItems = full unfiltered set for search
  calendar: {
    date: new Date(), events: [], calendars: [],
    editingCalendarId: null, editingEventId: null, editingEvent: null
  },
  compose: { attachments: [], currentEmailId: null, currentThreadId: null },
  reply: { attachments: [], originalHtml: '', originalFrom: '', originalDate: '' },
  _sessionWakeListeners: null,   // set by startSessionTimer in app.js
  _sessionExpiredToastShown: false,
  _warned30min: false,           // prevents the 30-min warning from firing more than once
  pollInterval: null             // 5-minute inbox poll timer
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

// ── Budapest time API ─────────────────────────────────────────────────────────
// Fetches authoritative CET/CEST wall-clock time from worldtimeapi.org.
// Returns epoch ms, or null on failure (caller falls back to browser time).
export async function fetchBudapestTime() {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch('https://worldtimeapi.org/api/timezone/Europe/Budapest', {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    // data.unixtime is seconds since epoch
    return data.unixtime * 1000;
  } catch (e) {
    clearTimeout(timeoutId);
    console.warn('[Aether] Budapest time API unavailable, falling back to browser clock:', e.message);
    return null;
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const Auth = {
  // ── Session wall-clock limit ──
  SESSION_MAX_MS: 9 * 60 * 60 * 1000, // 9 hours in milliseconds

  // ── OAuth credentials ──
  getClientId:     () => localStorage.getItem('aether_client_id') || '',
  setClientId:     (id) => localStorage.setItem('aether_client_id', id),
  getClientSecret: () => localStorage.getItem('aether_client_secret') || '',
  setClientSecret: (s) => localStorage.setItem('aether_client_secret', s),

  // ── Access token (session-scoped) ──
  getToken:    () => sessionStorage.getItem('aether_token'),
  getTokenExp: () => parseInt(sessionStorage.getItem('aether_token_exp') || '0'),
  setToken: (t, exp) => {
    sessionStorage.setItem('aether_token', t);
    sessionStorage.setItem('aether_token_exp', String(exp));
  },

  // ── Refresh token (persistent) ──
  getRefreshToken: () => localStorage.getItem('aether_refresh_token'),
  setRefreshToken: (t) => localStorage.setItem('aether_refresh_token', t),

  // ── Login wall-clock timestamp ──
  // Stored in localStorage so it survives page reloads but is cleared on sign-out / tab close.
  getLoginTime:  () => parseInt(localStorage.getItem('aether_login_time') || '0'),
  setLoginTime:  (t) => localStorage.setItem('aether_login_time', String(t)),
  clearLoginTime:() => localStorage.removeItem('aether_login_time'),

  // ── Time offset: (Budapest server time) − (browser Date.now()) at login ──
  // Protects against users manually advancing their system clock to extend sessions.
  // Falls back to 0 if the API was unavailable.
  getTimeOffset:  () => parseInt(localStorage.getItem('aether_time_offset') || '0'),
  setTimeOffset:  (offset) => localStorage.setItem('aether_time_offset', String(offset)),
  clearTimeOffset:() => localStorage.removeItem('aether_time_offset'),

  // ── getNow: browser time corrected by the offset captured at login ──
  getNow: () => Date.now() + Auth.getTimeOffset(),

  // ── isSessionExpired: true when more than SESSION_MAX_MS has elapsed since login ──
  isSessionExpired: () => {
    const loginTime = Auth.getLoginTime();
    if (!loginTime) return false; // no recorded login → not expired
    return (Auth.getNow() - loginTime) > Auth.SESSION_MAX_MS;
  },

  // ── Clear only access token (keep refresh token for silent re-auth) ──
  clear: () => {
    sessionStorage.removeItem('aether_token');
    sessionStorage.removeItem('aether_token_exp');
  },

  // ── Full clear — called on explicit sign-out OR real tab/browser close ──
  // Intentionally keeps client_id and client_secret so the user doesn't have
  // to re-enter them on the next sign-in.
  clearAll: () => {
    sessionStorage.removeItem('aether_token');
    sessionStorage.removeItem('aether_token_exp');
    localStorage.removeItem('aether_refresh_token');
    localStorage.removeItem('aether_pkce_verifier');
    localStorage.removeItem('aether_pkce_state');
    localStorage.removeItem('aether_login_time');
    localStorage.removeItem('aether_time_offset');
    localStorage.removeItem('aether_oauth_redirect'); // safety: never leave this stranded
  },

  // ── check: returns true if a still-valid access token exists in this session ──
  check: () => {
    const t = Auth.getToken();
    if (t && Auth.getTokenExp() > Date.now() + 60000) {
      State.token = t;
      // If loginTime was somehow lost (e.g. old version upgrade), record it now.
      if (!Auth.getLoginTime()) Auth.setLoginTime(Auth.getNow());
      return true;
    }
    Auth.clear();
    return false;
  },

  getRedirectUri: () => {
    const p = window.location.pathname;
    return window.location.origin + p.replace(/\/[^/]*$/, '/');
  },

  // ── parseCode: exchange ?code= for tokens, then anchor the session wall-clock ──
  parseCode: async () => {
    // Remove the OAuth redirect flag first — the DOMContentLoaded startup check
    // reads this key to decide whether to call clearAll(). Removing it here keeps
    // state clean even if the exchange fails.
    localStorage.removeItem('aether_oauth_redirect');

    const params   = new URLSearchParams(window.location.search);
    const code     = params.get('code');
    const retState = params.get('state');
    const errParam = params.get('error');

    history.replaceState(null, '', window.location.pathname);

    if (errParam) return { ok: false, error: `Google denied access: ${errParam}` };
    if (!code)    return { ok: false, error: null };

    const savedState = localStorage.getItem('aether_pkce_state');
    if (retState !== savedState) {
      return { ok: false, error: 'Security check failed (state mismatch). Please try logging in again.' };
    }

    const verifier     = localStorage.getItem('aether_pkce_verifier');
    const clientId     = Auth.getClientId();
    const clientSecret = Auth.getClientSecret();
    const redirectUri  = Auth.getRedirectUri();

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
      console.log('[Aether] Token exchange response:', JSON.stringify({
        ...data,
        access_token:  data.access_token  ? '***' : undefined,
        refresh_token: data.refresh_token ? '***' : undefined
      }));

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

      // ── Anchor the 9-hour wall-clock session ──────────────────────────────
      // Fetch authoritative Budapest time. If unavailable, offset = 0 (browser clock).
      const serverMs = await fetchBudapestTime();
      const nowMs    = Date.now();
      const offset   = serverMs !== null ? (serverMs - nowMs) : 0;
      Auth.setTimeOffset(offset);
      Auth.setLoginTime(nowMs + offset); // wall-clock login moment
      console.log(`[Aether] Session anchored. Budapest offset: ${offset}ms. Login time: ${new Date(nowMs + offset).toISOString()}`);
      // ─────────────────────────────────────────────────────────────────────

      localStorage.removeItem('aether_pkce_verifier');
      localStorage.removeItem('aether_pkce_state');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Network error during login: ${e.message}` };
    }
  },

  // ── refresh: silently get a new access token using the stored refresh token ──
  refresh: async () => {
    // Do not refresh if the 9-hour wall-clock limit has already been reached.
    if (Auth.isSessionExpired()) {
      console.warn('[Aether] 9-hour session limit reached. Refresh blocked.');
      return false;
    }

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
        if (data.error === 'invalid_grant') Auth.clearAll();
        return false;
      }

      State.token = data.access_token;
      Auth.setToken(data.access_token, Date.now() + (data.expires_in || 3600) * 1000);

      // If loginTime was missing (e.g. old install or first refresh after reload), set it now.
      if (!Auth.getLoginTime()) {
        Auth.setLoginTime(Auth.getNow());
        console.warn('[Aether] loginTime was missing; anchored to now.');
      }

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
    // CRITICAL: set this flag BEFORE changing location.
    // Setting window.location.href fires pagehide/beforeunload immediately.
    // handlePageClose reads this flag to know it must NOT call clearAll()
    // (which would delete the PKCE verifier + state we just stored above).
    localStorage.setItem('aether_oauth_redirect', '1');

    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
    return true;
  }
};

// ── API fetch wrapper ─────────────────────────────────────────────────────────
export async function gapi(method, url, body = null, isFormData = false, retries = 3, delay = 1000) {
  if (!navigator.onLine) throw new Error('No internet connection.');

  // Hard session expiry gate — never let a request out after 9 hours.
  if (Auth.isSessionExpired()) {
    Auth.clearAll();
    throw new Error('SESSION_EXPIRED');
  }

  // Pre-emptive refresh if token expires within 2 minutes.
  if (State.token && Auth.getTokenExp() - Date.now() < 120000) {
    await Auth.refresh();
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15000);

  const opts = { method, headers: { Authorization: `Bearer ${State.token}` }, signal: controller.signal };
  if (body && !isFormData) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  else if (isFormData)     { opts.body = body; }

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
    if (err.name === 'AbortError')             throw new Error('Request timed out.');
    if (err.message === 'Failed to fetch')     throw new Error('Network error. Could not connect to Google.');
    throw err;
  }
}

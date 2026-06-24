// app.js - UI Logic, DOM Manipulation, and Event Binding
import { State, Auth, gapi } from './api.js';

const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function el(tag, className = '', textContent = '', attributes = {}) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (textContent) e.textContent = textContent;
  for (const [key, val] of Object.entries(attributes)) {
    if (key === 'style') e.style.cssText = val;
    else if (key.startsWith('data-')) e.setAttribute(key, val);
    else e[key] = val;
  }
  return e;
}

function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const t = el('div', `toast ${type}`, msg);
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function emptyState(container, msg) {
  container.innerHTML = '';
  container.appendChild(el('div', 'empty-state', msg));
}

function loadingState(container) {
  container.innerHTML = '';
  const div = el('div', 'loading-spinner', ' Loading…');
  div.prepend(el('div', 'spinner'));
  container.appendChild(div);
}

function confirmAction(title, msg, confirmBtnLabel, onConfirm, isDestructive = false) {
  const confirmModal = document.getElementById('confirm-modal');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-title').style.color = isDestructive ? 'var(--red)' : 'var(--text)';
  document.getElementById('confirm-msg').textContent = msg;
  
  const btnYes = document.getElementById('btn-confirm-yes');
  btnYes.textContent = confirmBtnLabel;
  btnYes.style.background = isDestructive ? 'var(--red)' : 'var(--accent)';
  
  confirmModal.classList.add('open');
  btnYes.onclick = () => { confirmModal.classList.remove('open'); onConfirm(); };
}

const formatBytes = b => b < 1024 ? b+'B' : b < 1048576 ? (b/1024).toFixed(1)+'KB' : (b/1048576).toFixed(1)+'MB';

const formatTimestamp = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear().toString().slice(-2)}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// STRIP all whitespace/newlines, then pad Base64. Critical for preventing DOMExceptions!
const padB64 = str => {
  let b64 = (str || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (b64.length % 4) b64 += '=';
  return b64;
};


function decodeB64(str) {
  if (!str) return '';
  try {
    const bin = atob(padB64(str));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    console.error('Failed to decode base64:', e);
    return str; // Fallback
  }
}

// Smart thumbnail icon selector based on MIME/Extension
function getFileIcon(mime, filename) {
  if (!mime) mime = '';
  mime = mime.toLowerCase();
  const ext = (filename || '').split('.').pop().toLowerCase();
  
  if (mime.includes('pdf') || ext === 'pdf') return '📕';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv') || ['xls','xlsx','csv'].includes(ext)) return '📊';
  if (mime.includes('word') || mime.includes('document') ||['doc','docx','rtf'].includes(ext)) return '📘';
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['ppt','pptx'].includes(ext)) return '📙';
  if (mime.startsWith('video/') || ['mp4','avi','mov','mkv','webm'].includes(ext)) return '🎬';
  if (mime.startsWith('audio/') ||['mp3','wav','ogg','m4a'].includes(ext)) return '🎵';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('rar') || mime.includes('7z') ||['zip','rar','tar','gz','7z'].includes(ext)) return '📦';
  if (mime.includes('javascript') || mime.includes('json') || mime.includes('xml') ||['js','json','html','css','xml'].includes(ext)) return '💻';
  if (mime.startsWith('text/') || ext === 'txt') return '📄';
  if (mime.startsWith('image/')) return '🖼️'; 
  return '📁'; 
}

function decodeRFC2047(str) {
  if (!str) return '';
  return str.replace(/=\?([a-zA-Z0-9\-]+)\?([bBqQ])\?([^\?]+)\?=/gi, (match, charset, encoding, data) => {
    try {
      let bytes;
      if (encoding.toUpperCase() === 'B') {
        const bin = atob(padB64(data));
        bytes = new Uint8Array(bin.length);
        for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else if (encoding.toUpperCase() === 'Q') {
        const decodedBytes =[];
        const qData = data.replace(/_/g, ' ');
        for (let i = 0; i < qData.length; i++) {
          if (qData[i] === '=' && i + 2 < qData.length) {
            decodedBytes.push(parseInt(qData.substring(i + 1, i + 3), 16));
            i += 2;
          } else { 
            decodedBytes.push(qData.charCodeAt(i)); 
          }
        }
        bytes = new Uint8Array(decodedBytes);
      }
      
      if (bytes) {
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (e) {
          return new TextDecoder(charset.toLowerCase() || 'utf-8').decode(bytes);
        }
      }
    } catch (e) { return match; }
    return match;
  });
}

function decodeEntities(encodedString) {
  if (!encodedString) return '';
  const textArea = document.createElement('textarea');
  textArea.innerHTML = encodedString;
  return textArea.value;
}

// Reverse-map Windows-1252 special chars (0x80–0x9F range) back to their byte values.
// These appear when UTF-8 bytes were misread as cp1252 (e.g. 0x83 -> ƒ U+0192).
const CP1252_TO_BYTE = {
  0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85,
  0x2020:0x86, 0x2021:0x87, 0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A,
  0x2039:0x8B, 0x0152:0x8C, 0x017D:0x8E, 0x2018:0x91, 0x2019:0x92,
  0x201C:0x93, 0x201D:0x94, 0x2022:0x95, 0x2013:0x96, 0x2014:0x97,
  0x02DC:0x98, 0x2122:0x99, 0x0161:0x9A, 0x203A:0x9B, 0x0153:0x9C,
  0x017E:0x9E, 0x0178:0x9F
};

function cp1252StringToBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    if (cp in CP1252_TO_BYTE) bytes[i] = CP1252_TO_BYTE[cp];
    else if (cp <= 0xFF) bytes[i] = cp;
    else return null; // Unmappable — not cp1252
  }
  return bytes;
}

// Fix headers triple-encoded as UTF-8 -> cp1252 -> UTF-8 -> cp1252.
// The Gmail API returns raw UTF-8 bytes in headers when senders don't use RFC2047;
// JavaScript then reads those as cp1252, producing e.g. "IstvÃƒÂ¡n" for "István".
function fixDoubleEncodedUtf8(str) {
  if (!str) return str;
  try {
    // Pass 1: reverse cp1252 -> get bytes (these are still double-encoded UTF-8)
    const bytes1 = cp1252StringToBytes(str);
    if (!bytes1) return str;
    const s2 = new TextDecoder('utf-8', { fatal: true }).decode(bytes1);
    // Pass 2: reverse cp1252 again -> get original UTF-8 bytes
    const bytes2 = cp1252StringToBytes(s2);
    if (!bytes2) return str;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes2);
  } catch (e) {
    // Not triple-encoded — try single-pass (double-encoded)
    try {
      const bytes = cp1252StringToBytes(str);
      if (!bytes) return str;
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e2) {
      return str;
    }
  }
}

function utf8ToBase64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunkSize = 0x8000; 
  for (let i = 0; i < bytes.length; i += chunkSize) { bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)); }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

function encodeSubject(str) {
  if (!str) return '';
  // Don't encode if it is strictly ASCII
  if (!/[^\x00-\x7F]/.test(str)) return str;
  return `=?UTF-8?B?${utf8ToBase64(str)}?=`;
}

// Safely split base64 strings WITHOUT trailing newlines breaking the boundary
function chunkString(str, len = 76) {
  const chunks =[];
  for (let i = 0; i < str.length; i += len) { chunks.push(str.slice(i, i + len)); }
  return chunks.join('\r\n');
}

function getMimeFilenameParams(filename) {
  const isAscii = !/[^\x00-\x7F]/.test(filename);
  const encoded = isAscii ? `"${filename}"` : encodeSubject(filename);
  return {
    nameStr: `name=${encoded}`,
    filenameStr: `filename=${encoded}`
  };
}

function encodeAddressList(str) {
  if (!str) return '';
  return str.split(/[,;]/).map(part => {
    const p = part.trim();
    if (!p) return '';
    
    const match = p.match(/^(.*?)<(.+?)>$/);
    if (match) {
      let name = match[1].trim().replace(/^"|"$/g, '').trim();
      let email = match[2].trim();
      
      if (/[^\x00-\x7F]/.test(name)) name = encodeSubject(name);
      else if (name) name = `"${name}"`;
      
      return name ? `${name} <${email}>` : `<${email}>`;
    }
    
    if (/[^\x00-\x7F]/.test(p)) return encodeSubject(p);
    return p;
  }).filter(Boolean).join(', ');
}

// ===== CORE INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  // ── Session lifetime is now handled natively by sessionStorage ──────────────
  // The refresh token, login timestamp, and time offset all live in sessionStorage
  // (see api.js). The browser itself destroys that storage the moment this tab/
  // window is actually closed — including on crash or force-quit — with zero
  // reliance on beforeunload/pagehide firing correctly (which was never fully
  // reliable across browsers). A reload (any method) keeps the same tab alive, so
  // sessionStorage — and the session — survives a reload exactly as intended.
  // No manual close-detection code is needed any more.
  window.addEventListener('offline', () => toast('You are offline. Reconnect to sync.', 'error'));
  window.addEventListener('online',  () => toast('Back online!', 'success'));

  async function bootApp() {
    // Guard: if the 9-hour wall-clock limit has already expired, refuse boot.
    if (Auth.isSessionExpired()) {
      Auth.clearAll();
      State.token = null;
      showLoginError('Your 9-hour session has expired. Please sign in again.');
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
      return;
    }
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    startSessionTimer();
    try {
      await loadUserInfo();
      await loadEmails('INBOX');
      loadAllContactsForAutocomplete();
      startInboxPoll(); // begin 10-minute background poll
      startEventNotifications(); // begin 60-second upcoming-event check
    } catch (err) {
      if (err.message === 'SESSION_EXPIRED' || err.message === 'Session expired') {
        handleSignOut();
      } else {
        toast(err.message, 'error');
      }
    }
  }

  function showLoginError(msg) { _showLoginError(msg); } // thin alias — module-level _showLoginError does the work

  // PKCE: ?code= returned from Google
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('code') || urlParams.has('error')) {
    const result = await Auth.parseCode();
    if (result.ok) {
      await bootApp();
    } else if (result.error) {
      showLoginError(result.error);
    } else {
      // No code, no error — shouldn't happen, just show login
      document.getElementById('login-screen').style.display = 'flex';
    }
    return;
  }

  // ── Stale-session guard (Web Locks API) ──────────────────────────────────
  // sessionStorage is normally destroyed the instant a tab/window genuinely
  // closes — that's the core mechanism keeping the session honest. BUT some
  // browsers, when configured to "continue where you left off" (or after
  // crash-recovery), deliberately REPOPULATE a closed tab's sessionStorage as
  // part of restoring it — this is intentional, spec-permitted browser
  // behaviour, not a bug, and no storage API alone can tell the difference.
  //
  // Web Locks ARE able to tell the difference: a lock is a pure in-memory
  // runtime construct, never written to disk and never restored by any
  // browser feature. BUT a lock is tied to the DOCUMENT context, not the tab
  // — and a plain reload (F5) discards and recreates that context too, which
  // would release the lock on every single reload, not just on a genuine
  // close+relaunch. So this check ONLY runs when the Performance Navigation
  // API confirms this load is NOT a reload — i.e. only for the ambiguous
  // "fresh navigate" case, where sessionStorage having leftover data is
  // genuinely suspicious (a reload, by contrast, is unambiguous: sessionStorage
  // survives it by definition, so there's nothing to check).
  const navType = performance.getEntriesByType?.('navigation')?.[0]?.type ?? 'navigate';
  if ('locks' in navigator && navType !== 'reload') {
    try {
      const noOtherLiveTab = await new Promise((resolve) => {
        navigator.locks.request(
          'aether-app-alive',
          { mode: 'exclusive', ifAvailable: true },
          (lock) => resolve(!!lock) // lock is null if another tab already holds it
        );
      });
      if (noOtherLiveTab && (Auth.getRefreshToken() || Auth.getToken())) {
        console.warn('[Aether] sessionStorage was repopulated by browser session-restore with no live tab present — clearing stale session.');
        Auth.clearAll();
      }
    } catch (e) { console.warn('[Aether] Lock-based staleness check failed:', e.message); }
  }
  // Hold a SHARED lock for as long as this tab stays open (independent of the
  // check above — every load, reload or not, should hold the lock so that a
  // LATER tab's probe correctly sees this one as alive). Multiple tabs of this
  // app can each hold this same shared lock concurrently without blocking one
  // another; it's only fully released once every tab/window has closed.
  if ('locks' in navigator) {
    navigator.locks.request('aether-app-alive', { mode: 'shared' }, () => new Promise(() => {})).catch(() => {});
  }

  // Already have a valid access token (same session)
  if (Auth.check()) { await bootApp(); return; }

  // Try silent refresh with stored refresh token (skipped if we just wiped it above)
  const refreshed = await Auth.refresh();
  if (refreshed) { await bootApp(); return; }

  // No valid session — show login screen
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
});

// ===== EVENT BINDING =====
function setupEventListeners() {
  // ── bfcache (back-forward cache) freshness guard ──────────────────────────
  // When the browser restores a page from its in-memory back-forward cache
  // (navigating Back/Forward to a frozen tab), pageshow fires with persisted:true.
  // This is no longer a security concern (sessionStorage already governs the
  // session's true lifetime), but a frozen tab's mail/calendar data can be stale
  // after a long time away, so we force a clean reload to resync everything.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      console.log('[Aether] Restored from bfcache — reloading to refresh data.');
      window.location.reload();
    }
  });

  // ── Single-screen login ────────────────────────────────────────────────────
  // showLoginError is defined at module top level (below) so it is reachable
  // from both this click handler AND from the DOMContentLoaded boot section.
  const savedClientId     = Auth.getClientId();
  const savedClientSecret = Auth.getClientSecret();
  const cidInput = document.getElementById('client-id-input');
  const secInput = document.getElementById('client-secret-input');

  // Show short masked previews ("1009···" / "GOCS···") so credentials aren't
  // displayed in full on screen, while still letting the user know they're loaded.
  const CID_MASK = savedClientId     ? savedClientId.slice(0, 4)     + '···' : '';
  const SEC_MASK = savedClientSecret ? savedClientSecret.slice(0, 4) + '···' : '';
  if (CID_MASK && cidInput) cidInput.value = CID_MASK;
  if (SEC_MASK && secInput) secInput.value = SEC_MASK;

  // Clear mask on focus (user wants to type a new value), restore on blur if left empty.
  cidInput?.addEventListener('focus', () => { if (cidInput.value === CID_MASK) cidInput.value = ''; });
  secInput?.addEventListener('focus', () => { if (secInput.value === SEC_MASK) secInput.value = ''; });
  cidInput?.addEventListener('blur',  () => { if (!cidInput.value.trim() && CID_MASK) cidInput.value = CID_MASK; });
  secInput?.addEventListener('blur',  () => { if (!secInput.value.trim() && SEC_MASK) secInput.value = SEC_MASK; });

  document.getElementById('btn-login').addEventListener('click', async () => {
    const rawCid = cidInput?.value.trim() || '';
    const rawSec = secInput?.value.trim() || '';
    // If the field still shows the mask, the user did not change it → use stored value.
    const cid = (rawCid === CID_MASK) ? savedClientId : rawCid;
    const sec = (rawSec === SEC_MASK) ? savedClientSecret : rawSec;
    if (!cid) {
      showLoginError('Please enter your OAuth Client ID.');
      return;
    }
    Auth.setClientId(cid);
    if (sec) Auth.setClientSecret(sec);
    await Auth.startLogin();
  });

  // Allow Enter key in either input to trigger sign-in
  [cidInput, secInput].forEach(inp => inp?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-login').click();
  }));

  document.getElementById('btn-sign-out').addEventListener('click', () => confirmAction('Sign Out', 'Are you sure you want to log out? This will clear your local app cache and sever connection.', 'Yes, Sign Out', handleSignOut, true));

  // ── Event reminder notifications (bell toggle) ───────────────────────────
  const notifBtn = document.getElementById('btn-notif-toggle');
  function refreshNotifBtnState() {
    if (!('Notification' in window)) { notifBtn.style.display = 'none'; return; }
    notifBtn.classList.remove('notif-on', 'notif-off', 'notif-denied');
    if (Notification.permission === 'granted') {
      notifBtn.classList.add('notif-on');
      notifBtn.title = 'Event reminders are on — click to turn off';
    } else if (Notification.permission === 'denied') {
      notifBtn.classList.add('notif-denied');
      notifBtn.title = 'Notifications blocked in browser settings';
    } else {
      notifBtn.classList.add('notif-off');
      notifBtn.title = 'Click to enable browser notifications for upcoming events';
    }
  }
  refreshNotifBtnState();

  notifBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') {
      toast('Notifications are blocked. Enable them in your browser\'s site settings.', 'error');
      return;
    }
    if (Notification.permission === 'granted') {
      // Toggle OFF: we can't revoke browser permission via JS, but we can stop
      // checking/firing reminders, which is the practical "off" the user wants.
      State.notificationsEnabled = !State.notificationsEnabled;
      notifBtn.classList.toggle('notif-on', State.notificationsEnabled);
      notifBtn.classList.toggle('notif-off', !State.notificationsEnabled);
      toast(State.notificationsEnabled ? 'Event reminders enabled' : 'Event reminders paused', 'info');
      return;
    }
    // permission === 'default' → ask now (this click IS the required user gesture)
    const result = await Notification.requestPermission();
    refreshNotifBtnState();
    if (result === 'granted') {
      State.notificationsEnabled = true;
      toast('Event reminders enabled — you\'ll get a notification 10 minutes before each event.', 'success');
      checkUpcomingEvents(); // run one check immediately
    } else if (result === 'denied') {
      toast('Notifications blocked. You can re-enable them in your browser settings.', 'error');
    }
  });

  // Fix 19: Batch delete
  document.getElementById('btn-batch-delete').addEventListener('click', () => {
    const checked = [...document.querySelectorAll('.email-checkbox:checked')];
    if (!checked.length) return;
    const count = checked.length;
    confirmAction(
      'Delete Selected',
      `Move ${count} message${count > 1 ? 's' : ''} to Trash?`,
      `🗑 Delete ${count}`,
      async () => {
        const ids = checked.map(cb => cb.closest('.email-item').dataset.msgId).filter(Boolean);
        try {
          await Promise.all(ids.map(id =>
            gapi('POST', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`)
          ));
          toast(`${count} message${count > 1 ? 's' : ''} moved to Trash`, 'success');
          // Remove deleted items from DOM and state
          ids.forEach(id => {
            document.querySelector(`.email-item[data-msg-id="${id}"]`)?.remove();
            State.mail.items = State.mail.items.filter(m => m.id !== id);
          });
          updateBatchDeleteBtn();
        } catch (err) {
          toast('Failed to delete some messages: ' + err.message, 'error');
        }
      },
      true
    );
  });

  document.querySelectorAll('.nav-item').forEach(nav => { nav.addEventListener('click', () => showPanel(nav.dataset.panel, nav.dataset.label)); });
  document.getElementById('btn-refresh').addEventListener('click', refreshCurrent);
  
  document.getElementById('btn-open-sidebar').addEventListener('click', () => document.getElementById('sidebar').classList.add('open'));
  document.getElementById('btn-close-sidebar').addEventListener('click', () => document.getElementById('sidebar').classList.remove('open'));
  
  document.querySelectorAll('.btn-back-to-list').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('email-detail-panel').classList.remove('open');
      document.getElementById('contact-detail-panel').classList.remove('open');
    });
  });

  document.getElementById('btn-confirm-no').addEventListener('click', () => document.getElementById('confirm-modal').classList.remove('open'));

  // File preview modal close
  function closeFilePreview() {
    const modal = document.getElementById('file-preview-modal');
    modal.classList.remove('open');
    if (modal._blobUrl) { URL.revokeObjectURL(modal._blobUrl); modal._blobUrl = null; }
    if (window._xlsxWb)    { window._xlsxWb = null; }
    if (window._zipInst)   { window._zipInst = null; }
    if (window._zipExtract){ window._zipExtract = null; }
    document.getElementById('file-preview-body').innerHTML = '';
  }
  document.getElementById('file-preview-close').addEventListener('click', closeFilePreview);
  // Click outside the preview window also closes it
  document.getElementById('file-preview-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('file-preview-modal')) closeFilePreview();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const filePreview = document.getElementById('file-preview-modal');
      const confirm = document.getElementById('confirm-modal');
      const contact = document.getElementById('contact-modal');
      const evModal = document.getElementById('event-modal');
      const compose = document.getElementById('compose-modal');

      if (filePreview.classList.contains('open')) closeFilePreview();
      else if (confirm.classList.contains('open')) confirm.classList.remove('open');
      else if (contact.classList.contains('open')) contact.classList.remove('open');
      else if (evModal.classList.contains('open')) evModal.classList.remove('open');
      else if (compose.classList.contains('open')) compose.classList.remove('open');
    }
  });

  let searchTimer;
  document.getElementById('search-input').addEventListener('input', (e) => { 
    clearTimeout(searchTimer); 
    searchTimer = setTimeout(() => {
      const q = e.target.value;
      if (State.currentPanel === 'mail') searchEmails(q);
      if (State.currentPanel === 'contacts') filterContacts(q);
      if (State.currentPanel === 'calendar') searchCalendar(q);
    }, 400); 
  });

  document.getElementById('contact-search').addEventListener('input', (e) => filterContacts(e.target.value));

  document.getElementById('btn-load-more-mail').addEventListener('click', () => loadEmails(State.mail.label, true));
  document.getElementById('btn-load-more-contacts').addEventListener('click', () => loadContacts(true));

  document.getElementById('btn-compose').addEventListener('click', () => openComposeModal());
  document.getElementById('btn-close-compose').addEventListener('click', () => {
    document.getElementById('compose-modal').classList.remove('open');
    State.compose.attachments =[];
  });
  document.getElementById('btn-send-email').addEventListener('click', () => confirmAction('Send Message', 'Are you ready to send this message?', 'Send', sendEmail));
  
  document.getElementById('btn-toggle-reply').addEventListener('click', () => toggleReply(false));
  document.getElementById('btn-cancel-reply').addEventListener('click', () => toggleReply(true));
  document.getElementById('btn-send-reply').addEventListener('click', () => confirmAction('Send Reply', 'Are you sure you want to send this reply?', 'Send', sendReply));

  document.getElementById('compose-attach-input').addEventListener('change', (e) => handleAttachFiles(e, 'compose'));
  document.getElementById('reply-attach-input').addEventListener('change', (e) => handleAttachFiles(e, 'reply'));

  document.getElementById('compose-body-text').addEventListener('paste', handleRichTextMedia);
  document.getElementById('compose-body-text').addEventListener('drop', handleRichTextMedia);
  document.getElementById('reply-body').addEventListener('paste', handleRichTextMedia);
  document.getElementById('reply-body').addEventListener('drop', handleRichTextMedia);

  document.getElementById('btn-cal-prev').addEventListener('click', () => { State.calendar.date.setMonth(State.calendar.date.getMonth() - 1); loadCalendar(); });
  document.getElementById('btn-cal-next').addEventListener('click', () => { State.calendar.date.setMonth(State.calendar.date.getMonth() + 1); loadCalendar(); });
  document.getElementById('btn-cal-today').addEventListener('click', () => { State.calendar.date = new Date(); loadCalendar(); });
  document.getElementById('btn-new-event').addEventListener('click', () => openEventModal());

  // Fix 10: Mouse wheel on calendar changes months
  document.getElementById('panel-calendar').addEventListener('wheel', (e) => {
    e.preventDefault();
    State.calendar.date.setMonth(State.calendar.date.getMonth() + (e.deltaY > 0 ? 1 : -1));
    loadCalendar();
  }, { passive: false });
  document.getElementById('btn-close-event').addEventListener('click', () => document.getElementById('event-modal').classList.remove('open'));
  document.getElementById('btn-cancel-event').addEventListener('click', () => document.getElementById('event-modal').classList.remove('open'));
  document.getElementById('btn-save-event').addEventListener('click', saveEvent);
  // Fix 27: Delete event
  document.getElementById('btn-delete-event').addEventListener('click', deleteEvent);
  // Fix 28: All-day toggle
  document.getElementById('event-allday').addEventListener('change', (e) => updateAllDayFields(e.target.checked));

  document.getElementById('btn-close-contact').addEventListener('click', () => document.getElementById('contact-modal').classList.remove('open'));
  document.getElementById('btn-cancel-contact').addEventListener('click', () => document.getElementById('contact-modal').classList.remove('open'));
  document.getElementById('btn-save-contact').addEventListener('click', saveContact);
  // Fix 30: Delete contact from modal
  document.getElementById('btn-delete-contact-modal').addEventListener('click', () => {
    // Find the current contact being edited by resourceName
    const rn = document.getElementById('contact-rn').value;
    const c = State.contacts.items.find(c => c.resourceName === rn);
    if (c) deleteContact(c);
  });

  document.querySelectorAll('.autocomplete-input').forEach(input => attachAutocomplete(input));
}

function handleRichTextMedia(e) {
  let files =[];
  if (e.type === 'paste' && e.clipboardData.files.length > 0) { e.preventDefault(); files = Array.from(e.clipboardData.files); } 
  else if (e.type === 'drop' && e.dataTransfer.files.length > 0) { e.preventDefault(); files = Array.from(e.dataTransfer.files); }
  else return;

  const type = e.target.id.includes('reply') ? 'reply' : 'compose';
  
  files.forEach(file => {
    if (file.size === 0) return toast(`Skipped empty file: ${file.name}`, 'error');
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => { 
        const html = `<span class="resizable-img"><img src="${ev.target.result}" /></span>&nbsp;`;
        document.execCommand('insertHTML', false, html); 
      };
      reader.readAsDataURL(file);
    } else {
      State[type].attachments.push(file);
      renderAttachmentChips(type);
    }
  });
}

// ===== AUTOCOMPLETE SUGGESTIONS =====
async function loadAllContactsForAutocomplete() {
  try {
    const data = await gapi('GET', `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=1000`);
    State.allContacts = (data.connections || []).map(c => {
      return { name: c.names?.[0]?.displayName || '', email: c.emailAddresses?.[0]?.value || '' };
    }).filter(c => c.email !== '');
  } catch(e) {}
}

function attachAutocomplete(input) {
  let popup = el('div', 'autocomplete-popup');
  document.body.appendChild(popup);
  let activeIndex = -1;
  
  input.addEventListener('input', () => {
    const val = input.value;
    const lastPart = val.split(';').pop().trim().toLowerCase();
    if (!lastPart) { popup.style.display = 'none'; return; }
    
    const matches = State.allContacts.filter(c => c.email.toLowerCase().includes(lastPart) || c.name.toLowerCase().includes(lastPart)).slice(0, 6);
    if (matches.length === 0) { popup.style.display = 'none'; return; }
    
    popup.innerHTML = '';
    matches.forEach((m, idx) => {
      const item = el('div', 'ac-item', `${m.name} <${m.email}>`);
      item.dataset.email = `"${m.name}" <${m.email}>`;
      item.onmousedown = (e) => { 
        e.preventDefault();
        insertMatch(item.dataset.email);
      };
      popup.appendChild(item);
    });
    
    activeIndex = 0;
    highlightItem();

    const rect = input.getBoundingClientRect();
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + window.scrollY) + 'px';
    popup.style.display = 'block';
  });

  function insertMatch(matchStr) {
    let parts = input.value.split(';').map(s => s.trim());
    parts.pop(); 
    parts.push(matchStr);
    input.value = parts.filter(Boolean).join('; ') + '; ';
    popup.style.display = 'none';
    input.focus();
  }

  function highlightItem() {
    const items = popup.querySelectorAll('.ac-item');
    items.forEach((item, idx) => {
      if (idx === activeIndex) item.classList.add('selected');
      else item.classList.remove('selected');
    });
  }

  input.addEventListener('keydown', (e) => {
    if (popup.style.display === 'block') {
      const items = popup.querySelectorAll('.ac-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        highlightItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        highlightItem();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && items[activeIndex]) {
          insertMatch(items[activeIndex].dataset.email);
        }
      }
    }
  });
  
  input.addEventListener('blur', () => popup.style.display = 'none');
}

// showLoginError — top-level so it is reachable from setupEventListeners
// click handlers AND from the DOMContentLoaded boot section (which wraps it
// in a thin local alias). Defining it here avoids the ReferenceError that
// would occur if it were defined only inside the DOMContentLoaded callback.
function showLoginError(msg) {
  _showLoginError(msg);
}
function _showLoginError(msg) {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  let errEl = document.getElementById('login-error-msg');
  if (!errEl) {
    errEl = document.createElement('p');
    errEl.id = 'login-error-msg';
    errEl.style.cssText = 'color:var(--red,#f87171);font-size:13px;margin-top:14px;text-align:center;';
    document.querySelector('.login-card').appendChild(errEl);
  }
  errEl.textContent = msg;
}

function startSessionTimer() {
  clearInterval(State.timerInterval);
  State._sessionExpiredToastShown = false;
  State._warned30min = false; // reset so the warning fires fresh on each new session

  // ── Session expiry check (shared by timer tick and wake-from-sleep) ───────
  function checkExpiry() {
    if (!Auth.getLoginTime()) return false;
    if (Auth.isSessionExpired()) {
      clearInterval(State.timerInterval);
      removeWakeListeners();
      if (!State._sessionExpiredToastShown) {
        State._sessionExpiredToastShown = true;
        toast('Your 9-hour session has expired. Signing out for security…', 'error');
      }
      setTimeout(handleSignOut, 2500);
      return true;
    }
    return false;
  }

  // ── Wake-from-sleep detection via visibility / focus events ───────────────
  // These catch screen-sleep on many OS/browser combos even when the app
  // stays in the foreground (device lock, lid close, etc.).
  function onWake() { checkExpiry(); }
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  State._sessionWakeListeners = onWake;

  function removeWakeListeners() {
    if (State._sessionWakeListeners) {
      document.removeEventListener('visibilitychange', State._sessionWakeListeners);
      window.removeEventListener('focus', State._sessionWakeListeners);
      State._sessionWakeListeners = null;
    }
  }

  // ── Heartbeat drift detector ───────────────────────────────────────────────
  // When the device sleeps and wakes with the app already on screen, neither
  // visibilitychange nor focus fires.  The solution: track the real wall-clock
  // gap between consecutive 1-second ticks.  If the gap > 3 s (3× the interval),
  // the device was asleep → run an immediate expiry check.
  let lastTick = Date.now();

  State.timerInterval = setInterval(async () => {
    const now     = Date.now();
    const tickGap = now - lastTick;
    lastTick = now;

    if (tickGap > 3000) {
      console.log(`[Aether] Wake-from-sleep detected via timer drift (gap: ${tickGap}ms)`);
    }

    // Expiry check on every tick (catches wake-from-sleep via drift + regular time passage)
    if (checkExpiry()) return;

    // ── Compute remaining times ──────────────────────────────────────────────
    const SESSION_MAX_MS = Auth.SESSION_MAX_MS;                          // 9 h
    const loginTime      = Auth.getLoginTime();
    const tokenExp       = Auth.getTokenExp();

    const tokenRemainMs = Math.max(0, tokenExp - now);
    const totalRemainMs = loginTime ? Math.max(0, loginTime + SESSION_MAX_MS - now) : 0;

    // ── Token expired → try refresh (still within 9-hour window) ────────────
    if (tokenRemainMs <= 0) {
      const ok = await Auth.refresh();
      if (!ok) { handleSignOut(); return; }
    }

    // ── Pre-emptive refresh at ~5 min remaining on current token ─────────────
    if (tokenRemainMs > 0 && tokenRemainMs < 300000 && tokenRemainMs > 295000) {
      Auth.refresh().catch(() => {});
    }

    // ── Format slot countdown (current 1-hour token) ─────────────────────────
    const slotM  = Math.floor(tokenRemainMs / 60000);
    const slotS  = Math.floor((tokenRemainMs % 60000) / 1000);
    const slotTxt = `${String(slotM).padStart(2,'0')}:${String(slotS).padStart(2,'0')}`;

    // ── Format total remaining ────────────────────────────────────────────────
    const totalH  = Math.floor(totalRemainMs / 3600000);
    const totalM  = Math.floor((totalRemainMs % 3600000) / 60000);
    const totalS  = Math.floor((totalRemainMs % 60000) / 1000);
    const totalTxt = `${totalH}h ${String(totalM).padStart(2,'0')}:${String(totalS).padStart(2,'0')}`;

    // Renewals = how many more full-hour refreshes fit inside the remaining window.
    // Example: 8h 40m remaining → 8 renewals left.
    const renewals = Math.floor(totalRemainMs / 3600000);
    const renewalTxt = `${renewals} renewal${renewals !== 1 ? 's' : ''} left`;

    // ── Update DOM ────────────────────────────────────────────────────────────
    const slotEl    = document.getElementById('timer-slot');
    const renewalEl = document.getElementById('timer-renewals');
    const totalEl   = document.getElementById('timer-total');

    if (slotEl)    slotEl.textContent    = slotTxt;
    if (renewalEl) renewalEl.textContent = renewalTxt;
    if (totalEl)   totalEl.textContent   = totalTxt;

    // ── Colour warnings ───────────────────────────────────────────────────────
    if (slotEl)  slotEl.style.color  = tokenRemainMs < 300000  ? 'var(--red)'    : '';
    if (totalEl) totalEl.style.color = totalRemainMs < 900000  ? 'var(--red)'    :
                                       totalRemainMs < 1800000 ? 'var(--yellow)' : '';

    // ── One-time warning toast at 30 minutes total remaining ─────────────────
    if (totalRemainMs > 0 && totalRemainMs <= 1800000 && !State._warned30min) {
      State._warned30min = true;
      const minsLeft = Math.ceil(totalRemainMs / 60000);
      toast(`⚠ ${minsLeft} minutes of your 9-hour session remain.`, 'error');
    }
  }, 1000);
}

async function handleSignOut() {
  if (State.token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${State.token}`, { method: 'POST', headers: { 'Content-type': 'application/x-www-form-urlencoded' } });
    } catch (e) { console.warn('Revocation failed', e); }
  }
  Auth.clearAll();
  State.token = null;
  clearInterval(State.timerInterval);
  stopInboxPoll(); // stop background poll on sign-out
  stopEventNotifications(); // stop event-reminder poll on sign-out
  // Clean up wake-from-sleep listeners
  if (State._sessionWakeListeners) {
    document.removeEventListener('visibilitychange', State._sessionWakeListeners);
    window.removeEventListener('focus', State._sessionWakeListeners);
    State._sessionWakeListeners = null;
  }
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  toast('Signed out successfully', 'info');
}

async function loadUserInfo() {
  const data = await gapi('GET', 'https://www.googleapis.com/oauth2/v3/userinfo');
  State.user = data;
  document.getElementById('user-name').textContent = data.name || data.email;
  document.getElementById('user-email').textContent = data.email;
  document.getElementById('user-avatar').textContent = (data.name || data.email || '?')[0].toUpperCase();
}

function showPanel(panel, label) {
  State.currentPanel = panel;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  document.getElementById(`panel-${panel}`).classList.add('active');
  const navSelector = label ? `.nav-item[data-label="${label}"]` : `.nav-item[data-panel="${panel}"]`;
  const navBtn = document.querySelector(navSelector);
  if (navBtn) navBtn.classList.add('active');

  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('search-input').value = '';

  // Update the list-pane header to match the selected folder
  const LABEL_NAMES = {
    'INBOX': 'Inbox', 'SENT': 'Sent/Forwarded', 'STARRED': 'Starred',
    'DRAFT': 'Drafts', 'SPAM': 'Spam', 'TRASH': 'Trash',
    'CATEGORY_PROMOTIONS': 'Promotions', 'CATEGORY_SOCIAL': 'Social',
    'CATEGORY_UPDATES': 'Updates', 'CATEGORY_FORUMS': 'Forums'
  };
  const listLabelEl = document.getElementById('list-label');
  if (listLabelEl) {
    listLabelEl.textContent = label ? (LABEL_NAMES[label] || label)
                                    : { mail: 'Inbox', calendar: 'Calendar', contacts: 'Contacts' }[panel] || panel;
  }

  if (panel === 'mail') loadEmails(label || 'INBOX');
  if (panel === 'calendar') loadCalendar();
  if (panel === 'contacts') loadContacts();
}

function refreshCurrent() {
  const active = document.querySelector('.nav-item.active');
  if(active) showPanel(active.dataset.panel, active.dataset.label);
}

async function loadEmails(label, loadMore = false) {
  if (State.mail.isFetching) return;
  State.mail.isFetching = true;
  State.mail.label = label;

  const container = document.getElementById('email-list');
  const btnMore   = document.getElementById('btn-load-more-mail');
  btnMore.style.display = 'none';

  if (!loadMore) {
    State.mail.items = [];
    State.mail.pageToken = null;
    loadingState(container);
    hideEmailDetail();
  }

  const q        = encodeURIComponent(label === 'STARRED' ? 'is:starred' : '');
  const labelId  = label === 'STARRED' ? '' : `&labelIds=${label}`;
  const pageParam = loadMore && State.mail.pageToken ? `&pageToken=${State.mail.pageToken}` : '';
  // #8 — load 100 on initial fetch, 30 for "load more" pages
  const maxResults = loadMore ? 30 : 100;
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${labelId}${pageParam}${q ? '&q=' + q : ''}`;

  try {
    const data = await gapi('GET', url);
    State.mail.pageToken = data.nextPageToken || null;

    if (!data.messages || !data.messages.length) {
      if (!loadMore) emptyState(container, 'No messages here');
      State.mail.isFetching = false;
      return;
    }

    const newMsgs = await Promise.all(data.messages.map(m =>
      gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)
    ));

    State.mail.items = [...State.mail.items, ...newMsgs];
    renderEmailList(newMsgs, !loadMore);
    if (State.mail.pageToken) btnMore.style.display = 'block';

  } catch (err) { toast(`Failed to load mail: ${err.message}`, 'error'); }
  State.mail.isFetching = false;
}

// Silent background poll: checks for new messages every 10 minutes.
// If new ones are found they are prepended to the list without disturbing
// whatever the user has open.
async function pollInbox() {
  // Only poll when actually looking at mail, not calendar/contacts/search
  if (State.currentPanel !== 'mail') return;
  if (State.mail.isFetching)         return;
  if (!State.token)                  return;

  try {
    const label   = State.mail.label;
    const q       = encodeURIComponent(label === 'STARRED' ? 'is:starred' : '');
    const labelId = label === 'STARRED' ? '' : `&labelIds=${label}`;
    const url     = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20${labelId}${q ? '&q=' + q : ''}`;

    const data = await gapi('GET', url);
    if (!data.messages || !data.messages.length) return;

    // Find message IDs that are not already in the list
    const knownIds = new Set(State.mail.items.map(m => m.id));
    const freshIds = data.messages.map(m => m.id).filter(id => !knownIds.has(id));
    if (freshIds.length === 0) return;

    // Fetch metadata for the genuinely new messages
    const freshMsgs = await Promise.all(freshIds.map(id =>
      gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)
    ));

    // ── New-arrival housekeeping ────────────────────────────────────────────────
    // New emails are found: strip the green highlight from the PREVIOUS batch so only
    // the freshest arrivals stay green. If this poll finds nothing, existing green rows
    // are left untouched (they stay green until the next poll that does find new mail).
    const container = document.getElementById('email-list');
    container.querySelectorAll('.new-arrival').forEach(row => row.classList.remove('new-arrival'));

    // Prepend to state and DOM without touching the open email detail
    State.mail.items = [...freshMsgs, ...State.mail.items];
    // Insert new rows at the top, preserving the existing DOM rows below
    const tempFrag = document.createDocumentFragment();
    freshMsgs.forEach(m => {
      const headers  = {};
      (m.payload?.headers || []).forEach(h => headers[h.name] = h.value);
      const isUnread  = m.labelIds?.includes('UNREAD');
      const isStarred = m.labelIds?.includes('STARRED');
      const hasAttachment = (m.payload?.parts || []).some(p => p.filename && p.filename.length > 0)
                         || (m.payload?.mimeType || '').includes('mixed');
      const fromStr   = decodeEntities(decodeRFC2047(fixDoubleEncodedUtf8(headers['From'] || 'Unknown')));
      const ts        = formatTimestamp(headers['Date']);

      const div = el('div', `email-item ${isUnread ? 'unread' : ''} ${isStarred ? 'starred' : ''} new-arrival`);
      div.dataset.msgId = m.id;

      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'email-checkbox';
      cb.addEventListener('change', (e) => { e.stopPropagation(); div.classList.toggle('selected', cb.checked); updateBatchDeleteBtn(); });
      cb.addEventListener('click',  (e) => e.stopPropagation());
      div.appendChild(cb);

      const metaObj = el('div', 'email-meta');
      const displayUser = label === 'SENT'
        ? 'To: ' + (decodeEntities(decodeRFC2047(fixDoubleEncodedUtf8(headers['To'] || ''))).split(',')[0].trim())
        : fromStr.replace(/<[^>]*>/, '').trim() || fromStr;
      const fromSpan = el('span', 'email-from', displayUser);
      if (hasAttachment) {
        const ic = document.createElement('span');
        ic.className = 'email-att-icon';
        ic.title = 'Has attachment';
        ic.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
        fromSpan.appendChild(ic);
      }
      metaObj.append(fromSpan, el('span', 'email-date', ts));

      const subj = decodeEntities(decodeRFC2047(headers['Subject']) || '(no subject)');
      const snip = decodeEntities(decodeRFC2047(m.snippet) || '');
      div.append(metaObj, el('div', 'email-subject', subj), el('div', 'email-snippet', snip));
      div.addEventListener('click', () => openEmail(m, div));
      tempFrag.appendChild(div);
    });

    // Prepend the fragment before the first existing row
    const firstChild = container.firstChild;
    if (firstChild) container.insertBefore(tempFrag, firstChild);
    else            container.appendChild(tempFrag);

    // Green highlight stays until the NEXT poll that delivers new mail (no auto-remove).

    // Subtle toast — don't interrupt with a loud alert
    const count = freshMsgs.length;
    toast(`📬 ${count} new message${count > 1 ? 's' : ''} arrived`, 'success');

    // Update unread badge
    updateUnreadBadge();

  } catch (e) {
    // Silent failure — polls are background work, don't alarm the user
    console.warn('[Aether] Poll failed:', e.message);
  }
}

function startInboxPoll() {
  stopInboxPoll();
  State.pollInterval = setInterval(pollInbox, 10 * 60 * 1000); // every 10 minutes
}

function stopInboxPoll() {
  if (State.pollInterval) {
    clearInterval(State.pollInterval);
    State.pollInterval = null;
  }
}

function updateUnreadBadge() {
  const unreadCount = State.mail.items.filter(m => m.labelIds?.includes('UNREAD')).length;
  const badge = document.getElementById('unread-badge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

// ── Event reminder notifications ───────────────────────────────────────────────
// Independent of which panel (mail/calendar/contacts) is currently open — this
// fetches a small near-term window directly from the Calendar API every 60s so
// reminders fire even if the user never visits the Calendar panel.
const NOTIF_LEAD_MS = 10 * 60 * 1000; // notify 10 minutes before an event starts

function startEventNotifications() {
  stopEventNotifications();
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') State.notificationsEnabled = true;
  State.eventNotifInterval = setInterval(checkUpcomingEvents, 60 * 1000); // every 60 seconds
  checkUpcomingEvents(); // run one check immediately on start
}

function stopEventNotifications() {
  if (State.eventNotifInterval) {
    clearInterval(State.eventNotifInterval);
    State.eventNotifInterval = null;
  }
}

async function checkUpcomingEvents() {
  if (!State.notificationsEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!State.token) return;

  try {
    // Reuse the calendar list if the Calendar panel has already loaded it;
    // otherwise fetch it once here (cheap, cached for subsequent checks).
    if (!State.calendar.calendars.length) {
      const calList = await gapi('GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList');
      State.calendar.calendars = calList.items || [];
    }

    const now      = new Date();
    const windowEnd = new Date(now.getTime() + NOTIF_LEAD_MS);

    const calendars = State.calendar.calendars.filter(c => c.selected !== false);
    const eventLists = await Promise.all(calendars.map(async (c) => {
      try {
        const data = await gapi('GET',
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events` +
          `?timeMin=${now.toISOString()}&timeMax=${windowEnd.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20`
        );
        return (data.items || []).map(e => ({ ...e, calendarName: c.summary }));
      } catch (_) { return []; }
    }));

    const upcoming = eventLists.flat();

    for (const ev of upcoming) {
      if (!ev.id || State.notifiedEventIds.has(ev.id)) continue;
      if (ev.status === 'cancelled') continue;

      const startStr = ev.start?.dateTime || ev.start?.date;
      if (!startStr) continue;
      const startMs = new Date(startStr).getTime();
      const minsUntil = Math.round((startMs - now.getTime()) / 60000);

      // Only notify once the event is within the lead window (≤10 min away,
      // including events starting right now or that just started within 1 min).
      if (minsUntil > 10 || minsUntil < -1) continue;

      State.notifiedEventIds.add(ev.id); // mark before firing so a slow tick can't double-fire

      const title = ev.summary || '(No title)';
      const whenLabel = minsUntil <= 0 ? 'Starting now' : `Starts in ${minsUntil} min`;
      const bodyLines = [whenLabel];
      if (ev.location) bodyLines.push(ev.location);
      if (ev.calendarName) bodyLines.push(ev.calendarName);

      try {
        const notif = new Notification(title, {
          body: bodyLines.join(' · '),
          tag: 'aether-event-' + ev.id, // de-dupes at the OS level too
        });
        notif.onclick = () => {
          window.focus();
          showPanel('calendar');
          notif.close();
        };
      } catch (e) { console.warn('[Aether] Notification failed:', e.message); }
    }

    // Housekeeping: drop notified IDs for events whose start time has long passed,
    // so the Set doesn't grow unbounded over a long session.
    if (State.notifiedEventIds.size > 200) {
      State.notifiedEventIds.clear();
    }
  } catch (e) {
    console.warn('[Aether] Event notification check failed:', e.message);
  }
}

async function searchEmails(query) {
  if (!query.trim()) return renderEmailList(State.mail.items, true);
  const container = document.getElementById('email-list');
  loadingState(container);
  try {
    const data = await gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${encodeURIComponent(query)}`);
    if (!data.messages) return emptyState(container, 'No results');
    const msgs = await Promise.all(data.messages.map(m => gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)));
    renderEmailList(msgs, true);
  } catch (e) { toast('Search failed', 'error'); }
}

function updateBatchDeleteBtn() {
  const btn = document.getElementById('btn-batch-delete');
  const checked = document.querySelectorAll('.email-checkbox:checked');
  btn.classList.toggle('visible', checked.length > 0);
}

function renderEmailList(msgs, clearFirst) {
  const container = document.getElementById('email-list');
  if (clearFirst) container.innerHTML = '';

  msgs.forEach(m => {
    const headers = {};
    (m.payload?.headers || []).forEach(h => headers[h.name] = h.value);
    const isUnread = m.labelIds && m.labelIds.includes('UNREAD');
    
    const rawTo = headers['To'] || 'Unknown';
    const toStr = decodeEntities(decodeRFC2047(fixDoubleEncodedUtf8(rawTo)));
    const fromStr = decodeEntities(decodeRFC2047(fixDoubleEncodedUtf8(headers['From'] || 'Unknown')));

    let sentTo = toStr;
    const firstRecipientMatch = toStr.match(/^"?([^"<,]+)"?\s*</) || toStr.match(/^([^<,]+)/);
    if (firstRecipientMatch) sentTo = firstRecipientMatch[1].trim().replace(/^"|"$/g, '');
    if (!sentTo) sentTo = toStr.split(',')[0].trim();
    let displayUser = State.mail.label === 'SENT' ? 'To: ' + sentTo : fromStr.replace(/<[^>]*>/, '').trim() || fromStr;
    const ts = formatTimestamp(headers['Date']);

    const isStarred = m.labelIds && m.labelIds.includes('STARRED');
    // Detect attachments: payload.parts with filenames (available in metadata format)
    // Falls back to mimeType heuristic if parts aren't present.
    const hasAttachment = (m.payload?.parts || []).some(p => p.filename && p.filename.length > 0)
                       || (m.payload?.mimeType || '').includes('mixed');
    const div = el('div', `email-item ${isUnread ? 'unread' : ''} ${isStarred ? 'starred' : ''}`);
    div.dataset.msgId = m.id;

    // Fix 19: Checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'email-checkbox';
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      div.classList.toggle('selected', cb.checked);
      updateBatchDeleteBtn();
    });
    cb.addEventListener('click', (e) => e.stopPropagation());
    div.appendChild(cb);

    const metaObj = el('div', 'email-meta');
    const fromSpan = el('span', 'email-from', displayUser);
    if (hasAttachment) {
      const ic = document.createElement('span');
      ic.className = 'email-att-icon';
      ic.title = 'Has attachment';
      ic.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
      fromSpan.appendChild(ic);
    }
    metaObj.append(fromSpan, el('span', 'email-date', ts));
    
    const subj = decodeEntities(decodeRFC2047(headers['Subject']) || '(no subject)');
    const snip = decodeEntities(decodeRFC2047(m.snippet) || '');
    
    div.append(metaObj, el('div', 'email-subject', subj), el('div', 'email-snippet', snip));
    div.addEventListener('click', () => openEmail(m, div));
    container.appendChild(div);
  });
}

async function openEmail(msgMeta, elNode) {
  document.querySelectorAll('.email-item').forEach(e => e.classList.remove('active'));
  elNode.classList.add('active');
  State.compose.currentEmailId = msgMeta.id;
  State.compose.currentThreadId = msgMeta.threadId;

  document.getElementById('email-detail-panel').classList.add('open');
  document.getElementById('detail-empty').style.display = 'none';
  document.getElementById('email-viewer').style.display = 'flex';
  document.getElementById('email-action-bar').style.display = 'none';
  document.getElementById('reply-section').style.display = 'none';
  
  toggleReply(true); 
  loadingState(document.getElementById('email-viewer'));

  try {
    const msg = await gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgMeta.id}?format=full`);
    await renderEmail(msg);
    if (msg.labelIds?.includes('UNREAD')) {
      gapi('POST', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgMeta.id}/modify`, { removeLabelIds:['UNREAD'] }).catch(()=>{});
      elNode.classList.remove('unread');
    }
  } catch (err) { toast(err.message, 'error'); }
}

function getEmailHtml(payload) {
  let res = { type: 'text/plain', data: '' };

  // Extract charset from a Content-Type header value, e.g. "text/html; charset=iso-8859-2"
  function extractCharset(headers) {
    const ct = (headers || []).find(h => h.name.toLowerCase() === 'content-type');
    if (!ct) return null;
    const m = ct.value.match(/charset\s*=\s*["']?([^\s;"']+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  // Extract charset from <meta> tags in raw HTML bytes (scanned as latin-1 since ASCII range is same)
  function extractMetaCharset(bytes) {
    // Read enough of the bytes as latin-1 to find the <head> section
    const head = new TextDecoder('latin-1').decode(bytes.slice(0, 4096));
    // <meta charset="iso-8859-2">
    let m = head.match(/<meta[^>]+charset=["']?([^"';\s>]+)/i);
    if (m) return m[1].toLowerCase();
    // <meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">
    m = head.match(/charset=["']?([^"';\s>]+)/i);
    if (m) return m[1].toLowerCase();
    return null;
  }

  // Decode base64url body data respecting the part's charset.
  // ROBUST STRATEGY: rather than guessing which single theory of Gmail's behaviour
  // applies (transcoded-to-UTF-8-but-mislabeled vs. genuinely-legacy-encoded), try
  // EVERY plausible decoding (UTF-8, the declared/detected charset, and the most
  // common email charsets) and score each result for mojibake artifacts. The
  // candidate with the fewest artifacts wins. This correctly handles BOTH known
  // corruption families:
  //   • UTF-8 bytes wrongly read as Windows-1252/Latin-1   → marker character 'Ã'
  //   • UTF-8 bytes wrongly read as ISO-8859-2/Windows-1250 → marker character 'Ă'
  // and is immune to being wrong about which one applies to a given message.
  function garbageScore(s) {
    if (!s) return 999;
    let score = 0;
    score += (s.match(/Ã/g)      || []).length * 3;  // cp1252/latin1-style mojibake marker
    score += (s.match(/Ă/g)      || []).length * 3;  // iso-8859-2/windows-1250-style marker
    score += (s.match(/Â/g)      || []).length * 2;  // common companion artifact
    score += (s.match(/\uFFFD/g) || []).length * 5;   // replacement char — definitely wrong
    score += (s.match(/[\x00-\x08\x0B\x0E-\x1F]/g) || []).length * 4; // stray control chars
    return score;
  }

  function decodeBytesSmart(bytes, declaredCharset) {
    const tried = new Set();
    const candidates = [];

    function tryEnc(enc) {
      if (!enc || tried.has(enc)) return;
      tried.add(enc);
      try { candidates.push({ enc, text: new TextDecoder(enc, { fatal: true }).decode(bytes) }); }
      catch (_) {}
    }

    const aliases = {
      'iso-8859-2':'iso-8859-2', 'latin2':'iso-8859-2',
      'iso-8859-1':'iso-8859-1', 'latin1':'iso-8859-1',
      'windows-1250':'windows-1250', 'cp1250':'windows-1250',
      'windows-1252':'windows-1252', 'cp1252':'windows-1252',
      'windows-1251':'windows-1251', 'cp1251':'windows-1251',
      'koi8-r':'koi8-r',
    };

    tryEnc('utf-8');                                            // always try first — modern default
    if (declaredCharset) tryEnc(aliases[declaredCharset] || declaredCharset); // whatever the header says
    tryEnc('windows-1250'); tryEnc('iso-8859-2');                // common Central-European fallbacks
    tryEnc('windows-1252'); tryEnc('iso-8859-1');                // common Western-European fallbacks

    // Also test the cp1252-double-decode reversal of the UTF-8 candidate, in case
    // it's triple-encoded (rare, but the existing header-decode logic already
    // handles this case, so we reuse it here for free).
    const utf8Candidate = candidates.find(c => c.enc === 'utf-8');
    if (utf8Candidate) {
      const fixed = fixDoubleEncodedUtf8(utf8Candidate.text);
      if (fixed !== utf8Candidate.text) candidates.push({ enc: 'utf-8+fix', text: fixed });
    }

    if (!candidates.length) return new TextDecoder('utf-8').decode(bytes); // last resort

    candidates.forEach(c => c.score = garbageScore(c.text));
    candidates.sort((a, b) => a.score - b.score);

    // Diagnostic: only logs when charset actually mattered (multiple real candidates),
    // so this stays silent for the common, unambiguous case. Check DevTools Console
    // (F12) for this exact line — if it never appears, the browser is running an
    // OLD cached copy of this file, not this version.
    if (candidates.length > 1) {
      console.log('[Aether v4.2] body decode candidates:',
        candidates.map(c => `${c.enc}(score:${c.score})`).join(', '),
        '→ chose:', candidates[0].enc);
    }

    return candidates[0].text;
  }

  function decodePartBody(data, charset) {
    if (!data) return '';
    const b64 = (data || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    let padded = b64;
    while (padded.length % 4) padded += '=';
    try {
      const bin = atob(padded);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (!charset) charset = extractMetaCharset(bytes);
      return decodeBytesSmart(bytes, charset);
    } catch(e) {
      return decodeB64(data); // original fallback
    }
  }

  function walk(part) {
    if (!part) return;
    const charset = extractCharset(part.headers);
    if (part.mimeType === 'text/html' && part.body?.data) {
      res = { type: 'text/html', data: decodePartBody(part.body.data, charset) };
      return true;
    }
    if (part.mimeType === 'text/plain' && part.body?.data && res.data === '') {
      res = { type: 'text/plain', data: decodePartBody(part.body.data, charset) };
    }
    if (part.parts) for (const p of part.parts) if (walk(p)) return true;
  }

  if (payload.body?.data && !payload.parts) {
    const charset = extractCharset(payload.headers);
    res.data = decodePartBody(payload.body.data, charset);
    res.type = payload.mimeType === 'text/html' ? 'text/html' : 'text/plain';
  } else {
    walk(payload);
  }
  return res;
}

function getAttachmentsAndInlines(payload) {
  const atts = [];
  const inlines =[];

  function walk(part) {
    if (!part) return;

    const mimeType = part.mimeType || '';
    const headers = part.headers ||[];

    // Recurse into children if it's a multipart container
    if (mimeType.startsWith('multipart/')) {
      if (part.parts) part.parts.forEach(walk);
      return;
    }

    let filename = part.filename || '';
    
    // Fallback: Try to get filename from Content-Disposition or Content-Type
    const dispHeader = headers.find(h => h.name.toLowerCase() === 'content-disposition');
    if (!filename && dispHeader) {
      const match = dispHeader.value.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (match) filename = match[1].trim();
    }
    const typeHeader = headers.find(h => h.name.toLowerCase() === 'content-type');
    if (!filename && typeHeader) {
      const match = typeHeader.value.match(/name\s*=\s*"?([^";]+)"?/i);
      if (match) filename = match[1].trim();
    }

    // Decode RFC2047 filename
    if (filename) filename = decodeRFC2047(filename).replace(/(^"|"$)/g, '').trim();

    const cidHeader = headers.find(h => h.name.toLowerCase() === 'content-id');
    const hasAttachmentId = !!(part.body && part.body.attachmentId);

    // Content-Disposition: attachment wins over Content-ID (Outlook sends both)
    const isExplicitAttachment = /^\s*attachment/i.test(dispHeader?.value || '');

    const isTextOrHtml = mimeType === 'text/plain' || mimeType === 'text/html';
    const isBodyContainer = isTextOrHtml && !filename && !hasAttachmentId;

    if (!isBodyContainer) {
      const item = {
        filename: filename || 'Unnamed_File',
        attachmentId: part.body?.attachmentId,
        data: part.body?.data,
        size: part.body?.size || 0,
        mime: mimeType
      };

      // If explicitly marked as attachment (even with CID), treat as attachment
      if (cidHeader && !isExplicitAttachment) {
        item.id = cidHeader.value.replace(/[<>]/g, '');
        inlines.push(item);
      } else if (filename || hasAttachmentId || isExplicitAttachment) {
        atts.push(item);
      }
    }
    
    if (part.parts) part.parts.forEach(walk);
  }
  
  walk(payload);
  return { atts, inlines };
}

async function renderEmail(msg) {
  const viewer = document.getElementById('email-viewer');
  viewer.innerHTML = ''; 
  
  const headers = {};
  (msg.payload?.headers || []).forEach(h => headers[h.name] = decodeRFC2047(fixDoubleEncodedUtf8(h.value)));

  const headerSec = el('div', 'email-header-section');
  const dateLabel = State.mail.label === 'SENT' ? 'Date sent' : 'Date received';
  
  headerSec.append(
    el('div', 'email-title', decodeEntities(headers['Subject']) || '(no subject)'),
    buildMetaRow('From', decodeEntities(headers['From'] || 'Unknown')),
    buildMetaRow('To', decodeEntities(headers['To'] || '')),
    buildMetaRow(dateLabel, formatTimestamp(headers['Date']))
  );

  const scrollWrapper = el('div', 'email-scroll-wrapper');
  const bodyObj = getEmailHtml(msg.payload);
  let htmlData = bodyObj.data;
  
  const { atts, inlines } = getAttachmentsAndInlines(msg.payload);

  // Fix 7: Render attachments ABOVE the email body
  if (atts.length > 0) {
    const attContainer = el('div', 'attachments');
    attContainer.appendChild(el('div', 'attachments-title', `📎 Attachments (${atts.length})`));
    const chips = el('div', 'attachment-chips');
    
    atts.forEach(a => {
      const chip = el('div', 'attachment-chip');
      const thumbArea = el('div', 'attachment-thumb-area');
      const infoArea = el('div', 'attachment-info');
      
      infoArea.append(el('span', 'chip-name', a.filename), el('span', 'chip-size', formatBytes(a.size)));
      
      if (a.mime && a.mime.startsWith('image/')) {
        const img = el('img', 'attachment-thumb');
        thumbArea.appendChild(img);
        if (a.data) {
          img.src = `data:${a.mime};base64,${padB64(a.data)}`;
        } else if (a.attachmentId) {
          gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${a.attachmentId}`)
            .then(data => { img.src = `data:${a.mime};base64,${padB64(data.data)}`; })
            .catch(() => { img.src = ''; }); 
        }
      } else {
        thumbArea.textContent = getFileIcon(a.mime, a.filename);
      }
      
      chip.append(thumbArea, infoArea);
      // Open a preview modal for supported types; download everything else.
      // Legacy .doc and .ppt can't be rendered — they show a "not supported" message with Download.
      const previewExts = [
        'pdf',
        'docx','docm',
        'xlsx','xls','xlsm',
        'pptx',
        'zip','rar','7z','tar','gz','bz2','cab','iso',
        'txt','csv','log','md','json','xml',
        'html','htm',
        'jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff',
        'mp4','webm','mov','avi','mkv','ogv','m4v',
        'mp3','wav','ogg','aac','flac','m4a','opus',
        'doc','ppt'
      ];
      const ext = (a.filename.split('.').pop() || '').toLowerCase();
      const isPreviewable = previewExts.includes(ext) ||
        ['application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-word.document.macroEnabled.12',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-excel.sheet.macroEnabled.12',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ].includes(a.mime)
        || (a.mime || '').startsWith('image/')
        || (a.mime || '').startsWith('video/')
        || (a.mime || '').startsWith('audio/')
        || (a.mime || '').startsWith('text/');
      chip.onclick = () => isPreviewable
        ? previewAttachment(msg.id, a.attachmentId, a.filename, a.mime, a.data)
        : downloadAttachment(msg.id, a.attachmentId, a.filename, a.data, a.mime);
      chips.appendChild(chip);
    });
    
    attContainer.appendChild(chips);
    scrollWrapper.appendChild(attContainer);
  }

  for (const inline of inlines) {
    if (htmlData.includes(`cid:${inline.id}`)) {
      try {
        let base64 = '';
        if (inline.data) {
          base64 = padB64(inline.data);
        } else if (inline.attachmentId) {
          const data = await gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${inline.attachmentId}`);
          base64 = padB64(data.data);
        }
        if (base64) {
          // Robust replacement without breaking on special regex characters
          htmlData = htmlData.split(`cid:${inline.id}`).join(`data:${inline.mime};base64,${base64}`);
        }
      } catch (e) { }
    }
  }

let cleanHtml = htmlData;
  if (bodyObj.type === 'text/plain') {
    htmlData = escHtml(htmlData).replace(/\r?\n/g, '<br>');
    htmlData = htmlData.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:var(--accent);">$1</a>');
    cleanHtml = htmlData;
  } else {
    const bodyMatch = htmlData.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) cleanHtml = bodyMatch[1];
  }

  State.reply.originalHtml = cleanHtml;
  State.reply.originalFrom = decodeEntities(headers['From'] || 'Unknown');
  State.reply.originalDate = headers['Date'] || '';

  // Smart external image handling: block only true tracking pixels, allow legitimate content
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlData, 'text/html');
  let hasBlockedImages = false;
  const blockedLog = [];
  const allowedLog = [];

  doc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (!src || !/^https?:\/\//i.test(src)) return; // skip inline data: and cid: already resolved

    const alt = img.getAttribute('alt') || '';
    const widthAttr  = parseInt(img.getAttribute('width')  || img.style.width  || '0', 10);
    const heightAttr = parseInt(img.getAttribute('height') || img.style.height || '0', 10);
    const displayStyle = (img.getAttribute('style') || '').toLowerCase();
    const sizeLabel = `${img.getAttribute('width') || '?'}x${img.getAttribute('height') || '?'}`;

    // Classify as tracking pixel if ANY of these conditions are true:
    const isTiny       = (widthAttr > 0 && widthAttr <= 3) || (heightAttr > 0 && heightAttr <= 3);
    const isZero       = widthAttr === 0 || heightAttr === 0;
    const isHidden     = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/.test(displayStyle);
    const isNoAltTiny  = alt === '' && (widthAttr <= 3 || heightAttr <= 3);
    // URLs that are clearly analytics/tracking endpoints (not CDN static assets)
    // Be careful not to block legitimate CDN images that have tracking query params (?u=...)
    // We only block if the PATH SEGMENT itself is a known tracker endpoint
    const trackingUrlPatterns = /\/(pixel|track|open|beacon|wf\/open|trk|t\.gif|spacer\.gif|blank\.gif|1x1|count\.gif)([\/?]|$)/i;
    const isTrackingUrl = trackingUrlPatterns.test(src.split('?')[0]); // check path only, not query string

    const isTracker = isTiny || isZero || isHidden || isNoAltTiny || isTrackingUrl;

    if (isTracker) {
      // Block: replace with invisible placeholder, preserve data-blocked-src for "show images"
      hasBlockedImages = true;
      let reason = 'Suspected tracking pixel';
      if (isTiny || isZero)  reason = `Tracking pixel — tiny size (${sizeLabel})`;
      if (isHidden)          reason = 'Hidden image (display:none / visibility:hidden)';
      if (isTrackingUrl)     reason = 'Tracking endpoint URL pattern matched';
      blockedLog.push({ url: src, alt: alt || '(no alt)', size: sizeLabel, reason });

      img.setAttribute('data-blocked-src', src);
      img.removeAttribute('src');
      img.setAttribute('src', 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"%3E%3C/svg%3E');
      img.style.display = 'none'; // fully invisible, not a grey box
    } else {
      // Allow: legitimate content image (logo, icon, profile photo, banner)
      allowedLog.push({ url: src, alt: alt || '(no alt)', size: sizeLabel });
      // Leave src intact — image loads normally inside the iframe sandbox
    }
  });

  // Console report — always show, grouped by category
  const totalExternal = blockedLog.length + allowedLog.length;
  if (totalExternal > 0) {
    const subject = decodeEntities(headers['Subject']) || '(no subject)';
    console.group(`🛡️ Aether — ${totalExternal} external image(s) in: "${subject}"`);

    if (blockedLog.length > 0) {
      console.group(`🚫 Blocked as trackers (${blockedLog.length})`);
      blockedLog.forEach((e, i) => {
        console.group(`Tracker #${i + 1}`);
        console.log('URL:   ', e.url);
        console.log('Alt:   ', e.alt);
        console.log('Size:  ', e.size);
        console.warn('Reason:', e.reason);
        console.groupEnd();
      });
      console.groupEnd();
    }

    if (allowedLog.length > 0) {
      console.group(`✅ Allowed as content images (${allowedLog.length})`);
      allowedLog.forEach((e, i) => {
        console.group(`Content #${i + 1}`);
        console.log('URL:   ', e.url);
        console.log('Alt:   ', e.alt);
        console.log('Size:  ', e.size);
        console.groupEnd();
      });
      console.groupEnd();
    }

    console.groupEnd();
  }

  let safeHtml = doc.documentElement.innerHTML;
  if (!/<base\s/i.test(safeHtml)) {
     if (/<head[^>]*>/i.test(safeHtml)) {
         safeHtml = safeHtml.replace(/(<head[^>]*>)/i, '$1<base target="_blank">');
     } else {
         safeHtml = '<base target="_blank">' + safeHtml;
     }
  }

  // Build the unblocked version: restore data-blocked-src back to src, remove hidden styles
  const unblockedHtml = safeHtml
    .replace(/\s*src="data:image\/svg\+xml[^"]*"/g, '')
    .replace(/data-blocked-src="/g, 'src="')
    .replace(/style="display: none;"\s*/g, '');

  function loadIframeHtml(iframe, html) {
    const prev = iframe._blobUrl;
    // Include a permissive meta so the iframe can load external images
    const fullHtml = html.includes('<!DOCTYPE') ? html : '<!DOCTYPE html>' + html;
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    iframe._blobUrl = url;
    iframe.src = url;
    if (prev) setTimeout(() => URL.revokeObjectURL(prev), 5000);
  }

  const bodyContainer = el('div', 'email-body');
  if (bodyObj.type === 'text/html') {
    const iframe = el('iframe', '', '', {
      style: 'width:100%; min-height:300px; height:600px; border:1px solid var(--border); background:#fff; border-radius:8px; flex-shrink:0;'
    });
    loadIframeHtml(iframe, safeHtml);
    bodyContainer.appendChild(iframe);
  } else {
    bodyContainer.innerHTML = htmlData;
    bodyContainer.style.whiteSpace = 'pre-wrap';
  }
  scrollWrapper.appendChild(bodyContainer);

  if (hasBlockedImages) {
    const banner = el('div', 'image-block-banner', '', {
      style: 'background: var(--surface2); padding: 10px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--text2); margin-bottom: 16px; border-radius: 8px;'
    });
    const trackerCount = blockedLog.length;
    const contentCount = allowedLog.length;
    const msgText = el('span', '', `🛡️ ${trackerCount} tracking pixel${trackerCount!==1?'s':''} hidden.${contentCount > 0 ? ` ${contentCount} content image${contentCount!==1?'s':''} loading normally.` : ''}`);
    const btnShow = el('button', 'action-btn', 'Load all images', { style: 'font-weight: 500;' });
    btnShow.onclick = () => {
      const iframe = bodyContainer.querySelector('iframe');
      if (iframe) loadIframeHtml(iframe, unblockedHtml);
      banner.remove();
    };
    banner.append(msgText, btnShow);
    headerSec._pendingBanner = banner;
  }

  viewer.append(headerSec, scrollWrapper);
  // Now headerSec is in the DOM — insert the image banner right after it
  if (headerSec._pendingBanner) {
    headerSec.insertAdjacentElement('afterend', headerSec._pendingBanner);
    delete headerSec._pendingBanner;
  }

  const actionBar = document.getElementById('email-action-bar');
  actionBar.innerHTML = '';
  
  const btnReply = el('button', 'action-btn primary', '↩ Reply');
  btnReply.onclick = () => toggleReply(false);
  
  const btnFwd = el('button', 'action-btn', '↗ Forward');
  btnFwd.onclick = () => confirmAction('Forward Message', 'Would you like to forward this message?', 'Forward', async () => {
    let forwardFiles =[];
    if (atts.length > 0) {
      toast('Fetching attachments...', 'info');
      try {
        for (const a of atts) {
          let b64str;
          if (a.data) {
            b64str = padB64(a.data);
          } else if (a.attachmentId) {
            const data = await gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${a.attachmentId}`);
            b64str = padB64(data.data);
          }
          if (b64str) {
            const bytes = atob(b64str);
            const arr = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
            const file = new File([arr], a.filename, { type: a.mime || 'application/octet-stream' });
            forwardFiles.push(file);
          }
        }
      } catch(e) { toast('Error loading some attachments', 'error'); }
    }

    const fwdHeader = `<br><br><div style="font-family: var(--font); padding-left: 8px; border-left: 2px solid var(--border); margin-left: 4px; color: var(--text2);">
      ---------- Forwarded message ---------<br>
      <b>From:</b> ${escHtml(State.reply.originalFrom)}<br>
      <b>Date:</b> ${escHtml(State.reply.originalDate)}<br>
      <b>Subject:</b> ${escHtml(decodeEntities(headers['Subject']) || '')}<br>
      <b>To:</b> ${escHtml(decodeEntities(headers['To'] || ''))}<br>
    </div><br>`;

    const bodyStr = fwdHeader + cleanHtml;
    openComposeModal('', 'Fwd: ' + decodeEntities(headers['Subject'] || ''), bodyStr, 'Forward Message', true);
    
    State.compose.attachments = forwardFiles;
    renderAttachmentChips('compose');
  });
  
  let currentStarred = msg.labelIds?.includes('STARRED');
  const btnStar = el('button', 'action-btn', currentStarred ? '★ Unstar' : '☆ Star');
  btnStar.onclick = async () => {
    const origText = btnStar.textContent;
    btnStar.disabled = true; btnStar.textContent = 'Wait...';
    try {
      await gapi('POST', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`, currentStarred ? { removeLabelIds:['STARRED'] } : { addLabelIds:['STARRED'] });
      currentStarred = !currentStarred;
      toast(currentStarred ? 'Starred successfully' : 'Unstarred successfully', 'success');
      btnStar.textContent = currentStarred ? '★ Unstar' : '☆ Star';
    } catch(e) { toast('Failed to update star: ' + e.message, 'error'); btnStar.textContent = origText; }
    finally { btnStar.disabled = false; }
  };
  
  const btnArchive = el('button', 'action-btn', '📦 Archive');
  btnArchive.onclick = async () => {
    const origText = btnArchive.textContent;
    btnArchive.disabled = true; btnArchive.textContent = 'Wait...';
    try {
      await gapi('POST', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`, { removeLabelIds:['INBOX'] });
      toast('Archived successfully', 'success'); refreshCurrent();
    } catch(e) { toast('Failed to archive: ' + e.message, 'error'); btnArchive.textContent = origText; btnArchive.disabled = false; }
  };
  
  const btnUnread = el('button', 'action-btn', '✉ Mark Unread');
  btnUnread.onclick = async () => {
    const origText = btnUnread.textContent;
    btnUnread.disabled = true; btnUnread.textContent = 'Wait...';
    try {
      await gapi('POST', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`, { addLabelIds:['UNREAD'] });
      toast('Marked as unread', 'success');
      document.getElementById('email-detail-panel').classList.remove('open');
      hideEmailDetail();
      refreshCurrent();
    } catch(e) { 
      toast('Failed to mark unread: ' + e.message, 'error'); 
      btnUnread.textContent = origText; 
      btnUnread.disabled = false; 
    }
  };

  const btnTrash = el('button', 'action-btn', '🗑 Delete', { style: 'color:var(--red)' });
  btnTrash.onclick = () => confirmAction('Delete Message', 'Are you sure you want to move this message to trash?', 'Delete', async () => {
    const origText = btnTrash.textContent;
    btnTrash.disabled = true; btnTrash.textContent = 'Wait...';
    try {
      await gapi('POST', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/trash`);
      toast('Moved to trash successfully', 'success'); refreshCurrent();
    } catch(e) { toast('Failed to delete: ' + e.message, 'error'); btnTrash.textContent = origText; btnTrash.disabled = false; }
  }, true);
  
  actionBar.append(btnReply, btnFwd, btnStar, btnArchive, btnUnread, btnTrash);
  actionBar.style.display = 'flex';
  document.getElementById('reply-section').style.display = 'block';
}

function buildMetaRow(lbl, val) {
  const r = el('div', 'email-meta-row');
  r.append(el('span', 'email-meta-label', lbl), el('span', 'email-meta-val', val));
  return r;
}

function hideEmailDetail() {
  document.getElementById('detail-empty').style.display = 'flex';
  document.getElementById('email-viewer').style.display = 'none';
  document.getElementById('email-action-bar').style.display = 'none';
  document.getElementById('reply-section').style.display = 'none';
}

async function downloadAttachment(msgId, attId, filename, inlineData, mimeType) {
  toast('Downloading…', 'info');
  try {
    let b64str = '';
    if (inlineData) {
      b64str = padB64(inlineData);
    } else {
      const data = await gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${attId}`);
      b64str = padB64(data.data);
    }
    const bytes = atob(b64str);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: mimeType || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  } catch(e) { 
    toast('Error downloading attachment', 'error'); 
    console.error("Attachment Download Error:", e);
  }
}

// ── File preview modal: PDF (iframe), DOCX (mammoth.js), XLSX (SheetJS) ──────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load: ' + src));
    document.head.appendChild(s);
  });
}

async function previewAttachment(msgId, attId, filename, mimeType, inlineData) {
  const modal   = document.getElementById('file-preview-modal');
  const bodyEl  = document.getElementById('file-preview-body');
  const titleEl = document.getElementById('file-preview-title');

  titleEl.textContent = filename;
  bodyEl.innerHTML = '<div class="loading-spinner" style="background:var(--bg);flex:1;display:flex;align-items:center;justify-content:center;gap:10px;color:var(--text2);"><div class="spinner"></div> Loading preview…</div>';
  modal.classList.add('open');

  if (modal._blobUrl) { URL.revokeObjectURL(modal._blobUrl); modal._blobUrl = null; }
  if (window._xlsxWb) { window._xlsxWb = null; }

  document.getElementById('file-preview-download').onclick = () =>
    downloadAttachment(msgId, attId, filename, inlineData, mimeType);

  try {
    let b64str = '';
    if (inlineData) {
      b64str = padB64(inlineData);
    } else {
      const data = await gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${attId}`);
      b64str = padB64(data.data);
    }
    const byteStr = atob(b64str);
    const bytes   = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);

    const ext  = (filename.split('.').pop() || '').toLowerCase();
    const mime = (mimeType || '').toLowerCase();

    function makeBlobUrl(type) {
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      modal._blobUrl = url;
      return url;
    }

    // ── PDF ──────────────────────────────────────────────────────────────────
    if (ext === 'pdf' || mime === 'application/pdf') {
      bodyEl.innerHTML = `<iframe src="${makeBlobUrl('application/pdf')}#view=FitH" style="width:100%;height:100%;border:none;"></iframe>`;

    // ── Images ───────────────────────────────────────────────────────────────
    } else if (['jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff','tif'].includes(ext) || mime.startsWith('image/')) {
      const url = makeBlobUrl(mime.startsWith('image/') ? mime : 'image/' + ext);
      bodyEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;flex:1;padding:20px;background:var(--bg);min-height:0;">
        <img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;" alt="${escHtml(filename)}">
      </div>`;

    // ── Video ─────────────────────────────────────────────────────────────────
    } else if (['mp4','webm','ogv','mov','avi','mkv','m4v'].includes(ext) || mime.startsWith('video/')) {
      const url = makeBlobUrl(mime.startsWith('video/') ? mime : 'video/' + ext);
      bodyEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;flex:1;padding:20px;background:#000;">
        <video controls style="max-width:100%;max-height:100%;outline:none;" src="${url}">Your browser does not support this video format.</video>
      </div>`;

    // ── Audio ─────────────────────────────────────────────────────────────────
    } else if (['mp3','wav','ogg','aac','flac','m4a','opus','wma'].includes(ext) || mime.startsWith('audio/')) {
      const url = makeBlobUrl(mime.startsWith('audio/') ? mime : 'audio/' + ext);
      bodyEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:48px 32px;gap:24px;background:var(--bg);">
        <div style="font-size:64px;line-height:1;">🎵</div>
        <div style="color:var(--text);font-size:15px;font-weight:500;text-align:center;">${escHtml(filename)}</div>
        <audio controls src="${url}" style="width:100%;max-width:520px;"></audio>
      </div>`;

    // ── Plain text / CSV / Markdown / Log ─────────────────────────────────────
    } else if (['txt','csv','log','md','json','xml','yaml','yml'].includes(ext) || mime.startsWith('text/plain')) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      bodyEl.innerHTML = `<pre class="file-preview-content txt-content">${escHtml(text)}</pre>`;

    // ── HTML ──────────────────────────────────────────────────────────────────
    } else if (['html','htm'].includes(ext) || mime === 'text/html') {
      bodyEl.innerHTML = `<iframe src="${makeBlobUrl('text/html')}" sandbox="allow-same-origin allow-scripts" style="width:100%;height:100%;border:none;"></iframe>`;

    // ── DOCX / DOCM ───────────────────────────────────────────────────────────
    } else if (['docx','docm'].includes(ext) || mime.includes('wordprocessingml')) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
      const options = {
        convertImage: mammoth.images.imgElement(img =>
          img.read('base64').then(data => ({ src: 'data:' + img.contentType + ';base64,' + data }))
        ),
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Title'] => h1.doc-title:fresh",
          "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
          "p[style-name='Quote'] => blockquote:fresh",
          "p[style-name='Intense Quote'] => blockquote:fresh",
        ]
      };
      const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer }, options);
      bodyEl.innerHTML = `<div class="file-preview-content docx-content">${result.value}</div>`;

    // ── XLSX / XLS / XLSM ────────────────────────────────────────────────────
    } else if (['xlsx','xls','xlsm'].includes(ext) || mime.includes('spreadsheetml') || mime.includes('ms-excel')) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      window._xlsxWb = XLSX.read(bytes, { type: 'array' });
      const wb = window._xlsxWb;
      const sheetTabs = wb.SheetNames.length > 1
        ? `<div class="xlsx-tabs">${wb.SheetNames.map((n, i) =>
            `<button class="xlsx-tab${i===0?' active':''}" onclick="
              this.parentNode.querySelectorAll('.xlsx-tab').forEach(b=>b.classList.remove('active'));
              this.classList.add('active');
              this.closest('.xlsx-content').querySelector('.xlsx-table-wrap').innerHTML=
                XLSX.utils.sheet_to_html(window._xlsxWb.Sheets[window._xlsxWb.SheetNames[${i}]]);
            ">${escHtml(n)}</button>`).join('')}</div>` : '';
      const html = XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]);
      bodyEl.innerHTML = `<div class="file-preview-content xlsx-content">${sheetTabs}<div class="xlsx-table-wrap">${html}</div></div>`;

    // ── PPTX — full positioned canvas renderer with images ───────────────────
    } else if (ext === 'pptx' || mime.includes('presentationml.presentation')) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      const slidesHtml = await renderPptxSlides(bytes);
      bodyEl.innerHTML = `<div class="file-preview-content pptx-content">${slidesHtml}</div>`;

    // ── ZIP — list contents with per-file extract ─────────────────────────────
    } else if (['zip'].includes(ext) || mime === 'application/zip' || mime === 'application/x-zip-compressed') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      const zip = await JSZip.loadAsync(bytes.buffer);

      const entries = [];
      zip.forEach((path, file) => entries.push({ path, file, isDir: file.dir, size: file._data?.uncompressedSize || 0, date: file.date }));
      entries.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.path.localeCompare(b.path)));

      const fileCount = entries.filter(e => !e.isDir).length;
      const dirCount  = entries.filter(e =>  e.isDir).length;
      const totalSize = entries.reduce((s, e) => s + (e.isDir ? 0 : (e.size || 0)), 0);

      function fmtSize(n) {
        if (!n || n < 1) return '0 B';
        if (n < 1024)       return n + ' B';
        if (n < 1048576)    return (n / 1024).toFixed(1) + ' KB';
        if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
        return (n / 1073741824).toFixed(2) + ' GB';
      }

      const EXT_ICONS = {
        pdf:'📕', jpg:'🖼', jpeg:'🖼', png:'🖼', gif:'🖼', svg:'🖼', webp:'🖼', bmp:'🖼',
        mp4:'🎬', avi:'🎬', mkv:'🎬', mov:'🎬', webm:'🎬',
        mp3:'🎵', wav:'🎵', flac:'🎵', aac:'🎵', ogg:'🎵',
        doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📊', pptx:'📊',
        zip:'🗜', rar:'🗜', '7z':'🗜', tar:'🗜', gz:'🗜',
        html:'🌐', css:'🎨', js:'⚙', ts:'⚙', json:'⚙',
        txt:'📄', md:'📄', csv:'📄', xml:'📄', log:'📄',
        exe:'⚙', sh:'⚙', bat:'⚙', py:'⚙', rb:'⚙',
      };

      // Store for inline extract buttons
      window._zipInst = zip;
      window._zipExtract = async (path) => {
        try {
          const f = window._zipInst?.files[path];
          if (!f) return;
          const data = await f.async('uint8array');
          const name = path.split('/').pop();
          const e2   = name.split('.').pop().toLowerCase();
          const MIME2 = { pdf:'application/pdf', txt:'text/plain', html:'text/html', json:'application/json' };
          const blob = new Blob([data], { type: MIME2[e2] || 'application/octet-stream' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        } catch (ex) { toast('Extract failed: ' + ex.message, 'error'); }
      };

      const rows = entries.map(e => {
        const depth = Math.max(0, (e.path.match(/\//g) || []).length - (e.isDir ? 1 : 0));
        const icon  = e.isDir ? '📁' : (EXT_ICONS[(e.path.split('.').pop() || '').toLowerCase()] || '📄');
        const size  = e.isDir ? '—' : fmtSize(e.size);
        const date  = e.date instanceof Date ? e.date.toLocaleDateString() : '—';
        const safe  = e.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const btn   = e.isDir ? '' : `<button class="ae-extract" title="Download this file" onclick="window._zipExtract('${safe}')">⬇</button>`;
        return `<tr class="ae-row${e.isDir ? ' ae-dir' : ''}">
          <td class="ae-icon-col">${icon}</td>
          <td class="ae-name-col" style="padding-left:${8 + depth * 16}px">${escHtml(e.path)}</td>
          <td class="ae-size-col">${size}</td>
          <td class="ae-date-col">${date}</td>
          <td class="ae-btn-col">${btn}</td>
        </tr>`;
      }).join('');

      bodyEl.innerHTML = `<div class="archive-wrap">
        <div class="archive-summary">
          <span>📦 ${escHtml(filename)}</span>
          <span>${fileCount} file${fileCount !== 1 ? 's' : ''}, ${dirCount} folder${dirCount !== 1 ? 's' : ''}</span>
          <span>Uncompressed: ${fmtSize(totalSize)}</span>
        </div>
        <div class="archive-scroll">
          <table class="archive-table">
            <thead><tr>
              <th class="ae-icon-col"></th>
              <th class="ae-name-col">Name</th>
              <th class="ae-size-col">Size</th>
              <th class="ae-date-col">Modified</th>
              <th class="ae-btn-col"></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    // ── RAR / 7z / TAR / GZ — no reliable browser parser ────────────────────
    } else if (['rar','7z','tar','gz','bz2','xz','cab','iso'].includes(ext) ||
               mime.includes('x-rar') || mime.includes('x-7z') || mime.includes('x-tar')) {
      const FMT = { rar:'RAR', '7z':'7-Zip', tar:'TAR', gz:'GZip', bz2:'BZip2', xz:'XZ', cab:'CAB', iso:'ISO' };
      bodyEl.innerHTML = `<div class="file-preview-unsupported">
        <strong>${FMT[ext] || ext.toUpperCase()} archives cannot be listed in the browser.</strong><br>
        Download the file to inspect its contents with a compatible application<br>
        (WinRAR, 7-Zip, The Unarchiver, etc.)
      </div>`;

    // ── Legacy / unsupported ──────────────────────────────────────────────────
    } else {
      const label = { ppt: 'PowerPoint 97–2003 (.ppt)', doc: 'Word 97–2003 (.doc)' }[ext]
                 || escHtml((ext || 'this file type').toUpperCase());
      bodyEl.innerHTML = `<div class="file-preview-unsupported">
        <strong>Preview not available for ${label}.</strong><br>
        Use the <em>Download</em> button to open it in the appropriate application.
      </div>`;
    }
  } catch (e) {
    bodyEl.innerHTML = `<div class="file-preview-unsupported">
      Failed to load preview.<br><small style="opacity:.6;">${escHtml(e.message)}</small>
    </div>`;
  }
}

// ── renderPptxSlides: full positioned canvas renderer ─────────────────────────
// Reads slide XML, relationship files and media from the JSZip instance,
// renders each slide as a percentage-positioned canvas with text formatting
// and embedded images. Requires JSZip to be loaded before calling.
async function renderPptxSlides(bytes) {
  const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const parse = xml => new DOMParser().parseFromString(xml, 'application/xml');

  const zip = await JSZip.loadAsync(bytes.buffer);

  // Slide dimensions from presentation.xml (default widescreen 16:9)
  let slideW = 9144000, slideH = 5143500;
  const presFile = zip.file('ppt/presentation.xml');
  if (presFile) {
    const pDoc = parse(await presFile.async('string'));
    const sz = pDoc.getElementsByTagNameNS(NS_P, 'sldSz')[0] || pDoc.querySelector('sldSz');
    if (sz) {
      slideW = parseInt(sz.getAttribute('cx')) || slideW;
      slideH = parseInt(sz.getAttribute('cy')) || slideH;
    }
  }

  // EMU → percentage of slide dimension
  const pct = (emu, total) => (emu / total * 100).toFixed(3) + '%';

  // Font size: PPTX stores in hundredths of a point.
  // Correct formula: sz_hundredths × 12700 / slideW_emu = cqw
  // Derivation: pt = sz/100; slideWidthPt = slideW/12700; fraction = pt/slideWidthPt = sz*12700/(100*slideW)
  // 1 cqw = 1% of container width, so cqw = fraction * 100 = sz*12700/slideW
  const ptToCqw = sz => (sz * 12700 / slideW).toFixed(4) + 'cqw';

  // Placeholder types that carry no real text in the slide XML
  // (they are filled by PowerPoint at runtime with date/footer/page number)
  const SKIP_PH_TYPES = new Set(['ftr', 'dt', 'sldNum', 'hdr']);

  function getHexColor(el) {
    if (!el) return null;
    const s = el.getElementsByTagNameNS(NS_A, 'srgbClr')[0];
    if (s) return '#' + s.getAttribute('val');
    const sys = el.getElementsByTagNameNS(NS_A, 'sysClr')[0];
    if (sys) return '#' + (sys.getAttribute('lastClr') || '000000');
    return null;
  }

  // ── Shared paragraph/run → HTML extractor ─────────────────────────────────
  // Used by BOTH free-floating text boxes (p:sp) AND table cells (a:tc) so
  // font size, bold/italic/underline, colour, and alignment are handled
  // identically everywhere text appears in the deck.
  function extractParasHtml(txBody, fallbackSz) {
    if (!txBody) return { html: '', hasText: false };
    const lstDef = txBody.getElementsByTagNameNS(NS_A, 'lstStyle')[0];
    const defSz  = parseInt(lstDef?.getElementsByTagNameNS(NS_A, 'defRPr')[0]?.getAttribute('sz') || '0');

    let paraHtml = '';
    let hasText = false;

    for (const para of txBody.getElementsByTagNameNS(NS_A, 'p')) {
      const pPr  = para.getElementsByTagNameNS(NS_A, 'pPr')[0];
      const algn = pPr?.getAttribute('algn') || 'l';
      const ta   = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';

      let spanHtml = '';
      for (const run of para.getElementsByTagNameNS(NS_A, 'r')) {
        const rPr = run.getElementsByTagNameNS(NS_A, 'rPr')[0];
        const t   = run.getElementsByTagNameNS(NS_A, 't')[0];
        const txt = t?.textContent;
        if (!txt) continue;
        hasText = true;

        const styles = [];
        const szRaw = rPr?.getAttribute('sz');
        const sz = szRaw ? +szRaw : (defSz || fallbackSz || 1800);
        styles.push('font-size:' + ptToCqw(sz));
        if (rPr?.getAttribute('b') === '1') styles.push('font-weight:700');
        if (rPr?.getAttribute('i') === '1') styles.push('font-style:italic');
        const u = rPr?.getAttribute('u');
        if (u && u !== 'none') styles.push('text-decoration:underline');
        const sf  = rPr?.getElementsByTagNameNS(NS_A, 'solidFill')[0];
        const clr = getHexColor(sf);
        if (clr) styles.push('color:' + clr);

        spanHtml += `<span style="${styles.join(';')}">${escHtml(txt)}</span>`;
      }
      if (spanHtml) {
        paraHtml += `<div style="text-align:${ta};line-height:1.3;margin:0;">${spanHtml}</div>`;
      }
    }
    return { html: paraHtml, hasText };
  }

  // Media cache: zip path → base64 string
  const mediaCache = {};
  async function getMediaB64(path) {
    if (mediaCache[path]) return mediaCache[path];
    const f = zip.file(path);
    if (!f) return null;
    return (mediaCache[path] = await f.async('base64'));
  }

  function resolveTarget(target) {
    if (!target) return null;
    if (target.startsWith('../')) return 'ppt/' + target.slice(3);
    if (target.startsWith('/'))   return target.slice(1);
    return 'ppt/slides/' + target;
  }

  const slideKeys = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml$/)[1] - +b.match(/(\d+)\.xml$/)[1]);

  const IMG_MIME = {
    jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png',
    gif:'image/gif', svg:'image/svg+xml', bmp:'image/bmp', webp:'image/webp'
  };

  let allHtml = '';

  for (let si = 0; si < slideKeys.length; si++) {
    const slideFilename = slideKeys[si].split('/').pop();
    const sDoc = parse(await zip.files[slideKeys[si]].async('string'));

    // Build relationship map rId → resolved media path
    const relsMap = {};
    const relFile = zip.file(`ppt/slides/_rels/${slideFilename}.rels`);
    if (relFile) {
      const rDoc = parse(await relFile.async('string'));
      rDoc.querySelectorAll('Relationship').forEach(r => {
        relsMap[r.getAttribute('Id')] = resolveTarget(r.getAttribute('Target'));
      });
    }

    // Slide background colour
    let bgStyle = 'background:#ffffff';
    const bgEl = sDoc.getElementsByTagNameNS(NS_P, 'bg')[0];
    if (bgEl) {
      const sf = bgEl.getElementsByTagNameNS(NS_A, 'solidFill')[0];
      const c  = getHexColor(sf);
      if (c) bgStyle = 'background:' + c;
    }

    let inner = '';

    // ── Text shapes (p:sp) ────────────────────────────────────────────────
    for (const sp of sDoc.getElementsByTagNameNS(NS_P, 'sp')) {
      // Skip dynamic-content placeholders (footer, date, slide number, header)
      // — their text lives in the slide master, not the slide XML itself.
      const ph = sp.querySelector('ph, [type]');
      const phType = ph?.getAttribute('type') || '';
      if (SKIP_PH_TYPES.has(phType)) continue;

      const xfrm = sp.getElementsByTagNameNS(NS_A, 'xfrm')[0];
      if (!xfrm) continue;
      const off  = xfrm.getElementsByTagNameNS(NS_A, 'off')[0];
      const ext  = xfrm.getElementsByTagNameNS(NS_A, 'ext')[0];
      if (!off || !ext) continue;

      const x = +off.getAttribute('x'), y = +off.getAttribute('y');
      const w = +ext.getAttribute('cx'), h = +ext.getAttribute('cy');

      const txBody = sp.getElementsByTagNameNS(NS_P, 'txBody')[0];
      if (!txBody) continue;

      const { html: paraHtml, hasText: hasRealText } = extractParasHtml(txBody);

      // Only render the text box if there is actual text to show
      if (hasRealText && paraHtml) {
        inner += `<div style="position:absolute;left:${pct(x,slideW)};top:${pct(y,slideH)};width:${pct(w,slideW)};height:${pct(h,slideH)};overflow:hidden;">${paraHtml}</div>`;
      }
    }

    // ── Images (p:pic) ────────────────────────────────────────────────────
    for (const pic of sDoc.getElementsByTagNameNS(NS_P, 'pic')) {
      const spPr  = pic.getElementsByTagNameNS(NS_P, 'spPr')[0];
      const xfrm  = spPr?.getElementsByTagNameNS(NS_A, 'xfrm')[0];
      const off   = xfrm?.getElementsByTagNameNS(NS_A, 'off')[0];
      const extEl = xfrm?.getElementsByTagNameNS(NS_A, 'ext')[0];
      if (!off || !extEl) continue;

      const x = +off.getAttribute('x'), y = +off.getAttribute('y');
      const w = +extEl.getAttribute('cx'), h = +extEl.getAttribute('cy');

      const blipFill = pic.getElementsByTagNameNS(NS_P, 'blipFill')[0];
      const blip     = blipFill?.getElementsByTagNameNS(NS_A, 'blip')[0];
      if (!blip) continue;

      const rId = blip.getAttributeNS(NS_R, 'embed') || blip.getAttribute('r:embed');
      if (!rId || !relsMap[rId]) continue;

      const mediaPath = relsMap[rId];
      const mediaExt  = (mediaPath.split('.').pop() || '').toLowerCase();
      if (['emf','wmf'].includes(mediaExt)) continue; // Windows metafiles not renderable

      const b64 = await getMediaB64(mediaPath);
      if (!b64) continue;

      const imgMime = IMG_MIME[mediaExt] || 'image/' + mediaExt;
      inner += `<div style="position:absolute;left:${pct(x,slideW)};top:${pct(y,slideH)};width:${pct(w,slideW)};height:${pct(h,slideH)};overflow:hidden;">
        <img src="data:${imgMime};base64,${b64}" style="width:100%;height:100%;object-fit:fill;" alt="">
      </div>`;
    }

    // ── Tables (p:graphicFrame > a:tbl) ───────────────────────────────────
    // PowerPoint tables are NOT p:sp shapes — they live in a graphicFrame
    // wrapping a DrawingML table (a:tbl), so they need their own extraction path.
    for (const gf of sDoc.getElementsByTagNameNS(NS_P, 'graphicFrame')) {
      const xfrm  = gf.getElementsByTagNameNS(NS_P, 'xfrm')[0];
      const off   = xfrm?.getElementsByTagNameNS(NS_A, 'off')[0];
      const extEl = xfrm?.getElementsByTagNameNS(NS_A, 'ext')[0];
      if (!off || !extEl) continue;

      const tbl = gf.getElementsByTagNameNS(NS_A, 'tbl')[0];
      if (!tbl) continue; // graphicFrame can also hold charts/diagrams — skip those

      const x = +off.getAttribute('x'), y = +off.getAttribute('y');
      const w = +extEl.getAttribute('cx'), h = +extEl.getAttribute('cy');

      // Column widths from a:tblGrid → convert to relative percentages
      const gridCols = [...tbl.getElementsByTagNameNS(NS_A, 'gridCol')].map(g => +g.getAttribute('w') || 1);
      const colTotal = gridCols.reduce((s, v) => s + v, 0) || 1;
      const colPercents = gridCols.map(v => (v / colTotal * 100).toFixed(3) + '%');

      const rows = [...tbl.getElementsByTagNameNS(NS_A, 'tr')];
      const rowHeights = rows.map(r => +r.getAttribute('h') || 1);
      const rowTotal = rowHeights.reduce((s, v) => s + v, 0) || 1;

      let theadBody = '';
      rows.forEach((tr, ri) => {
        const cells = [...tr.getElementsByTagNameNS(NS_A, 'tc')];
        let cellsHtml = '';
        let colIdx = 0;
        cells.forEach(tc => {
          const gridSpan = parseInt(tc.getAttribute('gridSpan') || '1');
          const isVMergeCont = tc.getAttribute('vMerge') === '1'; // continuation of a vertical merge — skip
          const isHMergeCont = tc.getAttribute('hMerge') === '1'; // continuation of a horizontal merge — skip
          if (isHMergeCont || isVMergeCont) { colIdx += gridSpan; return; }

          const tcPr = tc.getElementsByTagNameNS(NS_A, 'tcPr')[0];
          const fillEl = tcPr?.getElementsByTagNameNS(NS_A, 'solidFill')[0];
          const fillColor = getHexColor(fillEl);
          const rowSpan = parseInt(tc.getAttribute('rowSpan') || '1');

          const txBody = tc.getElementsByTagNameNS(NS_A, 'txBody')[0];
          const { html: cellHtml } = extractParasHtml(txBody, 1400); // PPT table default ≈14pt

          const tdStyle = [
            'border:1px solid rgba(0,0,0,0.25)',
            'padding:0.3cqw 0.6cqw',
            'vertical-align:middle',
            'overflow:hidden',
            fillColor ? `background:${fillColor}` : ''
          ].filter(Boolean).join(';');

          const attrs = [
            gridSpan > 1 ? `colspan="${gridSpan}"` : '',
            rowSpan  > 1 ? `rowspan="${rowSpan}"`  : ''
          ].filter(Boolean).join(' ');

          cellsHtml += `<td ${attrs} style="${tdStyle}">${cellHtml || '&nbsp;'}</td>`;
          colIdx += gridSpan;
        });
        const rowHPct = (rowHeights[ri] / rowTotal * 100).toFixed(3) + '%';
        theadBody += `<tr style="height:${rowHPct}">${cellsHtml}</tr>`;
      });

      const colgroupHtml = colPercents.map(p => `<col style="width:${p}">`).join('');

      inner += `<div style="position:absolute;left:${pct(x,slideW)};top:${pct(y,slideH)};width:${pct(w,slideW)};height:${pct(h,slideH)};overflow:hidden;">
        <table class="pptx-table"><colgroup>${colgroupHtml}</colgroup><tbody>${theadBody}</tbody></table>
      </div>`;
    }

    const aspectPct = (slideH / slideW * 100).toFixed(3);
    allHtml += `<div class="pptx-slide-card">
      <div class="pptx-slide-label">Slide ${si + 1} / ${slideKeys.length}</div>
      <div class="pptx-canvas" style="${bgStyle};padding-top:${aspectPct}%">
        <div class="pptx-canvas-inner">${inner || '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#bbb;font-size:2cqw;">Empty slide</div>'}</div>
      </div>
    </div>`;
  }

  return allHtml || '<div class="file-preview-unsupported">No slides found in this presentation.</div>';
}

function toggleReply(forceClose = false) {
  const replyEd = document.getElementById('reply-editor');
  const willOpen = forceClose ? false : !replyEd.classList.contains('open');
  
  replyEd.classList.toggle('open', willOpen);
  document.getElementById('reply-arrow').textContent = willOpen ? '▼' : '▶';
  
  if (willOpen) {
    const viewer = document.getElementById('email-viewer');
    const fromEl = viewer.querySelector('.email-meta-row:nth-child(2) .email-meta-val');
    const toEl = viewer.querySelector('.email-meta-row:nth-child(3) .email-meta-val');
    const targetRecipient = State.mail.label === 'SENT' ? toEl?.textContent : fromEl?.textContent;
    
    document.getElementById('reply-to').value  = targetRecipient || '';
    document.getElementById('reply-cc').value  = '';
    document.getElementById('reply-bcc').value = '';
    const subj = viewer.querySelector('.email-title')?.textContent || '';
    document.getElementById('reply-subject').value = subj.startsWith('Re:') ? subj : 'Re: ' + subj;
    
    State.reply.attachments =[];
    renderAttachmentChips('reply');
    
    const historyHtml = `<br><br><div class="gmail_quote">On ${formatTimestamp(State.reply.originalDate)}, ${escHtml(State.reply.originalFrom)} wrote:<br><blockquote style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">${State.reply.originalHtml}</blockquote></div>`;
    const replyBody = document.getElementById('reply-body');
    replyBody.innerHTML = `<div><br></div>${historyHtml}`;
    
    replyBody.focus();
    
    try {
      const range = document.createRange();
      const sel = window.getSelection();
      range.setStart(replyBody.firstChild, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch(e) {}
  } else {
    document.getElementById('reply-body').innerHTML = '';
    State.reply.attachments =[];
    renderAttachmentChips('reply');
  }
}

async function sendReply() {
  const to  = document.getElementById('reply-to').value.replace(/;/g, ',').trim();
  const cc  = document.getElementById('reply-cc').value.replace(/;/g, ',').trim();
  const bcc = document.getElementById('reply-bcc').value.replace(/;/g, ',').trim();
  const subj = document.getElementById('reply-subject').value.trim();
  const body = document.getElementById('reply-body').innerHTML;
  if (!to) return toast('Recipient is required', 'error');

  try {
    await sendRawEmail(to, cc, bcc, subj, body, State.reply.attachments, State.compose.currentThreadId);
    toggleReply(true);
    toast('Reply sent!', 'success');
    refreshCurrent();
  } catch (e) { toast('Failed to send reply: ' + e.message, 'error'); }
}

function openComposeModal(to='', subj='', bodyHtml='', title='New Message', keepAttachments=false) {
  document.getElementById('compose-modal').classList.add('open');
  document.getElementById('compose-title').textContent = title;
  document.getElementById('compose-to').value = to;
  document.getElementById('compose-cc').value  = '';
  document.getElementById('compose-bcc').value = '';
  document.getElementById('compose-subject').value = subj;
  document.getElementById('compose-body-text').innerHTML = bodyHtml;
  if (!keepAttachments) State.compose.attachments = [];
  renderAttachmentChips('compose');
}

function handleAttachFiles(e, type) {
  for (const file of e.target.files) {
    if (file.size === 0) { toast(`Attachment blocked: '${file.name}' is empty (0 bytes).`, 'error'); continue; }
    State[type].attachments.push(file);
  }
  e.target.value = '';
  renderAttachmentChips(type);
}

function renderAttachmentChips(type) {
  const list = document.getElementById(type === 'reply' ? 'reply-attached-files-list' : 'attached-files-list');
  list.innerHTML = '';
  list.className = 'attached-files attachment-chips'; // Standardize the wrapper layout
  
  State[type].attachments.forEach(file => {
    const chip = el('div', 'attachment-chip');
    const thumbArea = el('div', 'attachment-thumb-area');
    const infoArea = el('div', 'attachment-info');
    
    infoArea.append(el('span', 'chip-name', file.name), el('span', 'chip-size', formatBytes(file.size)));
    
    if (file.type && file.type.startsWith('image/')) {
      const img = el('img', 'attachment-thumb');
      const reader = new FileReader();
      reader.onload = (e) => img.src = e.target.result;
      reader.readAsDataURL(file);
      thumbArea.appendChild(img);
    } else {
      thumbArea.textContent = getFileIcon(file.type, file.name);
    }
    
    const btn = el('button', 'chip-delete-btn', '✕');
    btn.onclick = (e) => { 
      e.stopPropagation(); 
      State[type].attachments = State[type].attachments.filter(f => f !== file); 
      chip.remove(); 
    };
    
    chip.append(thumbArea, infoArea, btn);
    list.appendChild(chip);
  });
}

async function sendEmail() {
  const to  = document.getElementById('compose-to').value.replace(/;/g, ',').trim();
  const cc  = document.getElementById('compose-cc').value.replace(/;/g, ',').trim();
  const bcc = document.getElementById('compose-bcc').value.replace(/;/g, ',').trim();
  const subj = document.getElementById('compose-subject').value.trim();
  const body = document.getElementById('compose-body-text').innerHTML;
  if (!to) return toast('Recipient required', 'error');

  try {
    await sendRawEmail(to, cc, bcc, subj, body, State.compose.attachments, null);
    document.getElementById('compose-modal').classList.remove('open');
    State.compose.attachments = [];
    toast('Sent successfully', 'success');
    refreshCurrent();
  } catch (e) { toast('Failed to send: ' + e.message, 'error'); }
}

async function sendRawEmail(to, cc, bcc, subject, htmlBody, attachments, threadId) {
  const boundaryMixed = 'aether_mixed_' + Math.random().toString(36).substr(2);
  const boundaryRel   = 'aether_rel_'   + Math.random().toString(36).substr(2);

  let emailStr = `To: ${encodeAddressList(to)}\r\n`;
  if (cc)  emailStr += `Cc: ${encodeAddressList(cc)}\r\n`;
  if (bcc) emailStr += `Bcc: ${encodeAddressList(bcc)}\r\n`;
  emailStr += `Subject: ${encodeSubject(subject)}\r\n`;
  emailStr += `MIME-Version: 1.0\r\n`;

  let inlines =[];
  let processedHtml = htmlBody.replace(/<img[^>]+src="data:(image\/[^;]+);base64,([^"]+)"[^>]*>/g, (match, mime, b64) => {
    let cid = 'img_' + Math.random().toString(36).substr(2);
    inlines.push({ cid, mime, b64 });
    return match.replace(/src="data:[^"]+"/, `src="cid:${cid}"`);
  });

  const hasAttachments = attachments && attachments.length > 0;
  
  if (hasAttachments) { 
      emailStr += `Content-Type: multipart/mixed; boundary="${boundaryMixed}"\r\n\r\n`;
      emailStr += `--${boundaryMixed}\r\n`; 
  }
  
  emailStr += `Content-Type: multipart/related; boundary="${boundaryRel}"\r\n\r\n`;
  emailStr += `--${boundaryRel}\r\n`;
  emailStr += `Content-Type: text/html; charset="UTF-8"\r\n`;
  emailStr += `Content-Transfer-Encoding: base64\r\n\r\n`;
  emailStr += `${chunkString(utf8ToBase64(processedHtml))}\r\n`;
  
  for (const inline of inlines) {
    emailStr += `--${boundaryRel}\r\n`;
    emailStr += `Content-Type: ${inline.mime}\r\n`;
    emailStr += `Content-Transfer-Encoding: base64\r\n`;
    emailStr += `Content-ID: <${inline.cid}>\r\n`;
    emailStr += `Content-Disposition: inline\r\n\r\n`;
    emailStr += `${chunkString(inline.b64)}\r\n`;
  }
  emailStr += `--${boundaryRel}--\r\n`;

  if (hasAttachments) {
    for (const file of attachments) {
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = e => res(e.target.result.split(',')[1]); r.readAsDataURL(file); });
      const mimeParams = getMimeFilenameParams(file.name);
      
      emailStr += `--${boundaryMixed}\r\n`;
      emailStr += `Content-Type: ${file.type || 'application/octet-stream'}; ${mimeParams.nameStr}\r\n`;
      emailStr += `Content-Disposition: attachment; ${mimeParams.filenameStr}\r\n`;
      emailStr += `Content-Transfer-Encoding: base64\r\n\r\n`;
      emailStr += `${chunkString(data)}\r\n`; 
    }
    emailStr += `--${boundaryMixed}--\r\n`;
  }
  
  if (threadId) emailStr = `Thread-Id: ${threadId}\r\n` + emailStr;
  
  await gapi('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: utf8ToBase64url(emailStr) });
}

// ===== CALENDAR =====
async function loadCalendar() {
  try {
    const calList = await gapi('GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList');
    State.calendar.calendars = calList.items ||[];
    
    // Fix 12: Rebuild the calendar select properly each time
    const calSelect = document.getElementById('event-calendar');
    calSelect.innerHTML = '';
    const writableCalendars = State.calendar.calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer');
    writableCalendars.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.summary;
      calSelect.appendChild(opt);
    });
    // Ensure the select is enabled for new events by default
    calSelect.disabled = false;

    // Fix 11: Render calendar legend next to the "New Event" button
    const legendContainer = document.getElementById('cal-legend');
    if (legendContainer) {
      legendContainer.innerHTML = '';
      State.calendar.calendars.filter(c => c.selected !== false).forEach(c => {
        const item = document.createElement('div');
        item.className = 'cal-legend-item';
        const dot = document.createElement('span');
        dot.className = 'cal-legend-dot';
        dot.style.backgroundColor = c.backgroundColor || '#5b8af0';
        const label = document.createElement('span');
        label.className = 'cal-legend-label';
        label.textContent = c.summary;
        item.append(dot, label);
        legendContainer.appendChild(item);
      });
    }
  } catch (err) { toast('Error loading calendar list', 'error'); return; }

  renderCalendarGrid();
  // Expand query range by one week on each side to catch multi-day events that start before / end after the visible month
  const viewStart = new Date(State.calendar.date.getFullYear(), State.calendar.date.getMonth(), 1);
  const viewEnd   = new Date(State.calendar.date.getFullYear(), State.calendar.date.getMonth() + 1, 0, 23, 59, 59);
  const queryStart = new Date(viewStart); queryStart.setDate(queryStart.getDate() - 7);
  const queryEnd   = new Date(viewEnd);   queryEnd.setDate(queryEnd.getDate() + 7);
  
  try {
    const eventPromises = State.calendar.calendars.filter(c => c.selected !== false).map(async (c) => {
      try {
        const data = await gapi('GET', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?timeMin=${queryStart.toISOString()}&timeMax=${queryEnd.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=200`);
        return (data.items ||[]).map(e => ({ ...e, backgroundColor: c.backgroundColor, foregroundColor: c.foregroundColor, calendarId: c.id }));
      } catch(err) { return[]; }
    });

    const allEventsArrays = await Promise.all(eventPromises);
    State.calendar.events = allEventsArrays.flat();
    renderCalendarGrid(); 
  } catch (err) { toast('Error loading calendar events', 'error'); }
}

function searchCalendar(q) {
  if(!q.trim()) return renderCalendarGrid();
  const filtered = State.calendar.events.filter(e => 
     (e.summary||'').toLowerCase().includes(q.toLowerCase()) || 
     (e.description||'').toLowerCase().includes(q.toLowerCase())
  );
  renderCalendarGrid(filtered);
}

function renderCalendarGrid(eventsToRender = null) {
  const year = State.calendar.date.getFullYear();
  const month = State.calendar.date.getMonth();
  document.getElementById('cal-title').textContent = State.calendar.date.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Monday-first: getDay() returns 0=Sun..6=Sat; we want 0=Mon..6=Sun
  const dayOfWeekMon = d => (d.getDay() + 6) % 7; // 0=Mon, 6=Sun

  const firstDayOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const today = new Date();

  const wdContainer = document.getElementById('cal-weekdays');
  wdContainer.innerHTML = '';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d => wdContainer.appendChild(el('div', 'cal-weekday', d)));

  // Build cell array (Monday-first)
  const leadingBlanks = dayOfWeekMon(firstDayOfMonth); // how many cells before day 1
  const cells = [];
  for (let i = leadingBlanks - 1; i >= 0; i--) cells.push({ day: prevDays - i, month: month - 1, year: month === 0 ? year - 1 : year, current: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, month, year, current: true });
  while (cells.length % 7 !== 0) {
    const extra = cells.length - leadingBlanks - daysInMonth + 1;
    cells.push({ day: extra, month: month + 1, year: month === 11 ? year + 1 : year, current: false });
  }

  const eventsData = eventsToRender || State.calendar.events;

  // Normalize an event to a JS Date (date-only events use local midnight)
  const toDate = str => str ? new Date(str.includes('T') ? str : str + 'T00:00:00') : null;
  const stripTime = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // For each event, compute start/end as plain dates (all-day: end is exclusive so subtract 1 day)
  const normalizedEvents = eventsData.map(e => {
    const isAllDay = !e.start?.dateTime && !!e.start?.date;
    let startD = stripTime(toDate(e.start?.dateTime || e.start?.date));
    let endD = toDate(e.end?.dateTime || e.end?.date);
    if (isAllDay && endD) {
      // Google Calendar all-day end is exclusive — subtract one day
      endD = new Date(endD.getTime() - 24 * 60 * 60 * 1000);
    } else if (endD) {
      endD = stripTime(endD);
    } else {
      endD = startD;
    }
    const isMultiDay = endD > startD;
    return { ...e, _startD: startD, _endD: endD, _isAllDay: isAllDay, _isMultiDay: isMultiDay };
  });

  const container = document.getElementById('cal-days');
  container.innerHTML = '';

  cells.forEach(cell => {
    const cellDate = new Date(cell.year, cell.month, cell.day);
    const cellDateStripped = stripTime(cellDate);

    const div = el('div', `cal-day${!cell.current ? ' other-month' : ''}`);
    const isToday = cell.current && cell.day === today.getDate() && cell.month === today.getMonth() && cell.year === today.getFullYear();
    if (isToday) div.classList.add('today');

    div.appendChild(el('div', 'day-num', String(cell.day)));

    // Find events that span this cell date
    const dayEvents = normalizedEvents.filter(e => {
      return cellDateStripped >= e._startD && cellDateStripped <= e._endD;
    });

    dayEvents.forEach(e => {
      let label = '';
      let cssClass = 'cal-event';

      if (e._isMultiDay) {
        const isStart = cellDateStripped.getTime() === e._startD.getTime();
        const isEnd = cellDateStripped.getTime() === e._endD.getTime();
        if (isStart) {
          cssClass += ' multiday-start';
          label = (e.summary || 'No title');
        } else if (isEnd) {
          cssClass += ' multiday-end';
          label = '↳ ' + (e.summary || 'No title');
        } else {
          cssClass += ' multiday-mid';
          label = '— ' + (e.summary || 'No title');
        }
      } else {
        const time = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' ' : '';
        label = time + (e.summary || 'No title');
      }

      const chip = el('div', cssClass, label);
      chip.style.backgroundColor = e.backgroundColor || '#5b8af0';
      chip.style.color = e.foregroundColor || '#fff';
      chip.title = (e.summary || 'No title') + (e._isMultiDay ? `\n${e._startD.toLocaleDateString()} – ${e._endD.toLocaleDateString()}` : '');
      chip.addEventListener('click', (ev) => { ev.stopPropagation(); openEventModal(e); });
      div.appendChild(chip);
    });

    div.addEventListener('dblclick', () => {
      const dtStr = new Date(cell.year, cell.month, cell.day, 9, 0).toISOString().slice(0,16);
      openEventModal();
      document.getElementById('event-start').value = dtStr;
      document.getElementById('event-end').value = new Date(new Date(cell.year, cell.month, cell.day, 10, 0)).toISOString().slice(0,16);
    });

    container.appendChild(div);
  });
}

// ── Recurring-event scope picker ──────────────────────────────────────────────
// Called when the user clicks an event chip. If it is part of a series, shows a
// compact inline dialog asking "just this one / this and following / all". The
// chosen scope is stored on the event object and forwarded to openEventModalFill.
function openEventModal(event) {
  if (!event) {
    // New event — no series prompt needed
    openEventModalFill(event, null);
    return;
  }

  const isRecurring = !!(event.recurrence?.[0] || event.recurringEventId);
  if (!isRecurring) {
    openEventModalFill(event, null);
    return;
  }

  // Show the scope-picker dialog via the confirm modal (reused for neatness)
  // We repurpose it with custom buttons instead of the generic Yes/No pair.
  const overlay = document.getElementById('confirm-modal');
  document.getElementById('confirm-title').textContent = 'Edit recurring event';
  document.getElementById('confirm-title').style.color = 'var(--text)';
  document.getElementById('confirm-msg').textContent =
    `"${event.summary || 'This event'}" is part of a series. Which occurrences do you want to edit?`;

  // Swap out the two generic buttons for three scope buttons
  const footer = overlay.querySelector('.modal-footer');
  const origHTML = footer.innerHTML;

  footer.innerHTML = `
    <button class="btn-cancel"  id="rc-cancel">Cancel</button>
    <button class="btn-save"    id="rc-single"   style="background:var(--surface3);color:var(--text);border:1px solid var(--border2);">This event only</button>
    <button class="btn-save"    id="rc-following" style="background:var(--surface3);color:var(--text);border:1px solid var(--border2);">This &amp; following</button>
    <button class="btn-save"    id="rc-all"      style="background:var(--accent);">All events</button>
  `;

  function closeAndRestore() {
    overlay.classList.remove('open');
    footer.innerHTML = origHTML;
    // Re-attach original confirm modal buttons
    document.getElementById('btn-confirm-no').addEventListener('click', () => overlay.classList.remove('open'));
  }

  overlay.classList.add('open');
  document.getElementById('rc-cancel').addEventListener('click', closeAndRestore);
  document.getElementById('rc-single').addEventListener('click', () => {
    closeAndRestore();
    openEventModalFill(event, 'single');
  });
  document.getElementById('rc-following').addEventListener('click', () => {
    closeAndRestore();
    openEventModalFill(event, 'following');
  });
  document.getElementById('rc-all').addEventListener('click', () => {
    closeAndRestore();
    openEventModalFill(event, 'all');
  });
}

function openEventModalFill(event, recurScope) {
  State.calendar.editingEventId = event?.id || null;
  State.calendar.editingCalendarId = event?.calendarId || null;
  State.calendar.editingEvent = event || null;

  document.getElementById('event-modal-title').textContent = event ? 'Edit Event' : 'New Event';
  document.getElementById('event-title').value    = event?.summary     || '';
  document.getElementById('event-location').value = event?.location    || '';
  document.getElementById('event-desc').value     = event?.description || '';

  // Show/hide delete button
  const btnDel = document.getElementById('btn-delete-event');
  btnDel.style.display = event ? 'inline-flex' : 'none';

  const calSelect = document.getElementById('event-calendar');
  calSelect.disabled = !!event;
  if (event?.calendarId) {
    calSelect.value = event.calendarId;
  } else if (calSelect.options.length > 0) {
    calSelect.selectedIndex = 0;
  }

  // All-day toggle
  const isAllDay = event ? (!event.start?.dateTime && !!event.start?.date) : false;
  document.getElementById('event-allday').checked = isAllDay;
  updateAllDayFields(isAllDay);

  // Recurrence rule display
  const rrule = event?.recurrence?.[0] || '';
  const recSelect = document.getElementById('event-recurrence');
  let matched = '';
  for (const opt of recSelect.options) {
    if (opt.value && rrule.startsWith(opt.value)) { matched = opt.value; break; }
  }
  recSelect.value = matched;
  recSelect.disabled = !!(event && rrule);

  // Recurrence scope — pre-set from the picker dialog answer
  const isRecurring = !!(event && (rrule || event.recurringEventId));
  const scopeGroup = document.getElementById('event-recurrence-scope-group');
  scopeGroup.style.display = isRecurring ? 'flex' : 'none';
  if (isRecurring && recurScope) {
    document.getElementById('event-recurrence-scope').value = recurScope;
  } else {
    document.getElementById('event-recurrence-scope').value = 'single';
  }

  const now = new Date();
  if (event) {
    const startRaw = event.start?.dateTime || (event.start?.date ? event.start.date + 'T00:00:00' : null);
    let endRaw = event.end?.dateTime || (event.end?.date ? event.end.date + 'T00:00:00' : null);
    if (!event.start?.dateTime && event.end?.date) {
      const d = new Date(event.end.date + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      endRaw = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T00:00:00`;
    }
    document.getElementById('event-start').value = startRaw?.slice(0,16) || now.toISOString().slice(0,16);
    document.getElementById('event-end').value   = endRaw?.slice(0,16)   || new Date(now.getTime()+3600000).toISOString().slice(0,16);
  } else {
    document.getElementById('event-start').value = now.toISOString().slice(0,16);
    document.getElementById('event-end').value   = new Date(now.getTime()+3600000).toISOString().slice(0,16);
  }
  document.getElementById('event-modal').classList.add('open');
}

function updateAllDayFields(isAllDay) {
  const startEl = document.getElementById('event-start');
  const endEl   = document.getElementById('event-end');
  if (isAllDay) {
    // Switch to date-only inputs
    startEl.type = 'date';
    endEl.type   = 'date';
    if (startEl.value.includes('T')) startEl.value = startEl.value.slice(0, 10);
    if (endEl.value.includes('T'))   endEl.value   = endEl.value.slice(0, 10);
  } else {
    startEl.type = 'datetime-local';
    endEl.type   = 'datetime-local';
    if (!startEl.value.includes('T')) startEl.value = startEl.value + 'T09:00';
    if (!endEl.value.includes('T'))   endEl.value   = endEl.value   + 'T10:00';
  }
}

async function saveEvent() {
  const summary = document.getElementById('event-title').value.trim();
  if (!summary) return toast('Please enter a title', 'error');

  const isAllDay = document.getElementById('event-allday').checked;
  const startVal = document.getElementById('event-start').value;
  const endVal   = document.getElementById('event-end').value;
  if (!startVal || !endVal) return toast('Please set start and end', 'error');

  let startObj, endObj;
  if (isAllDay) {
    const startDate = startVal.slice(0, 10);
    const endDate   = endVal.slice(0, 10);
    // Google Calendar all-day end is exclusive (add 1 day)
    const endExcl = new Date(endDate + 'T00:00:00');
    endExcl.setDate(endExcl.getDate() + 1);
    const endExclStr = endExcl.toISOString().slice(0, 10);
    startObj = { date: startDate };
    endObj   = { date: endExclStr };
  } else {
    startObj = { dateTime: new Date(startVal).toISOString() };
    endObj   = { dateTime: new Date(endVal).toISOString() };
  }

  const rruleVal = document.getElementById('event-recurrence').value;
  const body = {
    summary,
    start: startObj,
    end: endObj,
    location:    document.getElementById('event-location').value.trim() || undefined,
    description: document.getElementById('event-desc').value.trim()     || undefined,
  };
  if (rruleVal) body.recurrence = [rruleVal];

  const calId = State.calendar.editingEventId ? State.calendar.editingCalendarId : document.getElementById('event-calendar').value;

  try {
    if (State.calendar.editingEventId) {
      const scope = document.getElementById('event-recurrence-scope').value;
      const event = State.calendar.editingEvent;
      const isRecurring = !!(event?.recurrence?.[0] || event?.recurringEventId);

      if (isRecurring && scope !== 'all') {
        // Edit this occurrence (or this + following) via instance endpoint
        const instanceId = event.recurringEventId ? event.id : State.calendar.editingEventId;
        if (scope === 'single') {
          // PATCH just this instance
          await gapi('PATCH', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${instanceId}`, body);
        } else {
          // 'following' — set thisAndFollowing via originalStartTime
          body.recurrenceId = event.originalStartTime?.dateTime || event.originalStartTime?.date;
          await gapi('PATCH', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${instanceId}?modificationMode=FOLLOWING`, body);
        }
      } else {
        await gapi('PUT', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${State.calendar.editingEventId}`, body);
      }
    } else {
      await gapi('POST', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, body);
    }
    document.getElementById('event-modal').classList.remove('open');
    toast('Event saved!', 'success');
    loadCalendar();
  } catch(e) { toast('Error saving event: ' + e.message, 'error'); }
}

async function deleteEvent() {
  const eventId = State.calendar.editingEventId;
  const calId   = State.calendar.editingCalendarId;
  const event   = State.calendar.editingEvent;
  if (!eventId || !calId) return;

  const isRecurring = !!(event?.recurrence?.[0] || event?.recurringEventId);
  const scope = isRecurring ? document.getElementById('event-recurrence-scope').value : 'all';

  const scopeLabels = { single: 'this event only', following: 'this and following events', all: 'all events in the series' };
  const label = isRecurring ? scopeLabels[scope] : 'this event';

  confirmAction('Delete Event', `Delete ${label}?`, '🗑 Delete', async () => {
    try {
      if (isRecurring && scope === 'single') {
        // Cancel just this instance by setting status to cancelled
        await gapi('PATCH', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`, { status: 'cancelled' });
      } else if (isRecurring && scope === 'following') {
        // Delete this and following by truncating the series
        // Set UNTIL on the master event to the day before this occurrence
        const masterEvent = await gapi('GET', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${event.recurringEventId || eventId}`);
        const occStart = event.originalStartTime?.dateTime || event.originalStartTime?.date || event.start?.dateTime || event.start?.date;
        const untilDate = new Date(occStart);
        untilDate.setDate(untilDate.getDate() - 1);
        const untilStr = untilDate.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
        const rrules = (masterEvent.recurrence || []).map(r => {
          if (r.startsWith('RRULE:') && !r.includes('UNTIL=') && !r.includes('COUNT=')) {
            return r + ';UNTIL=' + untilStr;
          }
          return r;
        });
        await gapi('PATCH', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${masterEvent.id}`, { recurrence: rrules });
      } else {
        // Delete the whole event / series
        await gapi('DELETE', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`);
      }
      document.getElementById('event-modal').classList.remove('open');
      toast('Event deleted', 'success');
      loadCalendar();
    } catch(e) { toast('Error deleting event: ' + e.message, 'error'); }
  }, true);
}

// ===== CONTACTS =====
async function loadContacts(loadMore = false) {
  const container = document.getElementById('contacts-list');
  if (!loadMore) {
    container.innerHTML = '';
    State.contacts.pageToken = null;
    State.contacts.allItems  = [];   // full unfiltered set for searching
    loadingState(container);
    document.getElementById('contact-detail-panel').classList.remove('open');
    document.getElementById('contact-viewer').style.display = 'none';
    document.getElementById('contact-detail-empty').style.display = 'flex';

    // Load ALL pages up-front (capped at 500) so the filter always searches
    // the full list, not just the first batch.
    try {
      let pageToken = null;
      let totalLoaded = 0;
      do {
        const pageParam = pageToken ? `&pageToken=${pageToken}` : '';
        const data = await gapi('GET',
          `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations,birthdays,biographies&pageSize=100${pageParam}`
        );
        const batch = data.connections || [];
        State.contacts.allItems  = [...(State.contacts.allItems  || []), ...batch];
        State.contacts.items     = State.contacts.allItems;
        pageToken = data.nextPageToken || null;
        totalLoaded += batch.length;
      } while (pageToken && totalLoaded < 500);

      State.contacts.pageToken = pageToken; // leftover for "Load More" if > 500
      renderContactsList(State.contacts.items, true);
      document.getElementById('btn-load-more-contacts').style.display =
        State.contacts.pageToken ? 'block' : 'none';
    } catch (err) { toast('Error loading contacts', 'error'); }
    return;
  }

  // "Load More" beyond the initial 500
  try {
    const pageParam = State.contacts.pageToken ? `&pageToken=${State.contacts.pageToken}` : '';
    const data = await gapi('GET',
      `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations,birthdays,biographies&pageSize=100${pageParam}`
    );
    State.contacts.pageToken = data.nextPageToken || null;
    const items = data.connections || [];
    State.contacts.allItems = [...(State.contacts.allItems || []), ...items];
    State.contacts.items    = State.contacts.allItems;
    renderContactsList(State.contacts.items, false);
    document.getElementById('btn-load-more-contacts').style.display =
      State.contacts.pageToken ? 'block' : 'none';
  } catch (err) { toast('Error loading contacts', 'error'); }
}

function filterContacts(q) {
  // Always filter the full allItems set, not just what's currently rendered
  const source = State.contacts.allItems || State.contacts.items || [];
  if (!q.trim()) return renderContactsList(source, true);
  const lq = q.toLowerCase();
  const f = source.filter(c => {
    const name  = c.names?.[0]?.displayName || '';
    const email = c.emailAddresses?.[0]?.value || '';
    const phone = c.phoneNumbers?.[0]?.value || '';
    const org   = c.organizations?.[0]?.name || '';
    return name.toLowerCase().includes(lq)  ||
           email.toLowerCase().includes(lq) ||
           phone.toLowerCase().includes(lq) ||
           org.toLowerCase().includes(lq);
  });
  renderContactsList(f, true);
}

function renderContactsList(contacts, clearFirst) {
  const container = document.getElementById('contacts-list');
  if (clearFirst) container.innerHTML = '';
  if (contacts.length === 0) return emptyState(container, 'No contacts found');
  
  contacts.forEach(c => {
    const name = c.names?.[0]?.displayName || 'Unknown';
    const email = c.emailAddresses?.[0]?.value || '';
    const div = el('div', 'contact-item');
    const inner = el('div');
    inner.append(el('div', 'contact-name', name), el('div', 'contact-email-preview', email));
    div.append(el('div', 'contact-avatar', name[0].toUpperCase()), inner);
    
    div.addEventListener('click', () => {
      document.querySelectorAll('.contact-item').forEach(e => e.classList.remove('active'));
      div.classList.add('active');
      showContactDetail(c);
    });
    container.appendChild(div);
  });
}

function showContactDetail(c) {
  const panel = document.getElementById('contact-detail-panel');
  panel.classList.add('open');
  document.getElementById('contact-detail-empty').style.display = 'none';

  const viewer = document.getElementById('contact-viewer');
  viewer.style.display = 'block';
  viewer.innerHTML = '';

  const name  = c.names?.[0]?.displayName || 'Unknown';
  const email = c.emailAddresses?.[0]?.value || '';
  const phone = c.phoneNumbers?.[0]?.value || '';
  const org   = c.organizations?.[0]?.name || '';
  const title = c.organizations?.[0]?.title || '';

  // Birthday
  const bday = c.birthdays?.[0]?.date;
  let birthdayStr = '';
  if (bday) {
    const parts = [bday.year, String(bday.month).padStart(2,'0'), String(bday.day).padStart(2,'0')].filter(Boolean);
    birthdayStr = parts.join('-');
  }

  // Notes / biographies
  const notes = c.biographies?.[0]?.value || '';

  viewer.append(
    el('div', 'contact-big-avatar', name[0].toUpperCase()),
    el('div', 'contact-big-name', name),
    el('div', 'contact-big-org', [title, org].filter(Boolean).join(' · '))
  );

  const fields = el('div', 'contact-fields');
  const addField = (label, value, isLink = false) => {
    if (!value) return;
    const g = el('div', 'contact-field-group');
    g.appendChild(el('div', 'contact-field-label', label));
    if (isLink) {
      const val = el('div', 'contact-field-val');
      val.appendChild(el('a', '', value, { href: isLink === 'mail' ? `mailto:${value}` : `tel:${value}` }));
      g.appendChild(val);
    } else {
      g.appendChild(el('div', 'contact-field-val', value));
    }
    fields.appendChild(g);
  };

  addField('Email', email, 'mail');
  addField('Phone', phone, 'tel');
  addField('Company', org);
  addField('Job Title', title);
  addField('Birthday', birthdayStr);
  addField('Notes', notes);
  viewer.appendChild(fields);

  const actions = el('div', 'contact-actions');
  if (email) {
    const btnMail = el('button', 'action-btn primary', '✉ Send Email');
    btnMail.onclick = () => openComposeModal(email);
    actions.appendChild(btnMail);
  }
  const btnEdit = el('button', 'action-btn', '✏️ Edit');
  btnEdit.onclick = () => openContactModal(c);
  actions.appendChild(btnEdit);

  // Fix 30: Delete contact button
  const btnDel = el('button', 'action-btn', '🗑 Delete');
  btnDel.style.color = 'var(--red, #e05b5b)';
  btnDel.style.borderColor = 'var(--red, #e05b5b)';
  btnDel.onclick = () => deleteContact(c);
  actions.appendChild(btnDel);

  viewer.appendChild(actions);
}

function openContactModal(c) {
  document.getElementById('contact-rn').value = c.resourceName;
  document.getElementById('contact-etag').value = c.etag || '';

  const given  = c.names?.[0]?.givenName  || '';
  const family = c.names?.[0]?.familyName || '';
  if (!given && !family) {
    const parts = (c.names?.[0]?.displayName || '').split(' ');
    document.getElementById('contact-edit-first-name').value = parts[0] || '';
    document.getElementById('contact-edit-last-name').value  = parts.slice(1).join(' ') || '';
  } else {
    document.getElementById('contact-edit-first-name').value = given;
    document.getElementById('contact-edit-last-name').value  = family;
  }

  document.getElementById('contact-edit-email').value   = c.emailAddresses?.[0]?.value || '';
  document.getElementById('contact-edit-phone').value   = c.phoneNumbers?.[0]?.value   || '';
  document.getElementById('contact-edit-company').value = c.organizations?.[0]?.name   || '';
  document.getElementById('contact-edit-title').value   = c.organizations?.[0]?.title  || '';
  document.getElementById('contact-edit-notes').value   = c.biographies?.[0]?.value    || '';

  // Birthday: stored as {year, month, day}
  const bday = c.birthdays?.[0]?.date;
  if (bday) {
    const y = bday.year  ? String(bday.year)  : '????';
    const m = bday.month ? String(bday.month).padStart(2,'0') : '??';
    const d = bday.day   ? String(bday.day).padStart(2,'0')   : '??';
    document.getElementById('contact-edit-birthday').value = `${y}-${m}-${d}`;
  } else {
    document.getElementById('contact-edit-birthday').value = '';
  }

  document.getElementById('contact-modal').classList.add('open');
}

async function saveContact() {
  const rn    = document.getElementById('contact-rn').value;
  const first = document.getElementById('contact-edit-first-name').value.trim();
  const last  = document.getElementById('contact-edit-last-name').value.trim();

  const body = {
    etag: document.getElementById('contact-etag').value,
    names: [{ givenName: first || 'Unknown', familyName: last }]
  };
  const updateFields = ['names'];

  const email   = document.getElementById('contact-edit-email').value.trim();
  const phone   = document.getElementById('contact-edit-phone').value.trim();
  const company = document.getElementById('contact-edit-company').value.trim();
  const title   = document.getElementById('contact-edit-title').value.trim();
  const notes   = document.getElementById('contact-edit-notes').value.trim();
  const bday    = document.getElementById('contact-edit-birthday').value.trim();

  if (email)   { body.emailAddresses = [{ value: email }]; updateFields.push('emailAddresses'); }
  if (phone)   { body.phoneNumbers   = [{ value: phone }]; updateFields.push('phoneNumbers'); }
  if (company || title) {
    body.organizations = [{ name: company, title }];
    updateFields.push('organizations');
  }
  if (notes)   { body.biographies = [{ value: notes, contentType: 'TEXT_PLAIN' }]; updateFields.push('biographies'); }
  if (bday) {
    const parts = bday.split('-');
    const bdayObj = {};
    if (parts[0] && parts[0] !== '????') bdayObj.year  = parseInt(parts[0], 10);
    if (parts[1] && parts[1] !== '??')   bdayObj.month = parseInt(parts[1], 10);
    if (parts[2] && parts[2] !== '??')   bdayObj.day   = parseInt(parts[2], 10);
    if (bdayObj.month && bdayObj.day) {
      body.birthdays = [{ date: bdayObj }];
      updateFields.push('birthdays');
    }
  }

  try {
    await gapi('PATCH', `https://people.googleapis.com/v1/${rn}:updateContact?updatePersonFields=${updateFields.join(',')}`, body);
    toast('Contact updated!', 'success');
    document.getElementById('contact-modal').classList.remove('open');
    loadContacts();
  } catch (err) {
    if (err.message.includes('403') || err.message.includes('permission')) {
      toast('Permission Error: Please log out and log back in to grant Edit Contact permissions.', 'error');
    } else {
      toast('Error saving contact: ' + err.message, 'error');
    }
  }
}

// Fix 30: Delete contact
async function deleteContact(c) {
  const name = c.names?.[0]?.displayName || 'this contact';
  confirmAction('Delete Contact', `Permanently delete "${name}"? This cannot be undone.`, '🗑 Delete', async () => {
    try {
      await gapi('DELETE', `https://people.googleapis.com/v1/${c.resourceName}:deleteContact`);
      toast('Contact deleted', 'success');
      document.getElementById('contact-modal').classList.remove('open');
      // Hide detail panel and reload list
      document.getElementById('contact-viewer').style.display = 'none';
      document.getElementById('contact-detail-empty').style.display = 'flex';
      document.getElementById('contact-detail-panel').classList.remove('open');
      loadContacts();
    } catch (err) {
      toast('Error deleting contact: ' + err.message, 'error');
    }
  }, true);
}
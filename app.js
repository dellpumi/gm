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

// Safely pad Google's URL-safe Base64 to prevent atob() DOM exceptions for binary files
const padB64 = str => {
  let b64 = (str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return b64;
};

function decodeRFC2047(str) {
  if (!str) return '';
  return str.replace(/=\?([a-zA-Z0-9\-]+)\?([bBqQ])\?([^\?]+)\?=/g, (match, charset, encoding, data) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const bin = atob(padB64(data));
        const bytes = new Uint8Array(bin.length);
        for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } else if (encoding.toUpperCase() === 'Q') {
        const decodedBytes =[];
        const qData = data.replace(/_/g, ' ');
        for (let i = 0; i < qData.length; i++) {
          if (qData[i] === '=' && i + 2 < qData.length) {
            decodedBytes.push(parseInt(qData.substring(i + 1, i + 3), 16));
            i += 2;
          } else { decodedBytes.push(qData.charCodeAt(i)); }
        }
        return new TextDecoder(charset.toLowerCase()).decode(new Uint8Array(decodedBytes));
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
  for (let i = 0; i < bytes.length; i += chunkSize) { bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)); }
  return btoa(bin);
}

function encodeSubject(str) {
  if (!str) return '';
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

function chunkString(str, len = 76) {
  let res = '';
  for (let i = 0; i < str.length; i += len) { res += str.slice(i, i + len) + '\r\n'; }
  return res;
}

function encodeFilename(str) {
  if (!str) return '""';
  if (!/[^\x00-\x7F]/.test(str)) return `"${str}"`;
  return encodeSubject(str); 
}

function encodeAddressList(str) {
  if (!str) return '';
  return str.split(/[,;]/).map(part => {
    const match = part.match(/^(.*?)<(.+?)>$/);
    if (match) {
      let name = match[1].trim().replace(/^"|"$/g, '').trim();
      let email = match[2].trim();
      if (/[^\x00-\x7F]/.test(name)) name = encodeSubject(name);
      else if (name) name = `"${name}"`;
      return name ? `${name} <${email}>` : `<${email}>`;
    }
    if (/[^\x00-\x7F]/.test(part)) return encodeSubject(part);
    return part.trim();
  }).filter(Boolean).join(', ');
}

const decodeB64 = str => {
  try {
    const bin = atob(padB64(str));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) { return ''; }
};

const linkify = (text) => {
  const frag = document.createDocumentFragment();
  text.split(/(https?:\/\/[^\s<>"]+)/g).forEach(part => {
    if (part.startsWith('http')) frag.appendChild(el('a', '', part, { href: part, target: '_blank', rel: 'noopener' }));
    else frag.appendChild(document.createTextNode(part));
  });
  return frag;
};

// ===== CORE INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  window.addEventListener('offline', () => toast('You are offline. Reconnect to sync.', 'error'));
  window.addEventListener('online', () => toast('Back online!', 'success'));

  if (Auth.parseHash() || Auth.check()) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    startSessionTimer();
    try {
      await loadUserInfo();
      await loadEmails('INBOX');
      loadAllContactsForAutocomplete(); 
    } catch (err) {
      toast(err.message, 'error');
      if (err.message === 'Session expired') handleSignOut();
    }
  }
});

// ===== EVENT BINDING =====
function setupEventListeners() {
  document.getElementById('btn-login').addEventListener('click', () => { if (!Auth.startLogin()) document.getElementById('setup-screen').classList.add('open'); });
  document.getElementById('link-setup').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('setup-screen').classList.add('open'); });
  document.getElementById('btn-close-setup').addEventListener('click', () => document.getElementById('setup-screen').classList.remove('open'));
  document.getElementById('btn-copy-origin').addEventListener('click', async () => { await navigator.clipboard.writeText(window.location.origin); toast('Copied!', 'success'); });
  document.getElementById('btn-goto-step2').addEventListener('click', () => { document.getElementById('setup-step-1').style.display='none'; document.getElementById('setup-step-2').style.display='block'; });
  document.getElementById('btn-save-client-id').addEventListener('click', () => { Auth.setClientId(document.getElementById('client-id-input').value.trim()); Auth.startLogin(); });
  
  document.getElementById('btn-sign-out').addEventListener('click', () => confirmAction('Sign Out', 'Are you sure you want to log out? This will clear your local app cache and sever connection.', 'Yes, Sign Out', handleSignOut, true));

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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const confirm = document.getElementById('confirm-modal');
      const contact = document.getElementById('contact-modal');
      const evModal = document.getElementById('event-modal');
      const compose = document.getElementById('compose-modal');

      if (confirm.classList.contains('open')) confirm.classList.remove('open');
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
  document.getElementById('btn-close-event').addEventListener('click', () => document.getElementById('event-modal').classList.remove('open'));
  document.getElementById('btn-cancel-event').addEventListener('click', () => document.getElementById('event-modal').classList.remove('open'));
  document.getElementById('btn-save-event').addEventListener('click', saveEvent);

  document.getElementById('btn-close-contact').addEventListener('click', () => document.getElementById('contact-modal').classList.remove('open'));
  document.getElementById('btn-cancel-contact').addEventListener('click', () => document.getElementById('contact-modal').classList.remove('open'));
  document.getElementById('btn-save-contact').addEventListener('click', saveContact);

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
    State.allContacts = (data.connections ||[]).map(c => {
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

function startSessionTimer() {
  clearInterval(State.timerInterval);
  State.timerInterval = setInterval(() => {
    const remain = Math.floor((Auth.getTokenExp() - Date.now()) / 1000);
    const textEl = document.getElementById('timer-text');
    if (remain <= 0) { textEl.textContent = "00:00"; handleSignOut(); }
    else {
      textEl.textContent = `${Math.floor(remain / 60).toString().padStart(2,'0')}:${(remain % 60).toString().padStart(2,'0')}`;
      textEl.style.color = remain < 300 ? 'var(--red)' : '';
    }
  }, 1000);
}

async function handleSignOut() {
  if (State.token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${State.token}`, {
        method: 'POST',
        headers: { 'Content-type': 'application/x-www-form-urlencoded' }
      });
    } catch (e) { console.warn("Revocation failed", e); }
  }

  localStorage.clear();
  sessionStorage.clear();
  Auth.clear();
  State.token = null;
  clearInterval(State.timerInterval);
  
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  toast('Signed out and completely revoked access token', 'info');
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
  const btnMore = document.getElementById('btn-load-more-mail');
  btnMore.style.display = 'none';

  if (!loadMore) {
    State.mail.items =[];
    State.mail.pageToken = null;
    loadingState(container);
    hideEmailDetail();
  }

  const q = encodeURIComponent(label === 'STARRED' ? 'is:starred' : '');
  const labelId = label === 'STARRED' ? '' : `&labelIds=${label}`;
  const pageParam = loadMore && State.mail.pageToken ? `&pageToken=${State.mail.pageToken}` : '';
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30${labelId}${pageParam}${q ? '&q=' + q : ''}`;

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

    State.mail.items =[...State.mail.items, ...newMsgs];
    renderEmailList(newMsgs, !loadMore);
    if (State.mail.pageToken) btnMore.style.display = 'block';

  } catch (err) { toast(`Failed to load mail: ${err.message}`, 'error'); }
  State.mail.isFetching = false;
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

function renderEmailList(msgs, clearFirst) {
  const container = document.getElementById('email-list');
  if (clearFirst) container.innerHTML = '';

  msgs.forEach(m => {
    const headers = {};
    (m.payload?.headers ||[]).forEach(h => headers[h.name] = h.value);
    const isUnread = m.labelIds && m.labelIds.includes('UNREAD');
    
    const fromStr = decodeEntities(decodeRFC2047(headers['From'] || 'Unknown'));
    const toStr = decodeEntities(decodeRFC2047(headers['To'] || 'Unknown'));
    let displayUser = State.mail.label === 'SENT' ? 'To: ' + (toStr.replace(/<.*>/, '').trim() || toStr) : fromStr.replace(/<.*>/, '').trim() || fromStr;
    const ts = formatTimestamp(headers['Date']);

    const div = el('div', `email-item ${isUnread ? 'unread' : ''}`);
    const metaObj = el('div', 'email-meta');
    metaObj.append(el('span', 'email-from', displayUser), el('span', 'email-date', ts));
    
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
  function walk(part) {
    if (!part) return;
    if (part.mimeType === 'text/html' && part.body?.data) { res = { type: 'text/html', data: decodeB64(part.body.data) }; return true; }
    if (part.mimeType === 'text/plain' && part.body?.data && res.data === '') res = { type: 'text/plain', data: decodeB64(part.body.data) };
    if (part.parts) for (const p of part.parts) if (walk(p)) return true;
  }
  if (payload.body?.data && !payload.parts) {
    res.data = decodeB64(payload.body.data);
    res.type = payload.mimeType === 'text/html' ? 'text/html' : 'text/plain';
  } else walk(payload);
  return res;
}

// Deep, strict inspection to pull out ALL binary format attachments reliably
function getAttachmentsAndInlines(payload) {
  const atts = [];
  const inlines =[];

  function walk(part) {
    if (!part) return;

    // Multipart containers aren't files themselves, keep walking inside them.
    if (part.mimeType && part.mimeType.startsWith('multipart/')) {
      (part.parts ||[]).forEach(walk);
      return;
    }

    let filename = part.filename || '';
    const headers = part.headers ||[];
    
    const dispHeader = headers.find(h => h.name.toLowerCase() === 'content-disposition');
    const cidHeader = headers.find(h => h.name.toLowerCase() === 'content-id');
    const typeHeader = headers.find(h => h.name.toLowerCase() === 'content-type');

    // --- Filename extraction (order matters: most specific first) ---
    // 1. RFC 5987 extended parameter (filename*=UTF-8''...) in Content-Disposition
    if (!filename && dispHeader) {
      const match = dispHeader.value.match(/filename\*\s*=\s*[^']+'[^']*'([^;\s]+)/i);
      if (match) filename = decodeURIComponent(match[1]);
    }
    // 2. Quoted or unquoted filename= in Content-Disposition
    if (!filename && dispHeader) {
      const match = dispHeader.value.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (match) filename = match[1].trim();
    }
    // 3. RFC 5987 extended parameter (name*=UTF-8''...) in Content-Type
    if (!filename && typeHeader) {
      const match = typeHeader.value.match(/name\*\s*=\s*[^']+'[^']*'([^;\s]+)/i);
      if (match) filename = decodeURIComponent(match[1]);
    }
    // 4. Quoted or unquoted name= in Content-Type
    if (!filename && typeHeader) {
      const match = typeHeader.value.match(/name\s*=\s*"?([^";]+)"?/i);
      if (match) filename = match[1].trim();
    }

    const hasAttachmentId = !!part.body?.attachmentId;
    const hasInlineData   = !!part.body?.data;
    const isExplicitAttachment = dispHeader && dispHeader.value.toLowerCase().startsWith('attachment');
    const isInline = cidHeader || (dispHeader && dispHeader.value.toLowerCase().startsWith('inline'));

    // An email message body is strictly text/plain or text/html AND has no file-like traits
    const isTextOrHtml = part.mimeType === 'text/plain' || part.mimeType === 'text/html';
    const isBodyContainer = isTextOrHtml && !filename && !hasAttachmentId && !hasInlineData && !isExplicitAttachment;

    if (!isBodyContainer) {
      filename = filename ? decodeRFC2047(filename).replace(/(^"|"$)/g, '').trim() : 'Unnamed_File';

      if (cidHeader) {
        inlines.push({
          id: cidHeader.value.replace(/[<>]/g, ''),
          attachmentId: part.body?.attachmentId,
          data: part.body?.data,
          mime: part.mimeType,
          filename: filename
        });
      } else if (filename || hasAttachmentId || hasInlineData || isExplicitAttachment) {
        atts.push({
          filename: filename,
          attachmentId: part.body?.attachmentId,
          data: part.body?.data,
          size: part.body?.size || 0,
          mime: part.mimeType
        });
      }
    }
    
    (part.parts ||[]).forEach(walk);
  }
  
  walk(payload);
  return { atts, inlines };
}

async function renderEmail(msg) {
  const viewer = document.getElementById('email-viewer');
  viewer.innerHTML = ''; 
  
  const headers = {};
  (msg.payload?.headers ||[]).forEach(h => headers[h.name] = decodeRFC2047(h.value));

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
          htmlData = htmlData.replace(new RegExp(`cid:${inline.id}`, 'g'), `data:${inline.mime};base64,${base64}`);
        }
      } catch (e) { }
    }
  }

  let cleanHtml = htmlData;
  if (bodyObj.type === 'text/plain') {
    htmlData = escHtml(htmlData).replace(/\r?\n/g, '<br>');
    cleanHtml = htmlData;
  } else {
    const bodyMatch = htmlData.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) cleanHtml = bodyMatch[1];
  }

  State.reply.originalHtml = cleanHtml;
  State.reply.originalFrom = decodeEntities(headers['From'] || 'Unknown');
  State.reply.originalDate = headers['Date'] || '';

  const bodyContainer = el('div', 'email-body');
  if (bodyObj.type === 'text/html') {
    const iframe = el('iframe', '', '', { style: 'width:100%; height:600px; border:1px solid var(--border); background:#fff; border-radius:8px;', sandbox: 'allow-popups allow-popups-to-escape-sandbox' });
    
    let safeHtml = htmlData;
    if (!/<base\s/i.test(safeHtml)) {
       if (/<head[^>]*>/i.test(safeHtml)) {
           safeHtml = safeHtml.replace(/(<head[^>]*>)/i, '$1<base target="_blank">');
       } else {
           safeHtml = '<base target="_blank">' + safeHtml;
       }
    }
    
    iframe.setAttribute('srcdoc', safeHtml);
    bodyContainer.appendChild(iframe);
  } else {
    bodyContainer.appendChild(linkify(htmlData));
    bodyContainer.style.whiteSpace = 'pre-wrap';
  }
  scrollWrapper.appendChild(bodyContainer);

  if (atts.length > 0) {
    const attContainer = el('div', 'attachments');
    attContainer.appendChild(el('div', 'attachments-title', `📎 Attachments (${atts.length})`));
    const chips = el('div', 'attachment-chips');
    
    atts.forEach(a => {
      const chip = el('div', 'attachment-chip');
      if (a.mime && a.mime.startsWith('image/')) {
        chip.classList.add('is-image');
        const img = el('img', 'attachment-thumb');
        chip.append(img, el('span', 'chip-name', a.filename));
        if (a.data) {
          img.src = `data:${a.mime};base64,${padB64(a.data)}`;
        } else if (a.attachmentId) {
          gapi('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${a.attachmentId}`)
            .then(data => { img.src = `data:${a.mime};base64,${padB64(data.data)}`; })
            .catch(() => { img.src = ''; }); 
        }
      } else {
        chip.append(el('span','','📄'), el('span','chip-name', a.filename), el('span', 'chip-size', formatBytes(a.size)));
      }
      chip.onclick = () => downloadAttachment(msg.id, a.attachmentId, a.filename, a.data, a.mime);
      chips.appendChild(chip);
    });
    attContainer.appendChild(chips);
    scrollWrapper.appendChild(attContainer);
  }

  viewer.append(headerSec, scrollWrapper);

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
    State.compose.attachments = forwardFiles;
    openComposeModal('', 'Fwd: ' + decodeEntities(headers['Subject'] || ''), bodyStr, 'Forward Message', true);
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
  } catch(e) { toast('Error downloading attachment', 'error'); }
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
    
    document.getElementById('reply-to').value = targetRecipient || '';
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
  const to = document.getElementById('reply-to').value.replace(/;/g, ',').trim();
  const subj = document.getElementById('reply-subject').value.trim();
  const body = document.getElementById('reply-body').innerHTML;
  if (!to) return toast('Recipient is required', 'error');

  try {
    await sendRawEmail(to, '', subj, body, State.reply.attachments, State.compose.currentThreadId);
    toggleReply(true); 
    toast('Reply sent!', 'success');
    refreshCurrent();
  } catch (e) { toast('Failed to send reply: ' + e.message, 'error'); }
}

function openComposeModal(to='', subj='', bodyHtml='', title='New Message', keepAttachments=false) {
  document.getElementById('compose-modal').classList.add('open');
  document.getElementById('compose-title').textContent = title;
  document.getElementById('compose-to').value = to;
  document.getElementById('compose-cc').value = '';
  document.getElementById('compose-subject').value = subj;
  document.getElementById('compose-body-text').innerHTML = bodyHtml;
  if (!keepAttachments) State.compose.attachments =[];
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
  State[type].attachments.forEach(file => {
    const tag = el('div', 'attached-file-tag', `📄 ${file.name} `);
    const btn = el('button', '', '✕');
    btn.onclick = () => { State[type].attachments = State[type].attachments.filter(f => f !== file); tag.remove(); };
    tag.appendChild(btn);
    list.appendChild(tag);
  });
}

async function sendEmail() {
  const to = document.getElementById('compose-to').value.replace(/;/g, ',').trim();
  const cc = document.getElementById('compose-cc').value.replace(/;/g, ',').trim();
  const subj = document.getElementById('compose-subject').value.trim();
  const body = document.getElementById('compose-body-text').innerHTML;
  if (!to) return toast('Recipient required', 'error');
  
  try {
    await sendRawEmail(to, cc, subj, body, State.compose.attachments, null);
    document.getElementById('compose-modal').classList.remove('open');
    State.compose.attachments =[];
    toast('Sent successfully', 'success');
    refreshCurrent();
  } catch (e) { toast('Failed to send: ' + e.message, 'error'); }
}

async function sendRawEmail(to, cc, subject, htmlBody, attachments, threadId) {
  const boundaryMixed = 'aether_mixed_' + Math.random().toString(36).substr(2);
  const boundaryRel = 'aether_rel_' + Math.random().toString(36).substr(2);
  
  let emailStr = `To: ${encodeAddressList(to)}\r\n`;
  if (cc) emailStr += `Cc: ${encodeAddressList(cc)}\r\n`;
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
      const encodedName = encodeFilename(file.name);
      emailStr += `--${boundaryMixed}\r\n`;
      emailStr += `Content-Type: ${file.type || 'application/octet-stream'}; name=${encodedName}\r\n`;
      emailStr += `Content-Disposition: attachment; filename=${encodedName}\r\n`;
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
    
    const calSelect = document.getElementById('event-calendar');
    calSelect.innerHTML = '';
    State.calendar.calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer').forEach(c => {
      calSelect.appendChild(el('option', '', c.summary, { value: c.id }));
    });
  } catch (err) { toast('Error loading calendar list', 'error'); return; }

  renderCalendarGrid();
  const start = new Date(State.calendar.date.getFullYear(), State.calendar.date.getMonth(), 1).toISOString();
  const end = new Date(State.calendar.date.getFullYear(), State.calendar.date.getMonth() + 1, 0, 23, 59, 59).toISOString();
  
  try {
    const eventPromises = State.calendar.calendars.filter(c => c.selected !== false).map(async (c) => {
      try {
        const data = await gapi('GET', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime&maxResults=100`);
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

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const today = new Date();

  const wdContainer = document.getElementById('cal-weekdays');
  wdContainer.innerHTML = '';['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => wdContainer.appendChild(el('div', 'cal-weekday', d)));

  const container = document.getElementById('cal-days');
  container.innerHTML = '';
  let cells =[];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: prevDays - i, current: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, current: true });
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - firstDay - daysInMonth + 1, current: false });

  const eventsData = eventsToRender || State.calendar.events;
  
  cells.forEach(cell => {
    const div = el('div', `cal-day ${!cell.current ? 'other-month' : ''}`);
    const isToday = cell.current && cell.day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    if (isToday) div.classList.add('today');

    div.appendChild(el('div', 'day-num', cell.day));

    if (cell.current) {
      const dayEvents = eventsData.filter(e => {
        const d = new Date(e.start?.dateTime || e.start?.date);
        return d.getDate() === cell.day && d.getMonth() === month && d.getFullYear() === year;
      });
      dayEvents.forEach((e) => {
        const time = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' ' : '';
        const chip = el('div', 'cal-event', time + (e.summary || 'No title'));
        chip.style.backgroundColor = e.backgroundColor || '#5b8af0';
        chip.style.color = e.foregroundColor || '#fff';
        
        chip.addEventListener('click', (ev) => { ev.stopPropagation(); openEventModal(e); });
        div.appendChild(chip);
      });
      div.addEventListener('dblclick', () => {
        const dtStr = new Date(year, month, cell.day, 9, 0).toISOString().slice(0,16);
        openEventModal();
        document.getElementById('event-start').value = dtStr;
        document.getElementById('event-end').value = new Date(new Date(year, month, cell.day, 10, 0)).toISOString().slice(0,16);
      });
    }
    container.appendChild(div);
  });
}

function openEventModal(event) {
  State.calendar.editingEventId = event?.id || null;
  State.calendar.editingCalendarId = event?.calendarId || null;
  
  document.getElementById('event-modal-title').textContent = event ? 'Edit Event' : 'New Event';
  document.getElementById('event-title').value = event?.summary || '';
  document.getElementById('event-location').value = event?.location || '';
  document.getElementById('event-desc').value = event?.description || '';
  
  const calSelect = document.getElementById('event-calendar');
  calSelect.disabled = !!event; 
  if (event?.calendarId) calSelect.value = event.calendarId;
  
  const now = new Date();
  document.getElementById('event-start').value = event?.start?.dateTime?.slice(0,16) || now.toISOString().slice(0,16);
  document.getElementById('event-end').value = event?.end?.dateTime?.slice(0,16) || new Date(now.getTime()+3600000).toISOString().slice(0,16);
  document.getElementById('event-modal').classList.add('open');
}

async function saveEvent() {
  const summary = document.getElementById('event-title').value.trim();
  if (!summary) return toast('Please enter a title', 'error');
  const start = document.getElementById('event-start').value;
  const end = document.getElementById('event-end').value;
  
  const body = { 
    summary, 
    start: { dateTime: new Date(start).toISOString() }, 
    end: { dateTime: new Date(end).toISOString() }, 
    location: document.getElementById('event-location').value.trim() || undefined, 
    description: document.getElementById('event-desc').value.trim() || undefined 
  };

  const calId = State.calendar.editingEventId ? State.calendar.editingCalendarId : document.getElementById('event-calendar').value;

  try {
    if (State.calendar.editingEventId) await gapi('PUT', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${State.calendar.editingEventId}`, body);
    else await gapi('POST', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, body);
    
    document.getElementById('event-modal').classList.remove('open');
    toast('Event saved!', 'success');
    loadCalendar();
  } catch(e) { toast('Error saving event', 'error'); }
}

// ===== CONTACTS =====
async function loadContacts(loadMore = false) {
  const container = document.getElementById('contacts-list');
  if (!loadMore) { 
    container.innerHTML = ''; 
    State.contacts.pageToken = null; 
    loadingState(container); 
    document.getElementById('contact-detail-panel').classList.remove('open');
    document.getElementById('contact-viewer').style.display = 'none';
    document.getElementById('contact-detail-empty').style.display = 'flex';
  }
  
  try {
    const pageParam = loadMore && State.contacts.pageToken ? `&pageToken=${State.contacts.pageToken}` : '';
    const data = await gapi('GET', `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations&pageSize=100${pageParam}`);
    
    State.contacts.pageToken = data.nextPageToken || null;
    if(!loadMore) State.contacts.items =[];
    
    const items = data.connections ||[];
    State.contacts.items =[...State.contacts.items, ...items];
    
    renderContactsList(State.contacts.items, !loadMore);
    document.getElementById('btn-load-more-contacts').style.display = State.contacts.pageToken ? 'block' : 'none';
  } catch(err) { toast('Error loading contacts', 'error'); }
}

function filterContacts(q) {
  const f = State.contacts.items.filter(c => {
    const name = c.names?.[0]?.displayName || '';
    const email = c.emailAddresses?.[0]?.value || '';
    return name.toLowerCase().includes(q.toLowerCase()) || email.toLowerCase().includes(q.toLowerCase());
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

  const name = c.names?.[0]?.displayName || 'Unknown';
  const email = c.emailAddresses?.[0]?.value || '';
  const phone = c.phoneNumbers?.[0]?.value || '';
  const org = c.organizations?.[0]?.name || '';
  const title = c.organizations?.[0]?.title || '';

  viewer.append(
    el('div', 'contact-big-avatar', name[0].toUpperCase()),
    el('div', 'contact-big-name', name),
    el('div', 'contact-big-org',[title, org].filter(Boolean).join(' · '))
  );

  const fields = el('div', 'contact-fields');
  if (email) {
    const eGroup = el('div', 'contact-field-group');
    const a = el('a', '', email, { href: `mailto:${email}` });
    const val = el('div', 'contact-field-val'); val.appendChild(a);
    eGroup.append(el('div', 'contact-field-label', 'Email'), val);
    fields.appendChild(eGroup);
  }
  if (phone) {
    const pGroup = el('div', 'contact-field-group');
    pGroup.append(el('div', 'contact-field-label', 'Phone'), el('div', 'contact-field-val', phone));
    fields.appendChild(pGroup);
  }
  viewer.appendChild(fields);

  const actions = el('div', 'contact-actions');
  if (email) {
    const btnEmail = el('button', 'action-btn primary', '✉ Send Email');
    btnEmail.onclick = () => openComposeModal(email);
    actions.appendChild(btnEmail);
  }
  const btnEdit = el('button', 'action-btn', '✏️ Edit Contact');
  btnEdit.onclick = () => openContactModal(c);
  actions.appendChild(btnEdit);
  
  viewer.appendChild(actions);
}

function openContactModal(c) {
  document.getElementById('contact-rn').value = c.resourceName;
  document.getElementById('contact-etag').value = c.etag || '';
  
  const given = c.names?.[0]?.givenName || '';
  const family = c.names?.[0]?.familyName || '';
  
  if (!given && !family) {
    const parts = (c.names?.[0]?.displayName || '').split(' ');
    document.getElementById('contact-edit-first-name').value = parts[0] || '';
    document.getElementById('contact-edit-last-name').value = parts.slice(1).join(' ') || '';
  } else {
    document.getElementById('contact-edit-first-name').value = given;
    document.getElementById('contact-edit-last-name').value = family;
  }
  
  document.getElementById('contact-edit-email').value = c.emailAddresses?.[0]?.value || '';
  document.getElementById('contact-edit-phone').value = c.phoneNumbers?.[0]?.value || '';
  document.getElementById('contact-modal').classList.add('open');
}

async function saveContact() {
  const rn = document.getElementById('contact-rn').value;
  const first = document.getElementById('contact-edit-first-name').value.trim();
  const last = document.getElementById('contact-edit-last-name').value.trim();
  
  const body = { 
    etag: document.getElementById('contact-etag').value, 
    names:[{ givenName: first || 'Unknown', familyName: last }] 
  };
  const updateFields =['names'];
  
  const email = document.getElementById('contact-edit-email').value.trim();
  const phone = document.getElementById('contact-edit-phone').value.trim();
  if (email) { body.emailAddresses =[{ value: email }]; updateFields.push('emailAddresses'); }
  if (phone) { body.phoneNumbers =[{ value: phone }]; updateFields.push('phoneNumbers'); }

  try {
    await gapi('PATCH', `https://people.googleapis.com/v1/${rn}:updateContact?updatePersonFields=${updateFields.join(',')}`, body);
    toast('Contact updated!', 'success');
    document.getElementById('contact-modal').classList.remove('open');
    loadContacts(); 
  } catch (err) { 
    if (err.message.includes('403') || err.message.includes('permission')) {
      toast('Permission Error: Please log out and log back in to grant Edit Contact permissions.', 'error');
    } else {
      toast('Error saving contact', 'error'); 
    }
  }
}
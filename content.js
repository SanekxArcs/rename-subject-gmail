/**
 * Gmail Subject Renamer – content script
 *
 * DOM structure (from real Gmail HTML):
 *   List view:  span.bog > span[data-thread-id="#thread-f:123"]   ← subject text
 *   Open view:  h2.hP                                              ← subject heading
 *   URL hash:   #inbox/thread-f:123  or  #thread-f:123
 *
 * Thread ID key is normalised to strip the leading '#':
 *   data-thread-id="#thread-f:123" → stored as "thread-f:123"
 *   URL #inbox/thread-f:123        → stored as "thread-f:123"
 */

'use strict';

/* ─── Constants ─────────────────────────────────────────────── */
const STORAGE_KEY_PREFIX = 'gsrn_';
const RECENT_COLORS_KEY = 'gsrn_recent_colors';
const MODAL_ID = 'gsrn-modal';
const ORIGINAL_ATTR = 'data-gsrn-original';

const SERVICES = [
  { id: 'AC', label: 'Autocomplete' },
  { id: 'S', label: 'Search' },
  { id: 'RECO', label: 'Recommendations' },
  { id: 'PLP', label: 'PLP' },
  { id: 'PDP', label: 'PDP' },
  { id: 'SA', label: 'Shopping Assistant' }
];

/* ─── Color helpers ─────────────────────────────────────────── */

/** Normalise color strings (hex or rgb) to #rrggbb */
function normalizeToHex(color) {
  if (!color || color === 'inherit' || color === 'transparent') return '';
  if (color.startsWith('#')) return color;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  if (m) {
    const toHex = x => parseInt(x).toString(16).padStart(2, '0');
    return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
  }
  return color;
}

/* ─── Extension context guard ────────────────────────────────── */
// When the extension is reloaded/updated in Chrome, all chrome.* APIs
// throw "Extension context invalidated". We detect this and shut down
// cleanly so the page doesn't get a stream of uncaught errors.

let _alive = true;

function isAlive() {
  if (!_alive) return false;
  try {
    _alive = !!(chrome.runtime && chrome.runtime.id);
    return _alive;
  } catch {
    _alive = false;
    return false;
  }
}

// Called when context is gone — disconnect everything.
function die() {
  _alive = false;
  try { observer.disconnect(); } catch { /* observer may not be defined yet */ }
  window.removeEventListener('hashchange', onHashChange);
}

function safeGet(key, cb) {
  if (!isAlive()) return;
  try {
    chrome.storage.local.get(key, (res) => {
      if (chrome.runtime.lastError) return; // swallow benign errors
      cb(res);
    });
  } catch (e) {
    if (String(e).includes('context')) die();
  }
}

function safeSet(data, cb) {
  if (!isAlive()) return;
  try { chrome.storage.local.set(data, cb || (() => {})); }
  catch (e) { if (String(e).includes('context')) die(); }
}

function safeRemove(key, cb) {
  if (!isAlive()) return;
  try { chrome.storage.local.remove(key, cb || (() => {})); }
  catch (e) { if (String(e).includes('context')) die(); }
}

/* ─── Thread ID helpers ──────────────────────────────────────── */

/** Strip leading '#' so data-thread-id values match URL-derived IDs */
function normalizeId(raw) { return raw ? raw.replace(/^#/, '') : null; }

/**
 * Extract thread ID from URL hash.
 * Examples: #inbox/thread-f:123  →  thread-f:123
 *           #thread-a:r-456      →  thread-a:r-456
 */
function urlThreadId() {
  const m = window.location.hash.match(/\/(thread-[^/]+)/);
  if (m) return m[1];
  const d = window.location.hash.match(/^#(thread-[^/]+)/);
  return d ? d[1] : null;
}

/* ─── Storage helpers ────────────────────────────────────────── */

const skey = (tid) => STORAGE_KEY_PREFIX + tid;

function allRenames(cb) {
  safeGet(null, (items) => {
    const map = {};
    for (const [k, v] of Object.entries(items || {}))
      if (k.startsWith(STORAGE_KEY_PREFIX)) map[k.slice(STORAGE_KEY_PREFIX.length)] = v;
    cb(map);
  });
}

// Parse stored value: old string format or new {text, color, services, fontWeight, fontStyle} object.
function parseValue(v) {
  if (!v) return null;
  if (typeof v === 'string') return { text: v, color: '', services: [], fontWeight: '', fontStyle: '' };
  return {
    text: v.text || '',
    color: v.color || '',
    services: v.services || [],
    fontWeight: v.fontWeight || '',
    fontStyle: v.fontStyle || ''
  };
}

const saveRename = (tid, text, color, services, fontWeight, fontStyle, cb) =>
  safeSet({ [skey(tid)]: { text, color: color || '', services: services || [], fontWeight: fontWeight || '', fontStyle: fontStyle || '' } }, cb);
const deleteRename = (tid, cb)              => safeRemove(skey(tid), cb);

/* ─── Apply / restore text ───────────────────────────────────── */

function getSubjectWithServices(text, services) {
  if (!services || services.length === 0) return text;
  return `${text} - | ${services.join(' | ')} |`;
}

function applyText(el, entry) {
  const { text, color, services, fontWeight, fontStyle } = entry;
  if (!el.hasAttribute(ORIGINAL_ATTR)) {
    el.setAttribute(ORIGINAL_ATTR, el.textContent.trim());
    el.setAttribute('data-gsrn-orig-color', el.style.color);
    el.setAttribute('data-gsrn-orig-weight', el.style.fontWeight);
    el.setAttribute('data-gsrn-orig-style', el.style.fontStyle);
  }
  const finalText = getSubjectWithServices(text, services);
  // Guard: skip no-op writes to avoid triggering the MutationObserver loop.
  if (el.textContent !== finalText) el.textContent = finalText;
  el.style.color = color || '';
  el.style.fontWeight = fontWeight || '';
  el.style.fontStyle = fontStyle || '';
  el.setAttribute('data-gsrn-applied', '1');
  el.title = `Renamed · original: "${el.getAttribute(ORIGINAL_ATTR)}"`;
}

function restoreText(el) {
  const orig = el.getAttribute(ORIGINAL_ATTR);
  if (orig === null) return;
  if (el.textContent !== orig) el.textContent = orig;
  el.style.color = el.getAttribute('data-gsrn-orig-color') || '';
  el.style.fontWeight = el.getAttribute('data-gsrn-orig-weight') || '';
  el.style.fontStyle = el.getAttribute('data-gsrn-orig-style') || '';
  el.removeAttribute(ORIGINAL_ATTR);
  el.removeAttribute('data-gsrn-orig-color');
  el.removeAttribute('data-gsrn-orig-weight');
  el.removeAttribute('data-gsrn-orig-style');
  el.removeAttribute('data-gsrn-applied');
  el.removeAttribute('title');
}

/* ─── Modal dialog ───────────────────────────────────────────── */

const closeModal = () => { document.getElementById(MODAL_ID)?.remove(); };

function hsvToRgb(h, s, v) {
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v, g = t, b = p; break;
    case 1: r = q, g = v, b = p; break;
    case 2: r = p, g = v, b = t; break;
    case 3: r = p, g = q, b = v; break;
    case 4: r = t, g = p, b = v; break;
    case 5: r = v, g = p, b = q; break;
  }
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv(color) {
  const hex = normalizeToHex(color) || '#000000';
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, v };
}

// current = { text: string, color: string, services: string[], fontWeight: string, fontStyle: string }
function openModal(tid, current, onSave) {
  closeModal();
  const hasColor  = !!(current && current.color);
  const initColor = normalizeToHex(hasColor ? current.color : '#1a73e8');
  const selectedServices = current ? (current.services || []) : [];
  let currentFontWeight = (current && current.fontWeight) || '';
  let currentFontStyle  = (current && current.fontStyle)  || '';

  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Rename email subject');

  const servicesHtml = SERVICES.map(s => `
    <label class="gsrn-service-chip">
      <input type="checkbox" value="${s.id}" ${selectedServices.includes(s.id) ? 'checked' : ''} />
      <span>${s.label}</span>
    </label>
  `).join('');

  const predesignedColors = ['#1a73e8', '#d93025', '#188038', '#f9ab00', '#e37400', '#9334e6', '#000000', '#5f6368'];

  overlay.innerHTML = `
    <div class="gsrn-modal-box">
      <h3 class="gsrn-modal-title">Rename Subject</h3>
      <p class="gsrn-modal-hint">Stored <strong>locally</strong> — only you see this.</p>
      
      <label class="gsrn-modal-label" for="gsrn-input">New subject:</label>
      <input id="gsrn-input" class="gsrn-modal-input" type="text" maxlength="512" placeholder="Enter new subject…" />

      <div class="gsrn-typography-section">
        <label class="gsrn-modal-label">Text style:</label>
        <div class="gsrn-type-controls">
          <div class="gsrn-toggle-group" data-group="weight">
            <button type="button" class="gsrn-toggle-btn${!currentFontWeight ? ' gsrn-toggle-active' : ''}" data-value="">Normal</button>
            <button type="button" class="gsrn-toggle-btn${currentFontWeight === 'bold' ? ' gsrn-toggle-active' : ''}" data-value="bold"><strong>Bold</strong></button>
          </div>
          <div class="gsrn-toggle-group" data-group="style">
            <button type="button" class="gsrn-toggle-btn${!currentFontStyle ? ' gsrn-toggle-active' : ''}" data-value="">Normal</button>
            <button type="button" class="gsrn-toggle-btn${currentFontStyle === 'italic' ? ' gsrn-toggle-active' : ''}" data-value="italic"><em>Italic</em></button>
          </div>
        </div>
      </div>

      <div class="gsrn-services-section">
        <label class="gsrn-modal-label">Services:</label>
        <div class="gsrn-services-list">${servicesHtml}</div>
      </div>

      <div class="gsrn-color-section">
        <div class="gsrn-color-header">
          <label class="gsrn-color-label">
            <input id="gsrn-use-color" type="checkbox" ${hasColor ? 'checked' : ''} />
            Custom color:
          </label>
          <span id="gsrn-color-preview" class="gsrn-color-preview"
                style="color:${hasColor ? initColor : 'inherit'};opacity:${hasColor ? 1 : 0.4}">
            Preview text
          </span>
        </div>
        
        <div id="gsrn-color-picker-container" class="${hasColor ? '' : 'gsrn-disabled'}">
          <div class="gsrn-color-picker-main">
            <div id="gsrn-color-area" class="gsrn-color-area" style="background-color: #ff0000;">
              <div class="gsrn-color-area-white"></div>
              <div class="gsrn-color-area-black"></div>
              <div id="gsrn-color-cursor" class="gsrn-color-cursor"></div>
            </div>
            <div id="gsrn-hue-slider" class="gsrn-hue-slider">
              <div id="gsrn-hue-cursor" class="gsrn-hue-cursor"></div>
            </div>
          </div>
          
          <div class="gsrn-color-presets">
             <div class="gsrn-presets-label">Preset:</div>
             <div class="gsrn-presets-list">
               ${predesignedColors.map(c => `<div class="gsrn-color-swatch" style="background:${c}" data-color="${c}"></div>`).join('')}
             </div>
          </div>
          <div id="gsrn-recent-colors" class="gsrn-color-presets gsrn-recent">
             <div class="gsrn-presets-label">Recent:</div>
             <div id="gsrn-recent-list" class="gsrn-presets-list"></div>
          </div>
        </div>
      </div>

      <div class="gsrn-modal-actions">
        <button id="gsrn-save"  class="gsrn-btn gsrn-btn-primary">Save</button>
        <button id="gsrn-reset" class="gsrn-btn gsrn-btn-secondary">Reset to original</button>
        <button id="gsrn-cancel" class="gsrn-btn gsrn-btn-ghost">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input      = overlay.querySelector('#gsrn-input');
  const useColor   = overlay.querySelector('#gsrn-use-color');
  const preview    = overlay.querySelector('#gsrn-color-preview');
  const pickerContainer = overlay.querySelector('#gsrn-color-picker-container');
  const colorArea  = overlay.querySelector('#gsrn-color-area');
  const colorCursor = overlay.querySelector('#gsrn-color-cursor');
  const hueSlider  = overlay.querySelector('#gsrn-hue-slider');
  const hueCursor  = overlay.querySelector('#gsrn-hue-cursor');
  const recentList = overlay.querySelector('#gsrn-recent-list');

  let currentColor = initColor;
  let { h, s, v } = rgbToHsv(initColor);

  const updateUI = () => {
    const hex = hsvToRgb(h, s, v);
    currentColor = hex;
    colorArea.style.backgroundColor = hsvToRgb(h, 1, 1);
    colorCursor.style.left = `${s * 100}%`;
    colorCursor.style.top = `${(1 - v) * 100}%`;
    hueCursor.style.top = `${h * 100}%`;

    const on = useColor.checked;
    pickerContainer.classList.toggle('gsrn-disabled', !on);
    preview.style.color      = on ? hex : 'inherit';
    preview.style.opacity    = on ? '1' : '0.4';
    preview.style.fontWeight = currentFontWeight;
    preview.style.fontStyle  = currentFontStyle;
  };

  const setFromHex = (hex) => {
    const hsv = rgbToHsv(hex);
    h = hsv.h; s = hsv.s; v = hsv.v;
    updateUI();
  };

  // Drag logic for area
  const handleAreaMove = (e) => {
    const rect = colorArea.getBoundingClientRect();
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;
    s = Math.max(0, Math.min(1, x));
    v = Math.max(0, Math.min(1, 1 - y));
    updateUI();
  };

  const handleHueMove = (e) => {
    const rect = hueSlider.getBoundingClientRect();
    let y = (e.clientY - rect.top) / rect.height;
    h = Math.max(0, Math.min(1, y));
    updateUI();
  };

  const setupDrag = (el, fn) => {
    const onMove = (e) => { fn(e); e.preventDefault(); };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    el.addEventListener('mousedown', (e) => {
      fn(e);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  };

  setupDrag(colorArea, handleAreaMove);
  setupDrag(hueSlider, handleHueMove);

  overlay.querySelectorAll('.gsrn-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => setFromHex(sw.dataset.color));
  });

  useColor.addEventListener('change', updateUI);

  overlay.querySelectorAll('.gsrn-toggle-group').forEach(group => {
    group.querySelectorAll('.gsrn-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.gsrn-toggle-btn').forEach(b => b.classList.remove('gsrn-toggle-active'));
        btn.classList.add('gsrn-toggle-active');
        if (group.dataset.group === 'weight') currentFontWeight = btn.dataset.value;
        else currentFontStyle = btn.dataset.value;
        updateUI();
      });
    });
  });

  // Recent colors
  safeGet(RECENT_COLORS_KEY, (res) => {
    const recent = res[RECENT_COLORS_KEY] || [];
    recentList.innerHTML = recent.map(c => `<div class="gsrn-color-swatch" style="background:${c}" data-color="${c}"></div>`).join('');
    recentList.querySelectorAll('.gsrn-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => setFromHex(sw.dataset.color));
    });
  });

  input.value = current ? current.text : '';
  updateUI();
  requestAnimationFrame(() => { input.focus(); input.select(); });

  overlay.querySelector('#gsrn-cancel').addEventListener('click', closeModal);
  overlay.querySelector('#gsrn-reset').addEventListener('click', () =>
    deleteRename(tid, () => { onSave(null); closeModal(); }));
  
  overlay.querySelector('#gsrn-save').addEventListener('click', () => {
    const textVal = input.value.trim();
    if (!textVal) return;
    const finalColor = useColor.checked ? currentColor : '';
    const services = Array.from(overlay.querySelectorAll('.gsrn-service-chip input:checked')).map(i => i.value);
    
    if (finalColor) {
      safeGet(RECENT_COLORS_KEY, (res) => {
        let recent = res[RECENT_COLORS_KEY] || [];
        recent = [finalColor, ...recent.filter(c => c !== finalColor)].slice(0, 8);
        safeSet({ [RECENT_COLORS_KEY]: recent });
      });
    }

    saveRename(tid, textVal, finalColor, services, currentFontWeight, currentFontStyle, () => {
      onSave({ text: textVal, color: finalColor, services, fontWeight: currentFontWeight, fontStyle: currentFontStyle });
      closeModal();
    });
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && document.activeElement === input)
      overlay.querySelector('#gsrn-save').click();
  });
}

/* ─── Rename button factory ──────────────────────────────────── */

// getEntry() must return { text, color } for the modal pre-fill.
function makeBtn(tid, getEntry, onSave) {
  const btn = document.createElement('button');
  btn.className = 'gsrn-rename-btn';
  btn.textContent = '✏️';
  btn.title = 'Rename subject (local only)';
  btn.setAttribute('aria-label', 'Rename email subject locally');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    openModal(tid, getEntry(), onSave);
  });
  return btn;
}

/* ─── List view ──────────────────────────────────────────────── */

function processListView(renames) {
  // 1. Apply / restore renames on all visible subject spans.
  document.querySelectorAll('span.bog > span[data-thread-id]').forEach(span => {
    const tid   = normalizeId(span.getAttribute('data-thread-id'));
    if (!tid) return;
    const entry = renames[tid] ? parseValue(renames[tid]) : null;

    if (entry && entry.text) {
      applyText(span, entry);
      // For already-renamed spans the hover pen is hidden via CSS :has().
      // Instead, clicking the span text opens the edit modal.
      if (!span.dataset.gsrnClick) {
        span.dataset.gsrnClick = '1';
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const onSave = (ns) => {
            if (ns) {
              applyText(span, ns);
              entry.text = ns.text;
              entry.color = ns.color;
              entry.services = ns.services;
              entry.fontWeight = ns.fontWeight;
              entry.fontStyle = ns.fontStyle;
            } else {
              restoreText(span);
            }
          };
          openModal(tid, entry, onSave);
        });
      }
    } else if (span.hasAttribute(ORIGINAL_ATTR)) {
      restoreText(span);
    }
  });

  // 2. Inject rename buttons (button-presence check, not a marker attribute).
  document.querySelectorAll('tr.zA').forEach(row => {
    if (row.querySelector('.gsrn-rename-btn')) return; // button already there
    const subjectSpan = row.querySelector('span.bog > span[data-thread-id]');
    if (!subjectSpan) return;
    const bogSpan = subjectSpan.parentElement; // span.bog
    const tid     = normalizeId(subjectSpan.getAttribute('data-thread-id'));
    if (!tid) return;
    const onSave = (ns) => {
      if (ns) applyText(subjectSpan, ns);
      else    restoreText(subjectSpan);
    };
    const btn = makeBtn(
      tid,
      () => {
        const entry = renames[tid] ? parseValue(renames[tid]) : null;
        return entry || { text: subjectSpan.textContent.trim(), color: normalizeToHex(subjectSpan.style.color), services: [], fontWeight: '', fontStyle: '' };
      },
      onSave
    );
    bogSpan.insertAdjacentElement('afterend', btn);
  });
}

/* ─── Open-thread view ───────────────────────────────────────── */

function processThreadView() {
  const h2  = document.querySelector('h2.hP');
  const tid = urlThreadId();
  if (!h2 || !tid) return;

  safeGet(skey(tid), (result) => {
    const entry = result ? parseValue(result[skey(tid)]) : null;
    if (entry && entry.text) applyText(h2, entry);
    else if (h2.hasAttribute(ORIGINAL_ATTR)) restoreText(h2);

    // Guard against duplicate injection from concurrent async calls.
    if (!document.getElementById('gsrn-thread-btn')) {
      const onSave = (ns) => {
        if (ns) {
          applyText(h2, ns);
          if (entry) {
            entry.text = ns.text;
            entry.color = ns.color;
            entry.services = ns.services;
            entry.fontWeight = ns.fontWeight;
            entry.fontStyle = ns.fontStyle;
          }
        } else {
          restoreText(h2);
        }
      };
      const btn = makeBtn(
        tid,
        () => entry || { text: h2.textContent.trim(), color: normalizeToHex(h2.style.color), services: [], fontWeight: '', fontStyle: '' },
        onSave
      );
      btn.id = 'gsrn-thread-btn';
      h2.insertAdjacentElement('afterend', btn);
    }
  });
}

/* ─── Main run ───────────────────────────────────────────────── */

function run() {
  if (!isAlive()) return;
  const inThread = !!document.querySelector('h2.hP') && !!urlThreadId();
  if (inThread) {
    processThreadView();
  } else {
    document.getElementById('gsrn-thread-btn')?.remove();
    allRenames(processListView);
  }
}

/* ─── MutationObserver + SPA navigation ─────────────────────── */

let pending = false;

function scheduleRun() {
  if (!isAlive() || pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; run(); });
}

function onHashChange() { closeModal(); scheduleRun(); }
window.addEventListener('hashchange', onHashChange);

const observer = new MutationObserver((mutations) => {
  // Ignore mutations caused solely by our own injected elements.
  // This breaks the self-triggering loop:
  //   our button insertion  → childList mutation → would re-trigger run()
  //   our textContent write → childList mutation → would re-trigger run()
  // Text nodes (nodeType 3) are produced by textContent writes — treat as "ours".
  // Element nodes that are our button or modal — treat as "ours".
  // Everything else (Gmail adding rows, navigating, etc.) — schedule run().
  const ourOnly = mutations.every(m =>
    Array.from(m.addedNodes).every(n =>
      n.nodeType !== Node.ELEMENT_NODE ||         // text/comment nodes → ours
      n.classList?.contains('gsrn-rename-btn') || // our button
      n.id === MODAL_ID                           // our modal
    )
  );
  if (!ourOnly) scheduleRun();
});

observer.observe(document.body, { childList: true, subtree: true });

scheduleRun();

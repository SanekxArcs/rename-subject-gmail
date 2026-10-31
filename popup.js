'use strict';

const ENABLED_KEY = 'gsrn_enabled';
const toggle = document.getElementById('enabled-toggle');
const status = document.getElementById('status');
const statusDot = document.getElementById('status-dot');
const count = document.getElementById('rename-count');
let enabled = true;
let saving = false;

document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

function renderState(value) {
  enabled = value !== false;
  toggle.setAttribute('aria-checked', String(enabled));
  statusDot.classList.toggle('active', enabled);
  status.textContent = enabled ? 'Active · Ready in Gmail' : 'Paused · Your saved subjects are safe';
}

async function loadState() {
  try {
    const items = await chrome.storage.local.get(null);
    renderState(items[ENABLED_KEY]);
    const renameCount = Object.entries(items).filter(([key, value]) =>
      key.startsWith('gsrn_') && key !== ENABLED_KEY && key !== 'gsrn_recent_colors' &&
      (typeof value === 'string' || (value && typeof value.text === 'string'))
    ).length;
    count.textContent = renameCount.toLocaleString('en-US');
    document.getElementById('rename-label').textContent = renameCount === 1 ? ' saved subject' : ' saved subjects';
    toggle.disabled = saving;
  } catch {
    status.textContent = 'Could not load settings. Reopen this popup to retry.';
    statusDot.classList.remove('active');
  }
}

toggle.addEventListener('click', async () => {
  if (saving) return;
  saving = true;
  toggle.disabled = true;
  const nextEnabled = !enabled;
  try {
    await chrome.storage.local.set({ [ENABLED_KEY]: nextEnabled });
    renderState(nextEnabled);
  } catch {
    status.textContent = 'Could not save. Please try again.';
  } finally {
    saving = false;
    toggle.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') loadState();
});

loadState();

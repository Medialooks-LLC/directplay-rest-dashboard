// Page frame: header, workspace tabs, activity line and the two dialogs.
import { state } from '../store.js';
import { escapeHtml } from '../util.js';
import { renderPlaybackTab } from './playback.js';
import { renderArchiveTab } from './archive.js';
import { renderExportsTab } from './exports.js';

const TABS = [['playback', 'Multiview'], ['archive', 'Archive'], ['exports', 'Export List']];

export function buildAppHtml() {
  const workspace = state.tab === 'archive' ? renderArchiveTab() : state.tab === 'exports' ? renderExportsTab() : renderPlaybackTab();
  return `
    <main class="app-shell">
      <header class="app-header">
        <div class="product-mark"><span>Direct Play</span><small>WEB MULTIVIEW</small></div>
        <div class="connection-bar">
          <button class="connection-status" data-action="connection" title="REST connection"><i data-lucide="wifi"></i><span data-live="content">${state.connected ? 'Connected' : 'Connect'}</span></button>
          <button class="icon-button" data-action="refresh" title="Refresh"><i data-lucide="refresh-cw"></i></button>
          <button class="icon-button" data-action="settings" title="Dashboard settings"><i data-lucide="settings-2"></i></button>
        </div>
      </header>
      <section class="toolbar">
        <nav class="tabs" aria-label="Workspace">
          ${TABS.map(([key, label]) => `<button class="tab ${state.tab === key ? 'active' : ''}" data-tab="${key}" aria-current="${state.tab === key ? 'page' : 'false'}">${label}${key === 'exports' ? ` <span class="tab-count" data-live="content">${state.exports.jobs.length}</span>` : ''}</button>`).join('')}
        </nav>
        <div class="app-state" data-live="content">${renderAppState()}</div>
      </section>
      ${workspace}
      <footer class="activity-log"><span>Activity</span><code data-live="content">${escapeHtml(state.log[0] || 'Ready')}</code><span class="shortcut-hint">Space play/pause · J K L shuttle · ← → frame · I O marks · Ctrl+wheel zoom</span></footer>
      ${state.settingsOpen ? renderSettingsDialog() : ''}
      ${state.connectionOpen ? renderConnectionDialog() : ''}
    </main>`;
}

function renderAppState() {
  if (!state.connected) return state.loading ? '<span class="status muted">Connecting</span>' : '<span class="status danger">Disconnected</span>';
  return `<span class="status ${state.app?.licensed ? 'good' : 'warn'}">${state.app?.licensed ? 'Licensed' : 'License pending'}</span><span class="muted">${escapeHtml(state.app?.licensee || '')}</span>`;
}

function renderSettingsDialog() {
  return `<div class="modal-backdrop"><form id="settingsForm" class="settings-dialog wide" role="dialog" aria-modal="true" aria-label="Settings">
    <header><div><div class="eyebrow">SETTINGS</div><strong>Dashboard and AI search</strong></div><button class="icon-button" type="button" data-action="close-settings" title="Close"><i data-lucide="x"></i></button></header>
    <section class="settings-section">
      <h3>Live preview in this browser</h3>
      <label><span>Preview pictures per second</span><input id="previewFps" type="number" min="0" max="10" step="1" value="${state.previewFps}" /></label>
      <p>0 turns previews off. Higher values look smoother but make Direct Play encode more pictures; 3 is a good balance.</p>
    </section>
    ${renderAiSettings()}
    <footer><button type="button" data-action="close-settings">Cancel</button><button class="primary" type="submit"><i data-lucide="settings-2"></i><span>Save settings</span></button></footer>
  </form></div>`;
}

function renderAiSettings() {
  const ai = state.ai;
  if (ai.settingsError) return `<section class="settings-section"><h3>AI search (Direct Play)</h3><p>${escapeHtml(ai.settingsError)}</p></section>`;
  if (!ai.settings) return '<section class="settings-section"><h3>AI search (Direct Play)</h3><p>Loading AI settings...</p></section>';
  const values = { ...ai.settings.values, ...ai.draft };
  const options = ai.settings.options;
  const select = (key, list, label) => {
    const current = list.find((item) => item.key === values[key]) || list[0];
    return `<label><span>${label}</span><select data-ai-setting="${key}">${list.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === current.key ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
      <p data-live="content">${escapeHtml(current.description || '')}</p>`;
  };
  const reindex = values.profile !== ai.settings.values.profile;
  return `<section class="settings-section">
      <h3>AI search (Direct Play)</h3>
      <p class="server-line ${ai.server?.isReady ? 'good' : ''}" data-live="content">${escapeHtml(ai.server?.summary || 'Checking the AI server...')}</p>
      <h4>Indexing: what the server looks at</h4>
      ${select('profile', options.profiles, 'Search profile')}
      <p class="warn" data-live="content">${reindex ? 'Changing the profile re-indexes every archive file on the next AI search.' : ''}</p>
      <h4>Results: how matches are chosen (applies immediately)</h4>
      ${select('resultFilter', options.resultFilters, 'Result filter')}
      <p class="muted">To keep only results that really show the search text, use Check the meaning after a search (needs the AI vision model on the server).</p>
      <p class="muted">Server address, token and custom indexing values are set in Direct Play: AI Search Settings.</p>
    </section>`;
}

function renderConnectionDialog() {
  return `<div class="modal-backdrop"><form id="connectionForm" class="settings-dialog" role="dialog" aria-modal="true" aria-label="REST connection">
    <header><strong>REST connection</strong><button type="button" class="icon-button" data-action="close-connection" title="Close"><i data-lucide="x"></i></button></header>
    <label><span>API URL</span><input id="baseUrl" value="${escapeHtml(state.baseUrl)}" /></label>
    <label><span>REST token</span><input id="token" type="password" autocomplete="off" value="${escapeHtml(state.token)}" /></label>
    <p class="muted">The token is in Direct Play: Preferences &gt; REST API. It stays in this browser only.</p>
    <footer><button type="button" data-action="close-connection">Cancel</button><button class="primary" type="submit"><i data-lucide="wifi"></i>Connect</button></footer>
  </form></div>`;
}

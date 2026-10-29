// Archive: search by name/timecode/date or by an AI description; used by the Archive tab and the navigator.
import { state } from '../store.js';
import { asList, escapeHtml, formatBytes, formatDate, formatShortTime, plural } from '../util.js';
import { renderEmpty } from './common.js';

export function renderArchiveTab() {
  const count = state.archiveMode === 'ai' ? asList(state.ai.job?.results).length : state.archive.length;
  return `
    <section class="workspace archive-workspace">
      <header class="workspace-heading">
        <div><span class="panel-title">ARCHIVE</span><strong>Search and load recordings</strong></div>
        <span class="workspace-count" data-live="content">${count} result(s)</span>
      </header>
      <section class="archive-tools">
        ${renderArchiveSearch()}
        <div class="roots"><span><i data-lucide="database"></i> ${plural(state.roots.length, 'archive root')}</span><button data-action="add-root"><i data-lucide="folder-plus"></i><span>Add root</span></button></div>
      </section>
      <section class="archive-results" data-scroll="archive">${renderArchiveList()}</section>
    </section>`;
}

export function renderArchiveNavigator() {
  const footer = state.archiveMode === 'ai' ? `${asList(state.ai.job?.results).length} AI results` : plural(state.archive.length, 'recording');
  return `
    <aside class="archive-navigator">
      <header class="pane-header"><span>Archive</span><button class="icon-button" data-tab="archive" title="Open full archive"><i data-lucide="panels-top-left"></i></button></header>
      <div class="navigator-search">${renderArchiveSearch()}</div>
      <div class="navigator-results" data-scroll="navigator">${renderArchiveList()}</div>
      <div class="pane-footer" data-live="content">${footer}</div>
    </aside>`;
}

function renderArchiveSearch() {
  return `
    <div class="mode-switch" role="tablist" aria-label="Archive search mode">
      <button role="tab" class="${state.archiveMode === 'files' ? 'active' : ''}" aria-selected="${state.archiveMode === 'files'}" data-action="archive-mode" data-mode="files"><i data-lucide="search"></i>By name / date</button>
      <button role="tab" class="${state.archiveMode === 'ai' ? 'active' : ''}" aria-selected="${state.archiveMode === 'ai'}" data-action="archive-mode" data-mode="ai"><i data-lucide="sparkles"></i>AI: describe it</button>
    </div>
    ${state.archiveMode === 'ai' ? renderAiFilters() : renderFileFilters()}`;
}

function renderFileFilters() {
  const filters = state.archiveFilters;
  return `<div class="filters">
    <label><span>Name / source</span><input id="archiveName" value="${escapeHtml(filters.name)}" placeholder="Search recordings" /></label>
    <label><span>Timecode</span><input id="archiveTimecode" value="${escapeHtml(filters.timecode)}" placeholder="hh:mm:ss:ff" inputmode="numeric" /></label>
    <label><span>Recorded date</span><input id="archiveDate" type="date" value="${escapeHtml(filters.date)}" /></label>
    <button class="primary" data-action="search"><i data-lucide="search"></i><span data-live="content">${state.archiveLoading ? 'Searching...' : 'Search'}</span></button>
  </div>`;
}

function renderAiFilters() {
  const running = state.ai.job?.status === 'running';
  return `<div class="filters ai-filters">
    <label class="ai-query"><span>What to find</span><input id="aiQuery" value="${escapeHtml(state.ai.query)}" placeholder="man in a red jacket, white car at the gate, Андрей у доски" /></label>
    <label><span>Recorded date (optional)</span><input id="aiDate" type="date" value="${escapeHtml(state.ai.date)}" /></label>
    ${running
      ? '<button data-action="ai-cancel"><i data-lucide="x"></i><span>Cancel</span></button>'
      : '<button class="primary" data-action="ai-search"><i data-lucide="sparkles"></i><span>Find</span></button>'}
    ${isMeaningCheckOffered()
      ? '<button data-action="ai-check-meaning" title="The AI vision model looks at the best matches and keeps only those that really show the search text (about 10-20 s)."><i data-lucide="scan-eye"></i><span>Check the meaning</span></button>'
      : ''}
  </div>
  <p class="ai-status" data-live="content">${escapeHtml(describeAiJob())}</p>`;
}

/** Offered after a fast AI search with results when the AI server has the AI vision model (like Direct Play). */
function isMeaningCheckOffered() {
  const job = state.ai.job;
  return Boolean(job && job.status === 'completed' && !state.ai.checked && asList(job.results).length
    && asList(state.ai.server?.verificationModes).includes('vlm'));
}

function describeAiJob() {
  const job = state.ai.job;
  if (state.ai.error) return state.ai.error;
  if (!job) return 'Describe people, objects or events in Russian or English. New recordings are indexed automatically before searching.';
  if (job.status === 'running') return `${job.message} (${Math.round(job.elapsedSeconds || 0)} s)`;
  if (job.status === 'failed') return `AI search failed: ${job.error || job.message}`;
  if (state.ai.checked) return `${job.message} Only moments confirmed by the AI vision model are listed. Click one to open it.`;
  return `${job.message} Click a moment to open the recording at that point.`;
}

function renderArchiveList() {
  if (state.archiveMode === 'ai') {
    const results = asList(state.ai.job?.results);
    return results.length ? results.map(renderAiResult).join('') : renderEmpty(state.ai.job?.status === 'running' ? 'Searching...' : 'No AI results yet', '');
  }
  if (state.archive.length) return state.archive.map(renderRecording).join('');
  return renderEmpty(state.archiveLoading ? 'Searching archive...' : state.archiveError || 'No recordings', '');
}

function thumbnail(item, fallbackIcon) {
  const url = state.archiveThumbnails.get(item.filePath);
  return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(item.fileName)}" />` : `<i data-lucide="${fallbackIcon}"></i>`;
}

function renderRecording(item) {
  return `<article class="archive-row">
    <div class="archive-thumbnail"><span class="archive-thumbnail-media" data-live="content">${thumbnail(item, 'archive')}</span><div class="archive-overlay"><span>RECORDING</span><b>${escapeHtml(item.startTimecode || '--:--:--:--')}</b></div></div>
    <div class="archive-copy"><strong>${escapeHtml(item.fileName || 'Unnamed recording')}</strong><span>${escapeHtml(item.sourceName || item.destinationName || 'Direct Take recording')}</span></div>
    <div class="archive-meta"><span>RECORDED</span><b>${formatDate(item.createdUtc)}</b><span>${formatBytes(item.fileSize)}</span></div>
    <button class="icon-button archive-add" data-action="add-archive" data-path="${escapeHtml(item.filePath)}" title="Add to multiview"><i data-lucide="plus"></i></button>
  </article>`;
}

function renderAiResult(item) {
  const matches = asList(item.matches).slice(0, 8);
  return `<article class="archive-row ai-row">
    <div class="archive-thumbnail"><span class="archive-thumbnail-media" data-live="content">${thumbnail(item, 'sparkles')}</span></div>
    <div class="archive-copy"><strong>${escapeHtml(item.fileName || 'Recording')}</strong><span>${escapeHtml(item.summary || '')}</span>
      <div class="ai-matches">${matches.map((match) => `<button class="ai-match ${match.personName ? 'person' : ''}" data-action="open-ai-match" data-path="${escapeHtml(item.filePath)}" data-seconds="${Number(match.bestSeconds ?? match.startSeconds ?? 0)}" title="${escapeHtml(match.summary || '')}">${match.personName ? '<i data-lucide="user-round"></i>' : ''}<b>${formatShortTime(match.startSeconds)}</b><span>${escapeHtml(match.personName || (match.confirmed ? `Confirmed ${Math.round((match.vlmProbability || 0) * 100)}%` : match.strength) || '')}</span></button>`).join('')}</div>
    </div>
    <div class="archive-meta"><span>RECORDED</span><b>${formatDate(item.createdUtc)}</b><span>${formatBytes(item.fileSize)}</span></div>
    <button class="icon-button archive-add" data-action="add-archive" data-path="${escapeHtml(item.filePath)}" title="Add to multiview"><i data-lucide="plus"></i></button>
  </article>`;
}

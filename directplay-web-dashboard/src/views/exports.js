// Export list: queued cuts, re-encode options and running the exports.
import { state, linkedClips } from '../store.js';
import { asList, escapeHtml, plural } from '../util.js';
import { renderEmpty } from './common.js';

export function renderExportsTab() {
  const jobs = asList(state.exports.jobs);
  return `
    <section class="workspace export-workspace">
      <header class="workspace-heading">
        <div><span class="panel-title">EXPORT LIST</span><strong>Queued cuts and re-encode options</strong></div>
        <span class="workspace-count">${plural(jobs.length, 'job')}</span>
      </header>
      <section class="export-tools">
        <label><span>Destination</span><input id="exportDestination" value="${escapeHtml(state.exportDestinationDraft ?? state.exports.destination ?? '')}" placeholder="Export folder path" /></label>
        <button data-action="set-export-destination">Set destination</button>
        <button data-action="add-selected-export" ${state.clips.length ? '' : 'disabled'}>Add selected cut</button>
        <button class="primary" data-action="add-linked-export" ${linkedClips().length ? '' : 'disabled'}>Add linked cut</button>
      </section>
      <section class="export-list" data-scroll="exports">
        ${jobs.length ? jobs.map(renderExportJob).join('') : renderEmpty('No export jobs queued.', 'Add a selected or linked cut from the dashboard or Direct Play desktop UI.')}
      </section>
      <section class="export-footer">
        <span class="status ${state.exports.isExporting ? 'good' : 'muted'}">${state.exports.isExporting ? 'Exporting' : 'Ready'}</span>
        <button data-action="clear-completed-exports" ${jobs.some((job) => job.status === 'Done') ? '' : 'disabled'}>Clear completed</button>
        <button data-action="run-selected-exports" ${jobs.some((job) => job.isSelected) && !state.exports.isExporting ? '' : 'disabled'}>Export selected jobs</button>
        <button class="primary" data-action="run-all-exports" ${jobs.length && !state.exports.isExporting ? '' : 'disabled'}>Export all</button>
      </section>
    </section>`;
}

function renderExportJob(job) {
  const canEdit = job.canEditExportSettings !== false;
  const statusClass = job.status === 'Done' ? 'good' : job.status === 'Failed' ? 'danger' : job.status === 'Exporting' ? 'warn' : 'muted';
  return `
    <article class="export-job ${job.status === 'Exporting' ? 'exporting' : ''}">
      <label class="export-check"><input class="export-job-selected" data-id="${escapeHtml(job.id)}" type="checkbox" ${job.isSelected ? 'checked' : ''} ${canEdit ? '' : 'disabled'} /></label>
      <div class="export-main">
        <div class="export-title"><strong>${escapeHtml(job.name)}</strong><span>${escapeHtml(job.jobType)}</span></div>
        <div class="export-sources">${asList(job.sources).map((source) => `<span title="${escapeHtml(source.filePath)}">${escapeHtml(source.sourceName)}</span>`).join('')}</div>
      </div>
      <div class="export-time"><span>IN</span><b>${escapeHtml(job.markInLabel)}</b></div>
      <div class="export-time"><span>OUT</span><b>${escapeHtml(job.markOutLabel)}</b></div>
      <div class="export-time"><span>DURATION</span><b>${escapeHtml(job.durationLabel)}</b></div>
      <div class="export-options">
        <label><input class="export-reencode" data-id="${escapeHtml(job.id)}" type="checkbox" ${job.isReencodeEnabled ? 'checked' : ''} ${canEdit ? '' : 'disabled'} /><span>Re-encode</span></label>
        <select class="export-container" data-id="${escapeHtml(job.id)}" ${job.isReencodeEnabled && canEdit ? '' : 'disabled'}>
          ${asList(job.reencodeContainers).map((container) => `<option value="${escapeHtml(container)}" ${container === job.reencodeContainer ? 'selected' : ''}>${escapeHtml(container)}</option>`).join('')}
        </select>
      </div>
      <div class="export-status">
        <span class="status ${statusClass}">${escapeHtml(job.status)}</span>
        <div class="progress"><span style="width:${Math.max(0, Math.min(100, Number(job.progress || 0) * 100))}%"></span></div>
        <small>${escapeHtml(job.errorMessage || job.progressLabel || '')}</small>
      </div>
      <button class="icon-button" data-action="remove-export-job" data-id="${escapeHtml(job.id)}" title="Remove export job" ${job.status === 'Exporting' ? 'disabled' : ''}><i data-lucide="x"></i></button>
    </article>`;
}

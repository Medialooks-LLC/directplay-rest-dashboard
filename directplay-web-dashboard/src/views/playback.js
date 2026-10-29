// Multiview workspace: archive navigator, source previews, selected-source inspector, timeline and transport.
import { state, getMaster, isLinked, linkedClips, selectedClip, clipOffset, transportState } from '../store.js';
import { escapeHtml, formatTime, formatTimecode, plural, trackColour } from '../util.js';
import { RULER_HEIGHT, LANE_HEIGHT, LANE_GAP, timelineHeight, zoomLabel } from '../timeline.js';
import { renderArchiveNavigator } from './archive.js';
import { renderEmpty } from './common.js';

export const SHUTTLE_RATES = [-8, -4, -2, -1, 1, 2, 4, 8];

export function renderPlaybackTab() {
  const focused = state.clips.find((clip) => clip.index === state.focusedClipIndex);
  return `
    <section class="workspace playback-workspace">
      ${renderArchiveNavigator()}
      <section class="multiview-pane">
        <header class="pane-header"><span>Multiview</span><span>${plural(state.clips.length, 'source')}</span></header>
        ${focused ? renderFocusedPreview(focused) : renderGrid()}
      </section>
      ${renderInspector()}
      ${renderTimelineDock()}
      ${renderTransportPanel()}
    </section>`;
}

function renderGrid() {
  const count = state.clips.length;
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns) || 1;
  const empty = state.pendingArchiveLoads.size
    ? renderEmpty('Opening recording in Direct Play...', 'The file is being prepared for multiview playback.')
    : renderEmpty('No clips are loaded in Direct Play.', 'Add recordings from the archive on the left, or load them in the desktop player.');
  return `<section class="clip-grid multiview-grid" style="--columns:${columns};--rows:${rows}">${count ? state.clips.map(renderClip).join('') : empty}</section>`;
}

function stateLabel(clip) {
  return clip.isPlaying && !clip.isPaused ? 'Playing' : clip.isPaused ? 'Paused' : 'Stopped';
}

function renderClipButtons(clip, { withMarks }) {
  const playing = clip.isPlaying && !clip.isPaused;
  return `
    <button class="icon-button" data-action="step-back" data-index="${clip.index}" title="Previous frame"><i data-lucide="chevron-left"></i></button>
    <button data-live class="icon-button ${playing ? 'selected' : ''}" data-action="play" data-index="${clip.index}" title="Play"><i data-lucide="play"></i></button>
    <button data-live class="icon-button ${clip.isPaused ? 'selected' : ''}" data-action="pause" data-index="${clip.index}" title="Pause"><i data-lucide="pause"></i></button>
    <button data-live class="icon-button ${!clip.isPlaying && !clip.isPaused ? 'selected' : ''}" data-action="stop" data-index="${clip.index}" title="Stop"><i data-lucide="circle-stop"></i></button>
    <button class="icon-button" data-action="step-forward" data-index="${clip.index}" title="Next frame"><i data-lucide="chevron-right"></i></button>
    <button data-live class="icon-button ${clip.isAudioPreview ? 'selected' : ''}" data-action="audio-toggle" data-index="${clip.index}" title="Listen to this source"><span data-live="content"><i data-lucide="${clip.isAudioPreview ? 'volume-2' : 'volume-x'}"></i></span></button>
    ${withMarks ? `<button class="mini-mark" data-action="mark-in" data-index="${clip.index}">IN</button><button class="mini-mark" data-action="mark-out" data-index="${clip.index}">OUT</button>` : ''}`;
}

function renderClip(clip) {
  const duration = Number(clip.duration || 0);
  const position = Number(clip.position || 0);
  const ratio = duration > 0 ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  const number = String(clip.index + 1).padStart(2, '0');
  return `
    <article data-live class="clip-card ${clip.index === state.selectedClipIndex ? 'selected' : ''}" data-clip="${clip.index}" style="--track:${trackColour(clip.index)}">
      <header>
        <div class="clip-index">${number}</div>
        <button class="clip-name" data-action="select-clip" data-index="${clip.index}" title="Select source"><strong title="${escapeHtml(clip.name)}">${escapeHtml(clip.name)}</strong><span title="${escapeHtml(clip.filePath)}">${escapeHtml(clip.filePath)}</span></button>
        <label class="track-link-toggle" title="Linked sources follow the master timeline"><input class="track-link" data-index="${clip.index}" type="checkbox" ${isLinked(clip) ? 'checked' : ''}/><span>LINK</span></label>
        <span data-live="content" class="status ${clip.isPlaying && !clip.isPaused ? 'good' : 'muted'}">${stateLabel(clip)}</span>
      </header>
      <div class="preview-slate" data-preview-index="${clip.index}">
        ${renderPreviewSurface(clip)}
        <div class="preview-title"><span>${number} / ${escapeHtml(clip.name)}</span><b data-live="content">${formatTime(position)}</b></div>
        ${renderAudioMeters(clip)}
      </div>
      <div class="clip-controls">${renderClipButtons(clip, { withMarks: true })}</div>
      <div class="clip-timebar"><span data-live="content">${formatTime(position)}</span><div class="progress" aria-hidden="true"><span data-live style="width:${ratio}%"></span></div><span data-live="content">${formatTime(duration)}</span></div>
    </article>`;
}

function renderFocusedPreview(clip) {
  return `
    <section class="focused-preview" data-clip="${clip.index}" data-preview-index="${clip.index}">
      ${renderPreviewSurface(clip)}
      <button class="focus-return-button" data-action="exit-focused-preview" title="Back to multiview (Esc)" aria-label="Back to multiview"><i data-lucide="panels-top-left"></i></button>
      <div class="preview-title"><span>${String(clip.index + 1).padStart(2, '0')} / ${escapeHtml(clip.name)}</span><b data-live="content">${formatTime(clip.position)}</b></div>
      ${renderAudioMeters(clip)}
      <div class="clip-controls">${renderClipButtons(clip, { withMarks: false })}</div>
    </section>`;
}

function renderPreviewSurface(clip) {
  const preview = state.clipPreviews.get(clip.index);
  const content = preview?.filePath === clip.filePath
    ? `<img src="${escapeHtml(preview.url)}" alt="Live preview for ${escapeHtml(clip.name)}" />`
    : `<span class="preview-placeholder-content"><i data-lucide="play"></i><span>${state.previewFps ? 'Preview pending' : 'Preview updates off'}</span></span>`;
  return `<div class="preview-media" data-live="content">${content}</div>`;
}

function renderAudioMeters(clip) {
  const meters = Array.isArray(clip.audioMeters) ? clip.audioMeters : [];
  const level = (value) => Math.min(100, Math.max(0, Number(value || 0) * 100));
  return `<div class="audio-meters" aria-label="Audio levels"><i><b data-live style="height:${level(meters[0])}%"></b></i><i><b data-live style="height:${level(meters[1])}%"></b></i></div>`;
}

function renderInspector() {
  const clip = selectedClip();
  const hasClips = state.clips.length > 0;
  const markIn = Number(clip?.markIn || 0);
  const markOut = Number(clip?.markOut || clip?.duration || 0);
  const offset = clipOffset(clip);
  const master = getMaster();
  return `
    <aside class="cut-inspector" data-scroll="inspector">
      <header class="pane-header">Selected source</header>
      <div class="inspector-body">
        <strong title="${escapeHtml(clip?.name || '')}">${escapeHtml(clip?.name || 'No source selected')}</strong>
        <output class="inspector-time" data-live="content">${formatTimecode(clip?.position, master.frameRate)}</output>
        <span class="muted">Source duration <code>${formatTime(clip?.duration)}</code></span>
        <span class="muted" data-live="content">${offset > 0 ? `Starts <code>+${offset.toFixed(2)} s</code> on the timeline (timecode)` : !clip ? '' : isLinked(clip) ? 'Starts at 0 on the timeline' : 'Independent: plays on its own'}</span>
        <div class="cut-points"><label>IN<code data-live="content">${formatTime(markIn)}</code></label><label>OUT<code data-live="content">${formatTime(markOut)}</code></label></div>
        <div class="paired-buttons"><button data-action="mark-in" data-index="${clip?.index}" ${hasClips ? '' : 'disabled'}>Mark in</button><button data-action="mark-out" data-index="${clip?.index}" ${hasClips ? '' : 'disabled'}>Mark out</button></div>
        <div class="cut-duration"><span>Cut duration</span><code data-live="content">${formatTime(Math.max(0, markOut - markIn))}</code></div>
        <button class="primary" data-action="add-selected-export" ${hasClips ? '' : 'disabled'}><i data-lucide="plus"></i>Add selected cut</button>
        <button data-action="add-linked-export" ${linkedClips().length ? '' : 'disabled'}><i data-lucide="link-2"></i>Add linked cut</button>
        <button data-action="open-export-list"><i data-lucide="archive"></i>Export List <span class="tab-count">${state.exports.jobs.length}</span></button>
        <div class="source-details"><span class="panel-title">SOURCE</span><span title="${escapeHtml(clip?.filePath || '')}">${escapeHtml(clip?.filePath || '')}</span><span data-live="content">${linkedClips().length} linked / ${state.clips.length} loaded</span></div>
      </div>
    </aside>`;
}

function renderTimelineDock() {
  const transport = transportState();
  const master = getMaster();
  const disabled = transport.linked.length ? '' : 'disabled';
  const follow = state.timeline.follow === 'page';
  return `
    <section class="timeline-dock">
      <header class="timeline-toolbar">
        <span class="panel-title" data-live="content">${plural(transport.linked.length, 'linked source')}</span>
        <div class="sync-buttons">
          <button class="icon-button" data-action="sync-step-back" title="Previous frame (Left)" ${disabled}><i data-lucide="chevron-left"></i></button>
          <button data-live class="icon-button ${transport.playing ? 'selected' : ''}" aria-pressed="${transport.playing}" data-action="sync-play" title="Play (Space / L)" ${disabled}><i data-lucide="play"></i></button>
          <button data-live class="icon-button ${transport.paused ? 'selected' : ''}" aria-pressed="${transport.paused}" data-action="sync-pause" title="Pause (Space / K)" ${disabled}><i data-lucide="pause"></i></button>
          <button data-live class="icon-button ${transport.stopped ? 'selected' : ''}" aria-pressed="${transport.stopped}" data-action="sync-stop" title="Stop and go to the start" ${disabled}><i data-lucide="circle-stop"></i></button>
          <button class="icon-button" data-action="sync-step-forward" title="Next frame (Right)" ${disabled}><i data-lucide="chevron-right"></i></button>
        </div>
        <div class="timeline-view-tools">
          <button class="mini-tool" data-action="zoom-out" title="Zoom out (-)">−</button>
          <button class="mini-tool" data-action="zoom-in" title="Zoom in (+ or Ctrl+wheel)">+</button>
          <button class="mini-tool" data-action="zoom-fit" title="Whole recording (\\ or double-click the ruler)">Fit</button>
          <span class="zoom-label" data-live="content">${zoomLabel()}</span>
          <button data-live class="mini-tool ${follow ? 'selected' : ''}" aria-pressed="${follow}" data-action="toggle-follow" title="While playing, turn the page when the playhead leaves the view">Follow</button>
          ${master.alignment ? `<button data-live class="mini-tool ${master.alignment === 'timecode' ? 'selected' : ''}" aria-pressed="${master.alignment === 'timecode'}" data-action="toggle-alignment" title="Align by timecode: linked sources are lined up by their recording timecode, so cameras started at different moments show the same instant. Off: every source starts at 0.">Align TC</button>` : ''}
        </div>
      </header>
      <div class="timeline-scroll" data-scroll="timeline">
        <div class="timeline-grid">
          <div class="timeline-heads">
            <div class="timeline-head ruler-head" style="height:${RULER_HEIGHT}px"><span class="panel-title">MASTER</span><output data-master-time></output><small data-live="content">of ${formatTimecode(master.duration, master.frameRate)}</small></div>
            ${state.clips.map(renderLaneHead).join('')}
          </div>
          <canvas class="timeline-canvas" style="height:${timelineHeight()}px" aria-label="Timeline: click or drag to move the playhead. Wheel scrolls, Ctrl+wheel zooms, Alt+wheel steps frames" title="Click or drag to move the playhead. Wheel: scroll   Ctrl+wheel: zoom   Alt+wheel: frame step   Double-click the ruler: whole recording"></canvas>
        </div>
      </div>
    </section>`;
}

function renderLaneHead(clip) {
  const selected = clip.index === state.selectedClipIndex;
  return `
    <div data-live class="timeline-head lane-head ${selected ? 'selected' : ''} ${isLinked(clip) ? '' : 'independent'}" data-clip="${clip.index}" style="height:${LANE_HEIGHT}px;margin:${LANE_GAP / 2}px 0;--track:${trackColour(clip.index)}">
      <span class="lane-number">${String(clip.index + 1).padStart(2, '0')}</span>
      <button class="track-name" data-action="select-clip" data-index="${clip.index}" title="${escapeHtml(clip.name)}">${escapeHtml(clip.name)}</button>
      <label class="track-link-toggle" title="Linked sources follow the master timeline; unlinked ones play on their own"><input class="track-link" data-index="${clip.index}" type="checkbox" ${isLinked(clip) ? 'checked' : ''}/><span>LINK</span></label>
      <button class="mini-mark" data-action="mark-in" data-index="${clip.index}" title="Set this source's IN at its position">IN</button>
      <button class="mini-mark" data-action="mark-out" data-index="${clip.index}" title="Set this source's OUT at its position">OUT</button>
    </div>`;
}

function renderTransportPanel() {
  const master = getMaster();
  const linked = linkedClips().length;
  const shuttling = Boolean(state.app?.clock?.shuttling);
  const activeRate = shuttling ? master.rate : master.running ? 1 : 0;
  const disabled = linked ? '' : 'disabled';
  return `
    <aside class="jog-panel transport-panel">
      <output class="master-time" data-master-time></output>
      <span class="muted" data-live="content">${shuttling ? `Shuttle ${escapeHtml(master.shuttle)}` : master.running ? 'Playing' : plural(linked, 'linked source')}</span>
      <div class="jog-wheel" data-jog-wheel tabindex="0" role="slider" aria-label="Jog: drag round or turn the mouse wheel to step frames" title="Jog: drag round or turn the mouse wheel to step frames"><span class="jog-dimple"></span></div>
      <div class="shuttle-buttons" role="group" aria-label="Shuttle speed">
        ${SHUTTLE_RATES.map((rate) => `<button data-live class="${activeRate === rate ? 'selected' : ''}" data-action="shuttle" data-rate="${rate}" title="${rate < 0 ? 'Reverse' : 'Forward'} ${Math.abs(rate)}x (J / L)" ${disabled}>${rate < 0 ? '◀' : ''}${Math.abs(rate)}${rate > 0 ? '▶' : ''}</button>`).join('')}
      </div>
      <div class="sync-marks"><button data-action="sync-mark-in" title="IN on all linked sources (I)" ${disabled}>Set in</button><button data-action="sync-mark-out" title="OUT on all linked sources (O)" ${disabled}>Set out</button></div>
    </aside>`;
}

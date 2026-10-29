// Talking to Direct Play: polling, actions, archive and AI search, thumbnails and live previews.
import { state, client, addLog, normalizeExports } from './store.js';
import { render, invalidate } from './dom.js';
import { requestTimelinePaint } from './timeline.js';
import { asList, escapeHtml, formatShortTime } from './util.js';

const POLL_MS = 1500;
const ROOTS_REFRESH_MS = 15000;
const EXPORTS_IDLE_REFRESH_MS = 10000;
const thumbnailRequests = new Set();

export function describeConnectionError(error) {
  if (error?.status === 401) return 'Direct Play rejected the REST token. Copy it from Preferences > REST API.';
  if (error?.status === 404) return 'Direct Play REST API was not found at this URL.';
  return `Direct Play is not reachable: ${error.message}`;
}

function applyApp(app) {
  state.app = app;
  state.appReadAt = performance.now();
}

function applyClips(clips) {
  state.clips = asList(clips);
  const apiSelected = state.clips.find((clip) => clip.isSelected);
  if (apiSelected) state.selectedClipIndex = apiSelected.index;
  else if (!state.clips.some((clip) => clip.index === state.selectedClipIndex)) state.selectedClipIndex = state.clips[0]?.index ?? null;
  if (!state.clips.some((clip) => clip.index === state.focusedClipIndex)) state.focusedClipIndex = null;
  removeStaleClipPreviews();
}

// Every tick reads the application state (master clock) and the clips; archive roots and the export list change
// rarely, so they are read on their own slower schedule (always while the export list is open or an export runs).
export async function refreshDashboard({ force = false } = {}) {
  if (!force && (document.hidden || state.connectionOpen || state.pointerActive)) {
    scheduleRefresh();
    return;
  }
  if (state.loading) return;
  const now = Date.now();
  const wantRoots = force || !state.connected || now - state.lastRootsRefresh > ROOTS_REFRESH_MS;
  const wantExports = force || !state.connected || state.tab === 'exports' || state.exports.isExporting || now - state.lastExportsRefresh > EXPORTS_IDLE_REFRESH_MS;
  state.loading = true;
  if (!state.app) render();
  try {
    const [app, clips, roots, exports] = await Promise.all([
      client.getApplicationState(),
      client.getClips(),
      wantRoots ? client.getArchiveRoots() : null,
      wantExports ? client.getExports() : null
    ]);
    const wasConnected = state.connected;
    state.connected = true;
    applyApp(app);
    applyClips(clips);
    if (roots) { state.roots = asList(roots); state.lastRootsRefresh = now; }
    if (exports) { state.exports = normalizeExports(exports); state.lastExportsRefresh = now; }
    if (!state.archiveLoaded && !state.archiveLoading) {
      loadArchiveResults(state.archiveFilters).catch((error) => { addLog(`Archive search: ${error.message}`); render(); });
    }
    if (!wasConnected) addLog(`Connected: ${app.title || 'Direct Play'} (${state.clips.length} clip${state.clips.length === 1 ? '' : 's'})`);
  } catch (error) {
    if (state.connected || state.log[0]?.endsWith(error.message) !== true) addLog(describeConnectionError(error));
    state.connected = false;
  } finally {
    state.loading = false;
    render();
    requestTimelinePaint();
    schedulePreviewUpdates();
    scheduleRefresh();
  }
}

/** After a transport action: the clips and the master clock, nothing else. */
export async function refreshTransport() {
  try {
    const [app, clips] = await Promise.all([client.getApplicationState(), client.getClips()]);
    applyApp(app);
    applyClips(clips);
  } catch (error) {
    addLog(describeConnectionError(error));
  }
  render();
  requestTimelinePaint();
}

export function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  if (!state.connectionEditing) state.refreshTimer = setTimeout(refreshDashboard, POLL_MS);
}

/** refresh: 'all' re-reads everything, 'transport' the clips and master clock, false nothing. */
export async function runAction(label, action, { refresh = 'all', quiet = false } = {}) {
  try {
    await action();
    if (!quiet) addLog(`${label}: ok`);
    if (refresh === 'transport') await refreshTransport();
    else if (refresh) await refreshDashboard({ force: true });
    else render();
  } catch (error) {
    addLog(`${label}: ${error.status === 400 && /Unsupported playback command/.test(error.body || '') ? 'this Direct Play version does not support it yet' : error.message}`);
    render();
  }
}

export function reconnect() {
  state.archiveLoaded = false;
  state.archiveSearchController?.abort();
  state.archiveSearchController = null;
  state.archiveLoading = false;
  state.archiveError = '';
  state.archive = [];
  clearArchiveThumbnails();
  client.setConnection({ baseUrl: state.baseUrl, token: state.token });
  return refreshDashboard({ force: true });
}

// Archive ---------------------------------------------------------------------------------------------------------

export async function loadArchiveResults(filters) {
  state.archiveSearchController?.abort();
  const controller = new AbortController();
  state.archiveSearchController = controller;
  state.archiveLoading = true;
  state.archiveLoaded = true;
  state.archiveError = '';
  render();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const results = await client.searchArchive(filters, { signal: controller.signal });
    if (state.archiveSearchController !== controller) return;
    clearArchiveThumbnails();
    state.archive = asList(results);
    queueThumbnails(state.archive.map((item) => item.filePath));
  } catch (error) {
    if (state.archiveSearchController !== controller) return;
    state.archiveError = controller.signal.aborted ? 'Archive search timed out. Search again to retry.' : 'Archive search failed. Search again to retry.';
    throw new Error(state.archiveError, { cause: error });
  } finally {
    clearTimeout(timeout);
    if (state.archiveSearchController === controller) {
      state.archiveLoading = false;
      render();
    }
  }
}

export function queueThumbnails(paths) {
  const requestId = state.archiveThumbnailRequestId;
  paths.slice(0, 24).forEach((filePath) => {
    if (!filePath || state.archiveThumbnails.has(filePath) || thumbnailRequests.has(filePath)) return;
    thumbnailRequests.add(filePath);
    client.getArchiveThumbnail(filePath)
      .then((blob) => {
        if (requestId !== state.archiveThumbnailRequestId) return;
        state.archiveThumbnails.set(filePath, URL.createObjectURL(blob));
        render();
      })
      .catch(() => {})
      .finally(() => thumbnailRequests.delete(filePath));
  });
}

function clearArchiveThumbnails() {
  state.archiveThumbnailRequestId++;
  state.archiveThumbnails.forEach((url) => URL.revokeObjectURL(url));
  state.archiveThumbnails.clear();
}

export async function addArchiveToMultiview(filePath) {
  state.pendingArchiveLoads.add(filePath);
  state.tab = 'playback';
  addLog('Opening recording in multiview...');
  render();
  try {
    const existing = state.clips.find((clip) => clip.filePath === filePath);
    if (existing) return existing;
    await client.openArchiveItem(filePath);
    const loaded = await waitForArchiveClip(filePath);
    addLog(loaded ? 'Recording added to multiview.' : 'Recording queued for multiview loading.');
    return loaded;
  } catch (error) {
    addLog(`Add to multiview: ${error.message}`);
    return null;
  } finally {
    state.pendingArchiveLoads.delete(filePath);
    await refreshTransport();
    schedulePreviewUpdates();
    scheduleRefresh();
  }
}

async function waitForArchiveClip(filePath) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    applyClips(await client.getClips());
    const clip = state.clips.find((item) => item.filePath === filePath);
    if (clip) return clip;
  }
  return null;
}

// AI search -------------------------------------------------------------------------------------------------------

export async function startAiSearch(checkMeaning = false) {
  const query = state.ai.query.trim();
  if (!query) { state.ai.error = 'Type what you are looking for.'; render(); return; }
  state.ai.error = '';
  try {
    state.ai.job = await client.startAiSearch({ query, date: state.ai.date, checkMeaning });
    state.ai.checked = checkMeaning;
    addLog(checkMeaning ? `AI vision check started: ${query}` : `AI search started: ${query}`);
    pollAiSearch();
  } catch (error) {
    state.ai.error = error.status === 403 ? 'AI search needs a Direct Play AI Search license.' : `AI search could not start: ${error.message}`;
  }
  render();
}

function pollAiSearch() {
  clearTimeout(state.ai.pollTimer);
  const job = state.ai.job;
  if (!job || job.status !== 'running') return;
  state.ai.pollTimer = setTimeout(async () => {
    try {
      state.ai.job = await client.getAiSearch(job.id);
      queueThumbnails(asList(state.ai.job.results).map((item) => item.filePath));
      if (state.ai.job.status !== 'running') {
        addLog(`AI search: ${state.ai.job.message}`);
        // "Check the meaning" is offered only when the AI server has the AI vision model; ask once.
        if (!state.ai.server) state.ai.server = await client.getAiServer().catch(() => null);
      }
    } catch (error) {
      state.ai.error = `Lost track of the AI search: ${error.message}`;
      state.ai.job = { ...job, status: 'failed' };
    }
    render();
    pollAiSearch();
  }, 1000);
}

/** "Check the meaning": the same search again with the AI vision model check; only confirmed moments stay. */
export function checkAiMeaning() {
  return startAiSearch(true);
}

export function cancelAiSearch() {
  const job = state.ai.job;
  if (job) runAction('Cancel AI search', () => client.cancelAiSearch(job.id), { refresh: false });
}

export async function openAiMatch(filePath, seconds) {
  const clip = await addArchiveToMultiview(filePath);
  if (clip && Number.isFinite(seconds)) {
    await runAction(`Go to ${formatShortTime(seconds)}`, () => client.seekClip(clip.index, seconds), { refresh: 'transport' });
  }
}

export async function loadAiSettings() {
  state.ai.draft = {};
  state.ai.settingsError = '';
  // Show the settings at once; the AI server check can take seconds and fills in its line when it answers.
  const server = client.getAiServer().catch(() => null);
  try {
    state.ai.settings = await client.getAiSettings();
    render();
    state.ai.server = await server;
  } catch (error) {
    state.ai.settingsError = error.status === 404
      ? 'This Direct Play version has no AI settings API. Update Direct Play to change AI search from the browser.'
      : `AI settings are unavailable: ${error.message}`;
  }
  render();
}

// Live previews ---------------------------------------------------------------------------------------------------

export function schedulePreviewUpdates() {
  clearInterval(state.previewTimer);
  if (!state.previewFps || !state.clips.length) return;
  refreshClipPreviews();
  state.previewTimer = setInterval(refreshClipPreviews, 1000 / state.previewFps);
}

// One picture per tick, round robin over the sources that changed, so Direct Play never encodes more than the
// configured rate however many sources are loaded.
function refreshClipPreviews() {
  if (document.hidden || state.tab !== 'playback' || !state.connected) return;
  const candidates = state.clips.filter((clip) =>
    !state.previewRequests.has(clip.index)
    && (!state.clipPreviews.has(clip.index) || state.clipPreviews.get(clip.index).position !== clip.position || (clip.isPlaying && !clip.isPaused)));
  if (!candidates.length) return;
  const clip = candidates[state.previewCursor % candidates.length];
  state.previewCursor++;
  state.previewRequests.add(clip.index);
  client.getClipPreview(clip.index)
    .then((blob) => {
      if (!state.clips.some((current) => current.index === clip.index && current.filePath === clip.filePath)) return;
      const previous = state.clipPreviews.get(clip.index);
      const url = URL.createObjectURL(blob);
      state.clipPreviews.set(clip.index, { filePath: clip.filePath, position: clip.position, url });
      showClipPreview(clip, url);
      if (previous?.url) URL.revokeObjectURL(previous.url);
    })
    .catch(() => {})
    .finally(() => state.previewRequests.delete(clip.index));
}

function showClipPreview(clip, url) {
  const surface = document.querySelector(`[data-preview-index="${clip.index}"] .preview-media`);
  if (!surface) return;
  const image = surface.querySelector('img');
  if (image) image.src = url;
  else surface.innerHTML = `<img src="${escapeHtml(url)}" alt="Live preview for ${escapeHtml(clip.name)}" />`;
  // Keep the live patcher from putting back the previous frame on the next render.
  surface.__liveHtml = `<img src="${escapeHtml(url)}" alt="Live preview for ${escapeHtml(clip.name)}">`;
  invalidate();
}

function removeStaleClipPreviews() {
  const clipsByIndex = new Map(state.clips.map((clip) => [clip.index, clip.filePath]));
  state.clipPreviews.forEach((preview, index) => {
    if (clipsByIndex.get(index) !== preview.filePath) {
      URL.revokeObjectURL(preview.url);
      state.clipPreviews.delete(index);
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDashboard({ force: true });
});

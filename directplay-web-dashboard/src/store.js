// Dashboard state, the REST client and derived timeline values.
import { DirectPlayClient } from '@medialooks/directplay-js-client';
import { asList, clamp } from './util.js';

function storedNumber(key, fallback, min, max) {
  const value = localStorage.getItem(key);
  const number = value === null ? fallback : Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

export const state = {
  baseUrl: localStorage.getItem('directplay.baseUrl') || '/dp-api/',
  token: localStorage.getItem('directplay.token') || '',
  connected: false,
  loading: false,
  app: null,
  /** performance.now() when `app` was read; the playhead is extrapolated from the master clock since then. */
  appReadAt: 0,
  clips: [],
  selectedClipIndex: null,
  focusedClipIndex: null,
  roots: [],
  tab: 'playback',
  log: [],

  archive: [],
  archiveFilters: { name: '', timecode: '', date: '' },
  archiveLoaded: false,
  archiveLoading: false,
  archiveError: '',
  archiveSearchController: null,
  archiveThumbnails: new Map(),
  archiveThumbnailRequestId: 0,
  archiveMode: localStorage.getItem('directplay.archiveMode') === 'ai' ? 'ai' : 'files',
  pendingArchiveLoads: new Set(),
  ai: { query: '', date: '', job: null, checked: false, pollTimer: null, error: '', settings: null, draft: {}, server: null, settingsError: '' },

  exports: { destination: '', isExporting: false, jobs: [] },
  exportDestinationDraft: null,

  previewFps: storedNumber('directplay.previewFps', 3, 0, 10),
  clipPreviews: new Map(),
  previewRequests: new Set(),
  previewTimer: null,
  previewCursor: 0,

  settingsOpen: false,
  connectionOpen: false,
  connectionEditing: false,
  pointerActive: false,
  renderPending: false,
  refreshTimer: null,
  lastRootsRefresh: 0,
  lastExportsRefresh: 0,

  /** Keyboard J/L presses since the last stop: repeated presses double the speed, like the desktop player. */
  shuttleKeys: { direction: 0, presses: 0 },
  keyJog: { direction: 0, intensity: 0, lastInput: 0, idleTimer: null },
  timeline: {
    viewStart: 0,
    viewSpan: 0,
    fitted: true,
    follow: localStorage.getItem('directplay.timelineFollow') === 'off' ? 'off' : 'page',
    /** Position shown while the user drags the playhead, before Direct Play reports it back. */
    scrubSeconds: null
  }
};

export const client = new DirectPlayClient({ baseUrl: state.baseUrl, token: state.token });

export function addLog(message) {
  state.log.unshift(`${new Date().toLocaleTimeString()}  ${message}`);
  state.log = state.log.slice(0, 20);
}

export function savePreference(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* private window: keep the value for this session only */ }
}

export const isLinked = (clip) => clip?.isLinkedToMaster !== false;
export const linkedClips = () => state.clips.filter(isLinked);
export const selectedClip = () => state.clips.find((clip) => clip.index === state.selectedClipIndex) || null;
/** Where a source starts on the master timeline (timecode alignment); 0 for independent sources. */
export const clipOffset = (clip) => (clip && isLinked(clip) ? Number(clip.syncOffset || 0) : 0);

/**
 * The master timeline as Direct Play reports it. Older Direct Play versions have no master fields in `app`,
 * so the reference source is used instead, as before.
 */
export function getMaster(now = performance.now()) {
  const app = state.app || {};
  const hasMaster = Number.isFinite(app.masterDuration);
  const duration = hasMaster
    ? Number(app.masterDuration)
    : Math.max(0, ...state.clips.map((clip) => Number(clip.duration || 0) + clipOffset(clip)));
  const clock = app.clock || {};
  let position;
  if (state.timeline.scrubSeconds !== null) position = state.timeline.scrubSeconds;
  else if (hasMaster && clock.running) position = Number(clock.now) + Number(clock.rate || 1) * (now - state.appReadAt) / 1000;
  else if (hasMaster) position = Number(app.masterPosition || 0);
  else {
    const reference = linkedClips().find((clip) => clip.index === state.selectedClipIndex) || linkedClips()[0] || state.clips[0];
    position = Number(reference?.position || 0) + clipOffset(reference);
  }
  const reference = linkedClips()[0];
  return {
    duration: Math.max(0, duration),
    position: clamp(position, 0, Math.max(0, duration)),
    markIn: hasMaster ? Number(app.masterMarkIn || 0) : Number(reference?.markIn || 0),
    markOut: hasMaster ? Number(app.masterMarkOut || 0) : Number(reference?.markOut || 0),
    frameRate: Number(app.frameRate || 25),
    running: Boolean(hasMaster && clock.running),
    rate: Number(clock.rate || 1),
    shuttle: app.shuttle || '',
    alignment: app.alignment || null
  };
}

export function transportState() {
  const linked = linkedClips();
  const playing = linked.some((clip) => clip.isPlaying && !clip.isPaused);
  const paused = !playing && linked.some((clip) => clip.isPaused);
  return { linked, playing, paused, stopped: !playing && !paused };
}

export function normalizeExports(value) {
  return { destination: value?.destination || '', isExporting: Boolean(value?.isExporting), jobs: asList(value?.jobs) };
}

// What buttons, inputs and keys do.
import { state, client, addLog, getMaster, savePreference, transportState } from './store.js';
import { render } from './dom.js';
import {
  runAction, refreshDashboard, scheduleRefresh, reconnect, loadArchiveResults, addArchiveToMultiview,
  startAiSearch, checkAiMeaning, cancelAiSearch, openAiMatch, loadAiSettings, schedulePreviewUpdates
} from './data.js';
import { bindTimeline, fitTimeline, requestTimelinePaint, setTimelineHandlers, toggleFollow, zoomTimeline } from './timeline.js';
import { formatShortTime, formatTimecodeInput, isEditingTarget } from './util.js';

const transport = { refresh: 'transport' };

// Linked transport ------------------------------------------------------------------------------------------------

function resetShuttleKeys() { state.shuttleKeys = { direction: 0, presses: 0 }; }

function shuttle(rate) {
  if (rate === 0) resetShuttleKeys();
  return runAction(rate === 0 ? 'Stop shuttle' : `Shuttle ${rate < 0 ? 'reverse' : 'forward'} ${Math.abs(rate)}x`, () => client.syncShuttle(rate), transport);
}

function playPause() {
  const { playing } = transportState();
  resetShuttleKeys();
  if (state.app?.clock?.shuttling) return shuttle(0);
  return playing
    ? runAction('Pause linked sources', () => client.syncPause(), transport)
    : runAction('Play linked sources', () => client.syncPlay(), transport);
}

/** J and L like an editing deck: the first L plays, each further press doubles the speed up to 8x. */
function shuttleKey(direction) {
  const keys = state.shuttleKeys;
  if (keys.direction !== direction) { keys.direction = direction; keys.presses = 0; }
  keys.presses++;
  if (direction > 0 && keys.presses === 1 && !state.app?.clock?.shuttling) {
    return runAction('Play linked sources', () => client.syncPlay(), transport);
  }
  // L: play, 2x, 4x, 8x. J: 1x, 2x, 4x, 8x in reverse.
  return shuttle(direction * Math.min(8, 2 ** (keys.presses - 1)));
}

export function jogLinked(direction, steps = 1) {
  return runAction('Jog linked sources', () => client.syncStep(direction, steps), { ...transport, quiet: true });
}

function selectClip(index) {
  if (!Number.isFinite(index) || !state.clips.some((clip) => clip.index === index)) return;
  state.selectedClipIndex = index;
  render();
  requestTimelinePaint();
  runAction('Select source', () => client.selectClip(index), { refresh: false, quiet: true });
}

function focusClip(index) {
  if (!Number.isFinite(index) || !state.clips.some((clip) => clip.index === index)) return;
  state.focusedClipIndex = index;
  selectClip(index);
}

setTimelineHandlers({ jog: jogLinked, select: selectClip });

// Buttons ---------------------------------------------------------------------------------------------------------

const ACTIONS = {
  connection: () => { state.connectionOpen = true; render(); },
  'close-connection': () => { state.connectionOpen = state.connectionEditing = false; document.activeElement?.blur(); render(); scheduleRefresh(); },
  connect: () => {
    state.baseUrl = document.querySelector('#baseUrl').value.trim() || '/dp-api/';
    state.token = document.querySelector('#token').value.trim();
    savePreference('directplay.baseUrl', state.baseUrl);
    savePreference('directplay.token', state.token);
    state.connectionEditing = state.connectionOpen = false;
    document.activeElement?.blur();
    render();
    return reconnect();
  },
  refresh: () => refreshDashboard({ force: true }),
  settings: () => { state.settingsOpen = true; render(); return loadAiSettings(); },
  'close-settings': () => { state.settingsOpen = false; document.activeElement?.blur(); render(); },
  'exit-focused-preview': () => { state.focusedClipIndex = null; render(); },

  'sync-play': () => { resetShuttleKeys(); return runAction('Play linked sources', () => client.syncPlay(), transport); },
  'sync-pause': () => { resetShuttleKeys(); return runAction('Pause linked sources', () => client.syncPause(), transport); },
  'sync-stop': () => { resetShuttleKeys(); return runAction('Stop linked sources', () => client.syncStop(), transport); },
  'sync-step-back': () => jogLinked(-1),
  'sync-step-forward': () => jogLinked(1),
  'sync-mark-in': () => runAction('Set IN on linked sources', () => client.syncMark(true), transport),
  'sync-mark-out': () => runAction('Set OUT on linked sources', () => client.syncMark(false), transport),
  shuttle: (button) => shuttle(Number(button.dataset.rate)),
  'zoom-in': () => { zoomTimeline(0.5); render(); },
  'zoom-out': () => { zoomTimeline(2); render(); },
  'zoom-fit': () => { fitTimeline(); render(); },
  'toggle-follow': () => { toggleFollow(); render(); },
  'toggle-alignment': () => {
    const next = getMaster().alignment === 'timecode' ? 'off' : 'timecode';
    return runAction(next === 'timecode' ? 'Align sources by timecode' : 'Start all sources at 0', () => client.setAlignment(next), transport);
  },

  search: () => {
    const filters = {
      name: document.querySelector('#archiveName').value.trim(),
      timecode: document.querySelector('#archiveTimecode').value.trim(),
      date: document.querySelector('#archiveDate').value
    };
    state.archiveFilters = filters;
    return runAction('Archive search', () => loadArchiveResults(filters), { refresh: false });
  },
  'add-root': () => {
    const path = window.prompt('Archive root folder path');
    if (path?.trim()) return runAction('Add archive root', () => client.addArchiveRoot(path.trim()));
  },
  'add-archive': (button) => addArchiveToMultiview(button.dataset.path),
  'archive-mode': (button) => {
    state.archiveMode = button.dataset.mode === 'ai' ? 'ai' : 'files';
    savePreference('directplay.archiveMode', state.archiveMode);
    render();
  },
  'ai-search': () => startAiSearch(),
  'ai-check-meaning': () => checkAiMeaning(),
  'ai-cancel': () => cancelAiSearch(),
  'open-ai-match': (button) => openAiMatch(button.dataset.path, Number(button.dataset.seconds)),

  'set-export-destination': () => {
    const path = document.querySelector('#exportDestination')?.value.trim();
    if (path) return runAction('Set export destination', async () => { await client.setExportDestination(path); state.exportDestinationDraft = null; });
  },
  'add-selected-export': () => runAction('Add selected cut', () => client.addSelectedExport()),
  'add-linked-export': () => runAction('Add linked cut', () => client.addLinkedExport()),
  'open-export-list': () => { state.tab = 'exports'; render(); },
  'run-selected-exports': () => runAction('Export selected jobs', () => client.runExports('selected')),
  'run-all-exports': () => runAction('Export all jobs', () => client.runExports('all')),
  'clear-completed-exports': () => runAction('Clear completed exports', () => client.clearCompletedExports()),
  'remove-export-job': (button) => runAction('Remove export job', () => client.removeExportJob(button.dataset.id)),

  'select-clip': (button) => selectClip(Number(button.dataset.index)),
  play: (button) => runAction('Play source', () => client.playClip(Number(button.dataset.index)), transport),
  pause: (button) => runAction('Pause source', () => client.pauseClip(Number(button.dataset.index)), transport),
  stop: (button) => runAction('Stop source', () => client.stopClip(Number(button.dataset.index)), transport),
  'step-back': (button) => runAction('Previous frame', () => client.stepClip(Number(button.dataset.index), -1), { ...transport, quiet: true }),
  'step-forward': (button) => runAction('Next frame', () => client.stepClip(Number(button.dataset.index), 1), { ...transport, quiet: true }),
  'mark-in': (button) => runAction('Set source IN', () => client.setClipMark(Number(button.dataset.index), true), transport),
  'mark-out': (button) => runAction('Set source OUT', () => client.setClipMark(Number(button.dataset.index), false), transport),
  'audio-toggle': (button) => runAction('Toggle audio preview', () => client.toggleClipAudio(Number(button.dataset.index)), transport)
};

function handleAction(button) {
  const action = ACTIONS[button.dataset.action];
  if (action) return action(button);
}

// Binding after each rebuild ----------------------------------------------------------------------------------------

export function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    render();
    if (state.tab === 'playback') schedulePreviewUpdates();
  }));
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleAction(button)));
  document.querySelector('#connectionForm')?.addEventListener('submit', (event) => { event.preventDefault(); ACTIONS.connect(); });
  document.querySelector('#exportDestination')?.addEventListener('input', (event) => { state.exportDestinationDraft = event.target.value; });

  document.querySelectorAll('.clip-card, .lane-head').forEach((surface) => surface.addEventListener('click', (event) => {
    if (event.target.closest('button, input, select, label, a')) return;
    clearTimeout(surface.__selectTimer);
    if (surface.matches('.clip-card')) surface.__selectTimer = setTimeout(() => selectClip(Number(surface.dataset.clip)), 220);
    else selectClip(Number(surface.dataset.clip));
  }));
  document.querySelectorAll('.clip-card').forEach((surface) => surface.addEventListener('dblclick', (event) => {
    if (event.target.closest('button, input, select, label, a')) return;
    clearTimeout(surface.__selectTimer);
    focusClip(Number(surface.dataset.clip));
  }));

  document.querySelectorAll('#baseUrl, #token').forEach((input) => {
    input.addEventListener('focus', () => { state.connectionEditing = true; clearTimeout(state.refreshTimer); });
    input.addEventListener('blur', () => setTimeout(() => { state.connectionEditing = false; scheduleRefresh(); }, 0));
  });

  document.querySelectorAll('.track-link').forEach((input) => input.addEventListener('change', () => {
    runAction(input.checked ? 'Link source to the timeline' : 'Make source independent', () => client.setClipLinked(Number(input.dataset.index), input.checked), transport);
  }));
  document.querySelectorAll('.export-job-selected').forEach((input) => input.addEventListener('change', () => {
    runAction(input.checked ? 'Select export job' : 'Unselect export job', () => client.updateExportJob(input.dataset.id, { isSelected: input.checked }));
  }));
  document.querySelectorAll('.export-reencode').forEach((input) => input.addEventListener('change', () => {
    runAction(input.checked ? 'Enable re-encode' : 'Disable re-encode', () => client.updateExportJob(input.dataset.id, { isReencodeEnabled: input.checked }));
  }));
  document.querySelectorAll('.export-container').forEach((select) => select.addEventListener('change', () => {
    runAction('Set export container', () => client.updateExportJob(select.dataset.id, { reencodeContainer: select.value }));
  }));

  bindArchiveInputs();
  bindSettingsForm();
  bindJogWheel();
  bindTimeline();
}

function bindArchiveInputs() {
  document.querySelector('#archiveTimecode')?.addEventListener('input', (event) => {
    event.target.value = formatTimecodeInput(event.target.value.replace(/\D/g, '').slice(0, 8));
    state.archiveFilters.timecode = event.target.value;
  });
  document.querySelector('#archiveName')?.addEventListener('input', (event) => { state.archiveFilters.name = event.target.value; });
  document.querySelector('#archiveName')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); ACTIONS.search(); } });
  document.querySelector('#archiveDate')?.addEventListener('input', (event) => { state.archiveFilters.date = event.target.value; });
  document.querySelector('#aiQuery')?.addEventListener('input', (event) => { state.ai.query = event.target.value; });
  document.querySelector('#aiQuery')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); startAiSearch(); } });
  document.querySelector('#aiDate')?.addEventListener('input', (event) => { state.ai.date = event.target.value; });
}

function bindSettingsForm() {
  document.querySelectorAll('[data-ai-setting]').forEach((select) => select.addEventListener('change', () => {
    state.ai.draft[select.dataset.aiSetting] = select.value;
    render();
  }));
  document.querySelector('#settingsForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    state.previewFps = Math.max(0, Math.min(10, Number(document.querySelector('#previewFps').value) || 0));
    savePreference('directplay.previewFps', state.previewFps);
    const draft = state.ai.draft;
    state.settingsOpen = false;
    document.activeElement?.blur();
    render();
    schedulePreviewUpdates();
    if (Object.keys(draft).length) {
      runAction('Save AI search settings', async () => {
        state.ai.settings = await client.updateAiSettings(draft);
        state.ai.draft = {};
      }, { refresh: false });
    }
  });
}

// Jog wheel: 15 degrees of turn is one frame; steps are batched while a request is in flight.
function bindJogWheel() {
  const wheel = document.querySelector('[data-jog-wheel]');
  if (!wheel) return;
  let rotation = Number(wheel.__rotation || 0);
  let pending = 0;
  let busy = false;
  const setRotation = (value) => { rotation = value; wheel.__rotation = value; wheel.style.setProperty('--jog-rotation', `${value}deg`); };
  const flush = async () => {
    if (busy || pending === 0) return;
    busy = true;
    const steps = pending;
    pending = 0;
    try { await client.syncStep(Math.sign(steps), Math.min(8, Math.abs(steps))); } catch (error) { addLog(`Jog: ${error.message}`); }
    busy = false;
    if (pending) flush();
    else refreshTransportSoon();
  };
  const step = (direction, count = 1) => { pending += direction * count; setRotation(rotation + direction * 15 * count); flush(); };
  setRotation(rotation);

  wheel.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (!event.deltaY) return;
    step(event.deltaY < 0 ? 1 : -1, Math.min(8, Math.max(1, Math.round(Math.abs(event.deltaY) / 80))));
  }, { passive: false });
  wheel.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); step(event.key === 'ArrowRight' ? 1 : -1); }
  });
  wheel.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const bounds = wheel.getBoundingClientRect();
    const angleOf = (e) => Math.atan2(e.clientX - (bounds.left + bounds.width / 2), -(e.clientY - (bounds.top + bounds.height / 2))) * 180 / Math.PI;
    let last = angleOf(event);
    let accumulated = 0;
    state.pointerActive = true;
    wheel.setPointerCapture(event.pointerId);
    wheel.classList.add('dragging');
    const move = (e) => {
      const angle = angleOf(e);
      let delta = angle - last;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      last = angle;
      accumulated += delta;
      setRotation(rotation + delta);
      while (Math.abs(accumulated) >= 15) {
        const direction = Math.sign(accumulated);
        accumulated -= direction * 15;
        pending += direction;
      }
      flush();
    };
    const end = () => {
      state.pointerActive = false;
      wheel.classList.remove('dragging');
      wheel.removeEventListener('pointermove', move);
      wheel.removeEventListener('pointerup', end);
      wheel.removeEventListener('pointercancel', end);
    };
    wheel.addEventListener('pointermove', move);
    wheel.addEventListener('pointerup', end);
    wheel.addEventListener('pointercancel', end);
  });
}

let transportTimer = 0;
function refreshTransportSoon() {
  clearTimeout(transportTimer);
  transportTimer = setTimeout(() => refreshDashboard({ force: true }), 120);
}

// Keyboard ----------------------------------------------------------------------------------------------------------

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.connectionOpen || state.settingsOpen) {
      state.connectionOpen = state.settingsOpen = state.connectionEditing = false;
      document.activeElement?.blur();
      render();
      scheduleRefresh();
    } else if (state.focusedClipIndex !== null) {
      state.focusedClipIndex = null;
      render();
    }
    return;
  }
  if (isEditingTarget(event.target) || state.settingsOpen || state.connectionOpen || state.tab !== 'playback' || !state.clips.length) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const handlers = {
    ' ': playPause,
    k: () => shuttle(0),
    l: () => shuttleKey(1),
    j: () => shuttleKey(-1),
    i: () => ACTIONS['sync-mark-in'](),
    o: () => ACTIONS['sync-mark-out'](),
    Home: () => runAction('Go to the start', () => client.syncSeek(0), transport),
    End: () => runAction('Go to the end', () => client.syncSeek(getMaster().duration), transport),
    '+': () => ACTIONS['zoom-in'](),
    '=': () => ACTIONS['zoom-in'](),
    '-': () => ACTIONS['zoom-out'](),
    '\\': () => ACTIONS['zoom-fit']()
  };
  if (handlers[key]) {
    event.preventDefault();
    handlers[key]();
    return;
  }
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (!direction) return;
  event.preventDefault();
  if (event.shiftKey) {
    const target = Math.max(0, getMaster().position + direction);
    runAction(`Go to ${formatShortTime(target)}`, () => client.syncSeek(target), { ...transport, quiet: true });
    return;
  }
  // Held arrows accelerate: 1, 2, 4 then 8 frames per request.
  const jog = state.keyJog;
  const now = Date.now();
  const elapsed = jog.lastInput ? now - jog.lastInput : Number.MAX_SAFE_INTEGER;
  if (direction !== jog.direction) jog.intensity = 0;
  jog.direction = direction;
  jog.lastInput = now;
  let steps = 1;
  if (elapsed <= 190) {
    jog.intensity = Math.min(8, jog.intensity + (elapsed < 85 ? 2 : 1));
    steps = jog.intensity < 3 ? 1 : jog.intensity < 5 ? 2 : jog.intensity < 7 ? 4 : 8;
  } else {
    jog.intensity = 0;
  }
  clearTimeout(jog.idleTimer);
  jog.idleTimer = setTimeout(() => { jog.direction = 0; jog.intensity = 0; jog.lastInput = 0; }, 420);
  jogLinked(direction, steps);
});

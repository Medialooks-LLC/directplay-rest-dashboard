// Classic timeline on one canvas: a ruler with the whole-recording overview and one lane per source on the same time
// scale, each source drawn where it starts on the master timeline (timecode alignment). Click or drag to scrub,
// wheel to scroll, Ctrl+wheel to zoom, Alt+wheel to step frames. Between polls the playhead is extrapolated from the
// master clock, so it moves smoothly instead of jumping every poll.
import { state, client, getMaster, clipOffset, isLinked, savePreference } from './store.js';
import { refreshTransport } from './data.js';
import { clamp, formatShortTime, formatTimecode, trackColour } from './util.js';

export const RULER_HEIGHT = 58;
export const LANE_HEIGHT = 34;
export const LANE_GAP = 4;
const OVERVIEW_TOP = 4;
const OVERVIEW_HEIGHT = 6;
const LABEL_BASELINE = 26;
const RANGE_TOP = 38;
const RANGE_HEIGHT = 16;
const MIN_VIEW_SECONDS = 1;

let paintFrame = 0;
let resizeObserver = null;
let jogHandler = () => {};
let selectHandler = () => {};

export function setTimelineHandlers({ jog, select }) {
  jogHandler = jog;
  selectHandler = select;
}

export function timelineHeight() {
  return RULER_HEIGHT + state.clips.length * (LANE_HEIGHT + LANE_GAP);
}

// View ------------------------------------------------------------------------------------------------------------

function view(duration) {
  const timeline = state.timeline;
  if (timeline.fitted || timeline.viewSpan <= 0 || timeline.viewSpan >= duration) {
    return { start: 0, span: Math.max(duration, MIN_VIEW_SECONDS) };
  }
  const span = clamp(timeline.viewSpan, MIN_VIEW_SECONDS, duration);
  return { start: clamp(timeline.viewStart, 0, Math.max(0, duration - span)), span };
}

function setView(start, span, duration) {
  const timeline = state.timeline;
  if (span >= duration - 1e-6) {
    timeline.fitted = true;
    timeline.viewStart = 0;
    timeline.viewSpan = duration;
  } else {
    timeline.fitted = false;
    timeline.viewSpan = clamp(span, MIN_VIEW_SECONDS, duration);
    timeline.viewStart = clamp(start, 0, Math.max(0, duration - timeline.viewSpan));
  }
  requestTimelinePaint();
}

export function zoomTimeline(factor, anchorSeconds = null) {
  const master = getMaster();
  if (master.duration <= 0) return;
  const current = view(master.duration);
  const anchor = anchorSeconds ?? master.position;
  const span = clamp(current.span * factor, MIN_VIEW_SECONDS, master.duration);
  const ratio = current.span > 0 ? (anchor - current.start) / current.span : 0.5;
  setView(anchor - span * clamp(ratio, 0, 1), span, master.duration);
}

export function fitTimeline() {
  state.timeline.fitted = true;
  requestTimelinePaint();
}

export function toggleFollow() {
  state.timeline.follow = state.timeline.follow === 'page' ? 'off' : 'page';
  savePreference('directplay.timelineFollow', state.timeline.follow);
}

export function zoomLabel() {
  const master = getMaster();
  if (state.timeline.fitted || master.duration <= 0) return 'Whole recording';
  return `${formatShortTime(view(master.duration).span)} visible`;
}

// Painting --------------------------------------------------------------------------------------------------------

export function requestTimelinePaint() {
  if (paintFrame) return;
  paintFrame = requestAnimationFrame(() => {
    paintFrame = 0;
    const master = paint();
    // Keep animating while the clock runs or the user drags; otherwise paint only when something changes.
    if (master && (master.running || state.timeline.scrubSeconds !== null)) requestTimelinePaint();
  });
}

function paint() {
  const canvas = document.querySelector('.timeline-canvas');
  if (!canvas) return null;
  const master = getMaster();
  followPlayhead(master);
  updateLiveTime(master);

  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (master.duration <= 0) {
    ctx.fillStyle = '#6f6f78';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.fillText('Load recordings to see them on the timeline.', 12, 30);
    return master;
  }

  const { start, span } = view(master.duration);
  const toX = (seconds) => (seconds - start) / span * width;
  drawRuler(ctx, width, master, start, span, toX);
  state.clips.forEach((clip, row) => drawLane(ctx, clip, row, width, toX));
  drawPlayhead(ctx, toX(master.position), height, master);
  return master;
}

function followPlayhead(master) {
  const timeline = state.timeline;
  if (!master.running || timeline.follow !== 'page' || timeline.fitted || timeline.scrubSeconds !== null) return;
  const { start, span } = view(master.duration);
  if (master.position < start || master.position > start + span) {
    // Turn the page: forward the playhead starts near the left edge, in reverse near the right edge.
    const next = master.rate >= 0 ? master.position - span * 0.05 : master.position - span * 0.95;
    timeline.viewStart = clamp(next, 0, Math.max(0, master.duration - span));
  }
}

function updateLiveTime(master) {
  const text = formatTimecode(master.position, master.frameRate);
  document.querySelectorAll('[data-master-time]').forEach((element) => {
    if (element.textContent !== text) element.textContent = text;
  });
}

function chooseStep(secondsPerPixel, minimumPixels) {
  const target = secondsPerPixel * minimumPixels;
  for (const step of [1 / 25, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]) {
    if (step >= target) return step;
  }
  return Math.ceil(target / 3600) * 3600;
}

function drawRuler(ctx, width, master, start, span, toX) {
  ctx.fillStyle = '#1b1b1e';
  ctx.fillRect(0, 0, width, RULER_HEIGHT);

  // Overview of the whole recording, with the visible window, IN/OUT and the playhead.
  const whole = (seconds) => seconds / master.duration * width;
  ctx.fillStyle = '#2b2b30';
  ctx.fillRect(0, OVERVIEW_TOP, width, OVERVIEW_HEIGHT);
  if (master.markIn > 0 || master.markOut > 0) {
    const out = master.markOut > 0 ? master.markOut : master.duration;
    ctx.fillStyle = 'rgba(47, 147, 245, .45)';
    ctx.fillRect(whole(master.markIn), OVERVIEW_TOP, Math.max(1, whole(out) - whole(master.markIn)), OVERVIEW_HEIGHT);
  }
  if (!state.timeline.fitted) {
    ctx.strokeStyle = '#8fc6ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(whole(start) + 0.5, OVERVIEW_TOP - 1.5, Math.max(3, whole(span) - 1), OVERVIEW_HEIGHT + 3);
  }
  ctx.fillStyle = '#f2f2ff';
  ctx.fillRect(whole(master.position) - 0.75, OVERVIEW_TOP - 1, 1.5, OVERVIEW_HEIGHT + 2);

  // Ticks and labels.
  const secondsPerPixel = span / width;
  const major = chooseStep(secondsPerPixel, 90);
  const minor = chooseStep(secondsPerPixel, 12);
  ctx.strokeStyle = '#46464d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let t = Math.floor(start / minor) * minor; t <= start + span; t += minor) {
    const x = Math.round(toX(t)) + 0.5;
    ctx.moveTo(x, RANGE_TOP - 5);
    ctx.lineTo(x, RANGE_TOP - 1);
  }
  ctx.stroke();
  ctx.strokeStyle = '#7a7a84';
  ctx.fillStyle = '#a6a6b0';
  ctx.font = '10px Consolas, "Cascadia Mono", monospace';
  ctx.textAlign = 'left';
  ctx.beginPath();
  for (let t = Math.floor(start / major) * major; t <= start + span; t += major) {
    const x = Math.round(toX(t)) + 0.5;
    ctx.moveTo(x, LABEL_BASELINE + 2);
    ctx.lineTo(x, RANGE_TOP - 1);
    ctx.fillText(major < 1 ? formatTimecode(t, master.frameRate).slice(3) : formatShortTime(t), x + 3, LABEL_BASELINE);
  }
  ctx.stroke();

  // Linked IN/OUT range.
  ctx.fillStyle = '#232327';
  ctx.fillRect(0, RANGE_TOP, width, RANGE_HEIGHT);
  if (master.markIn > 0 || master.markOut > 0) {
    const out = master.markOut > 0 ? master.markOut : master.duration;
    const left = toX(master.markIn);
    const right = toX(out);
    ctx.fillStyle = 'rgba(47, 147, 245, .38)';
    ctx.fillRect(left, RANGE_TOP, Math.max(1, right - left), RANGE_HEIGHT);
    ctx.fillStyle = '#56b4ff';
    ctx.fillRect(left - 1, RANGE_TOP - 2, 2, RANGE_HEIGHT + 4);
    ctx.fillStyle = master.markOut > 0 ? '#e65245' : '#56b4ff';
    ctx.fillRect(right - 1, RANGE_TOP - 2, 2, RANGE_HEIGHT + 4);
  }
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function drawLane(ctx, clip, row, width, toX) {
  const top = RULER_HEIGHT + row * (LANE_HEIGHT + LANE_GAP) + LANE_GAP / 2;
  const linked = isLinked(clip);
  const offset = clipOffset(clip);
  const duration = Number(clip.duration || 0);
  const colour = trackColour(clip.index);
  const selected = clip.index === state.selectedClipIndex;

  ctx.fillStyle = selected ? '#1c2530' : '#18181b';
  ctx.fillRect(0, top, width, LANE_HEIGHT);
  if (duration <= 0) return;

  const left = toX(offset);
  const right = toX(offset + duration);
  if (right < 0 || left > width) return;
  const bodyLeft = Math.max(-4, left);
  const bodyRight = Math.min(width + 4, right);
  ctx.save();
  roundedRect(ctx, bodyLeft, top + 2, bodyRight - bodyLeft, LANE_HEIGHT - 4, 3);
  ctx.clip();
  ctx.fillStyle = colour + '33';
  ctx.fillRect(bodyLeft, top + 2, bodyRight - bodyLeft, LANE_HEIGHT - 4);
  ctx.fillStyle = colour;
  ctx.fillRect(bodyLeft, top + 2, bodyRight - bodyLeft, 2);

  // Outside this source's IN/OUT is dimmed.
  const markIn = Number(clip.markIn || 0);
  const markOut = Number(clip.markOut || 0);
  if (markIn > 0 || markOut > 0) {
    const inX = toX(offset + markIn);
    const outX = toX(offset + (markOut > 0 ? markOut : duration));
    ctx.fillStyle = 'rgba(0, 0, 0, .45)';
    ctx.fillRect(bodyLeft, top + 2, Math.max(0, inX - bodyLeft), LANE_HEIGHT - 4);
    ctx.fillRect(outX, top + 2, Math.max(0, bodyRight - outX), LANE_HEIGHT - 4);
    ctx.fillStyle = colour;
    ctx.fillRect(inX - 1, top + 2, 2, LANE_HEIGHT - 4);
    ctx.fillRect(outX - 1, top + 2, 2, LANE_HEIGHT - 4);
  }

  ctx.fillStyle = '#e6e6ee';
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  const label = `${String(clip.index + 1).padStart(2, '0')}  ${clip.name || ''}${offset > 0 ? `   +${offset.toFixed(2)} s` : ''}`;
  ctx.fillText(label, Math.max(bodyLeft, 0) + 8, top + LANE_HEIGHT / 2 + 5, Math.max(20, bodyRight - Math.max(bodyLeft, 0) - 16));
  ctx.restore();

  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.strokeStyle = selected ? colour : '#3c3c43';
  if (!linked) ctx.setLineDash([4, 3]);
  roundedRect(ctx, bodyLeft + 0.5, top + 2.5, bodyRight - bodyLeft - 1, LANE_HEIGHT - 5, 3);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!linked) {
    // An independent source has its own position, shown as its own playhead.
    const x = toX(Number(clip.position || 0));
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(x - 1, top, 2, LANE_HEIGHT);
  }
}

function drawPlayhead(ctx, x, height, master) {
  ctx.fillStyle = 'rgba(242, 242, 255, .18)';
  ctx.fillRect(x - 3, RANGE_TOP - 6, 6, height - RANGE_TOP + 6);
  ctx.fillStyle = '#f2f2ff';
  ctx.fillRect(x - 1, RANGE_TOP - 6, 2, height - RANGE_TOP + 6);
  ctx.beginPath();
  ctx.moveTo(x, RANGE_TOP - 2);
  ctx.lineTo(x - 5, RANGE_TOP - 9);
  ctx.lineTo(x + 5, RANGE_TOP - 9);
  ctx.closePath();
  ctx.fill();

  const text = formatTimecode(master.position, master.frameRate);
  ctx.font = '600 11px Consolas, "Cascadia Mono", monospace';
  const boxWidth = ctx.measureText(text).width + 12;
  const width = ctx.canvas.clientWidth;
  const boxLeft = clamp(x - boxWidth / 2, 0, Math.max(0, width - boxWidth));
  ctx.fillStyle = '#101012';
  ctx.fillRect(boxLeft, RANGE_TOP + 1, boxWidth, RANGE_HEIGHT - 2);
  ctx.strokeStyle = '#5c5c66';
  ctx.strokeRect(boxLeft + 0.5, RANGE_TOP + 1.5, boxWidth - 1, RANGE_HEIGHT - 3);
  ctx.fillStyle = '#f2f2ff';
  ctx.textAlign = 'center';
  ctx.fillText(text, boxLeft + boxWidth / 2, RANGE_TOP + RANGE_HEIGHT - 4);
}

// Interaction -----------------------------------------------------------------------------------------------------

/** Seeks while dragging: one request in flight, the newest position wins. */
function createScrubber(send) {
  let pending = null;
  let busy = false;
  const pump = async () => {
    if (busy || pending === null) return;
    busy = true;
    const target = pending;
    pending = null;
    try { await send(target); } catch { /* the final seek on release reports errors */ }
    busy = false;
    pump();
  };
  return {
    push(value) { pending = value; pump(); },
    async finish(value) {
      pending = null;
      while (busy) await new Promise((resolve) => setTimeout(resolve, 15));
      await send(value);
    }
  };
}

function hit(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const master = getMaster();
  const { start, span } = view(master.duration);
  const seconds = clamp(start + x / Math.max(1, bounds.width) * span, 0, master.duration);
  const row = y >= RULER_HEIGHT ? Math.floor((y - RULER_HEIGHT) / (LANE_HEIGHT + LANE_GAP)) : -1;
  return { x, y, seconds, master, clip: row >= 0 ? state.clips[row] : null, width: bounds.width };
}

export function bindTimeline() {
  const canvas = document.querySelector('.timeline-canvas');
  if (!canvas) return;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const first = hit(canvas, event);
    if (first.master.duration <= 0) return;
    event.preventDefault();
    if (first.y < OVERVIEW_TOP + OVERVIEW_HEIGHT + 4 && !state.timeline.fitted) {
      // Overview strip: move the zoomed view there.
      const span = view(first.master.duration).span;
      setView(first.x / first.width * first.master.duration - span / 2, span, first.master.duration);
      return;
    }
    const independent = first.clip && !isLinked(first.clip) ? first.clip : null;
    const scrubber = createScrubber(independent
      ? (seconds) => client.seekClip(independent.index, seconds)
      : (seconds) => client.syncSeek(seconds));
    const toTarget = (info) => (independent ? clamp(info.seconds, 0, Number(independent.duration || 0)) : info.seconds);
    state.pointerActive = true;
    canvas.setPointerCapture(event.pointerId);
    let target = toTarget(first);
    if (!independent) state.timeline.scrubSeconds = target;
    scrubber.push(target);
    requestTimelinePaint();

    const move = (current) => {
      target = toTarget(hit(canvas, current));
      if (!independent) state.timeline.scrubSeconds = target;
      scrubber.push(target);
      requestTimelinePaint();
    };
    const end = async () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      state.pointerActive = false;
      // Select the lane's source only now: selecting re-renders the page, which must not replace the canvas mid-drag.
      if (first.clip && first.clip.index !== state.selectedClipIndex) selectHandler(first.clip.index);
      try { await scrubber.finish(target); } catch { /* reported by the next poll */ }
      await refreshTransport();
      state.timeline.scrubSeconds = null;
      requestTimelinePaint();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  });

  canvas.addEventListener('dblclick', (event) => {
    if (hit(canvas, event).y < RULER_HEIGHT) fitTimeline();
  });

  // Same as the desktop timeline: wheel scrolls the view, Shift+wheel scrolls further, Ctrl+wheel zooms, Alt+wheel jogs.
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const info = hit(canvas, event);
    const delta = event.deltaY || event.deltaX;
    if (info.master.duration <= 0 || !delta) return;
    if (event.altKey) {
      jogHandler(delta < 0 ? 1 : -1, Math.min(8, Math.max(1, Math.round(Math.abs(delta) / 80))));
    } else if (event.ctrlKey || event.metaKey) {
      zoomTimeline(delta < 0 ? 0.8 : 1.25, info.seconds);
    } else {
      const current = view(info.master.duration);
      setView(current.start + Math.sign(delta) * current.span * (event.shiftKey ? 0.5 : 0.1), current.span, info.master.duration);
    }
  }, { passive: false });

  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => requestTimelinePaint());
  resizeObserver.observe(canvas);
}

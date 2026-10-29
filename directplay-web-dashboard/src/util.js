// Formatting and small helpers shared by every view.

export function asList(value) { return Array.isArray(value) ? value : []; }

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

/** hh:mm:ss.mmm */
export function formatTime(value) {
  return new Date(Math.max(0, Number(value || 0)) * 1000).toISOString().slice(11, 23);
}

/** hh:mm:ss:ff at the given frame rate. */
export function formatTimecode(seconds, frameRate = 25) {
  const fps = Math.max(1, Math.round(Number(frameRate) || 25));
  const total = Math.max(0, Number(seconds || 0));
  const whole = Math.floor(total);
  const frames = Math.min(fps - 1, Math.floor((total - whole) * fps + 1e-6));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}:${pad(frames)}`;
}

/** m:ss or h:mm:ss for ruler labels and result chips. */
export function formatShortTime(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), sec = whole % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatDate(value) { return value ? new Date(value).toLocaleString() : 'Unknown'; }

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimecodeInput(digits) {
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join(':');
}

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

export function isEditingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}

export function plural(count, word) { return `${count} ${word}${count === 1 ? '' : 's'}`; }

/** Accent per source number, matching the desktop timeline colours closely enough to recognise a track. */
const TRACK_COLOURS = ['#2f93f5', '#3fbf8a', '#e0a33a', '#c46cf0', '#e0605a', '#3cc6d6', '#9fbf3f', '#f07ab5'];
export function trackColour(index) { return TRACK_COLOURS[Math.abs(Number(index) || 0) % TRACK_COLOURS.length]; }

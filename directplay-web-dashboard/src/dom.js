// Rendering: the page is described as one HTML string. Elements whose values change while playing are marked with
// data-live. When only those values change they are patched in place (no DOM rebuild, no icon re-creation, no preview
// flicker, focus kept). The DOM is rebuilt only when the structure changes and nobody is typing or dragging.
import { createIcons } from 'lucide';
import { state } from './store.js';
import { isEditingTarget } from './util.js';

const LIVE_ATTRIBUTES = ['class', 'style', 'aria-pressed', 'disabled', 'max', 'value', 'title'];
let lastHtml = '';
let lastStructure = '';
let view = { build: () => '', bind: () => {}, afterRender: () => {}, icons: {} };

export function setView(next) { view = next; }

/** Forget the last page so the next render patches everything (used after writing to the DOM directly). */
export function invalidate() { lastHtml = ''; }

export function render() {
  const html = view.build();
  if (html === lastHtml) return;
  const template = document.createElement('template');
  template.innerHTML = html;
  const structure = structureOf(template);
  const root = document.querySelector('#app');
  if (structure === lastStructure && root.firstElementChild) {
    patchLiveValues(template);
    lastHtml = html;
    view.afterRender();
    return;
  }
  if (state.pointerActive || isEditingTarget(document.activeElement)) {
    state.renderPending = true;
    return;
  }
  state.renderPending = false;
  lastHtml = html;
  lastStructure = structure;
  const scrollPositions = [...document.querySelectorAll('[data-scroll]')].map((el) => [el.dataset.scroll, el.scrollTop]);
  root.replaceChildren(template.content);
  createIcons({ icons: view.icons });
  view.bind();
  for (const [key, top] of scrollPositions) {
    const element = [...document.querySelectorAll('[data-scroll]')].find((el) => el.dataset.scroll === key);
    if (element) element.scrollTop = top;
  }
  view.afterRender();
}

function structureOf(template) {
  const clone = template.content.cloneNode(true);
  clone.querySelectorAll('[data-live]').forEach((element) => {
    LIVE_ATTRIBUTES.forEach((name) => element.removeAttribute(name));
    if (element.dataset.live === 'content') element.textContent = '';
  });
  const holder = document.createElement('div');
  holder.append(clone);
  return holder.innerHTML;
}

function patchLiveValues(template) {
  const next = template.content.querySelectorAll('[data-live]');
  const current = document.querySelectorAll('#app [data-live]');
  if (next.length !== current.length) return;
  let needsIcons = false;
  next.forEach((source, index) => {
    const target = current[index];
    const editing = target === document.activeElement;
    for (const name of LIVE_ATTRIBUTES) {
      if (editing && name === 'value') continue;
      const value = source.getAttribute(name);
      if (value === null) {
        if (target.hasAttribute(name)) target.removeAttribute(name);
      } else if (target.getAttribute(name) !== value) {
        target.setAttribute(name, value);
      }
      if (name === 'value' && value !== null && 'value' in target && !editing && target.value !== value) target.value = value;
    }
    if (source.dataset.live === 'content' && target.__liveHtml !== source.innerHTML) {
      target.__liveHtml = source.innerHTML;
      target.innerHTML = source.innerHTML;
      needsIcons ||= target.querySelector('[data-lucide]') !== null;
    }
  });
  if (needsIcons) createIcons({ icons: view.icons });
}

document.addEventListener('focusout', () => setTimeout(() => { if (state.renderPending) render(); }, 0));
document.addEventListener('pointerup', () => setTimeout(() => { if (state.renderPending) render(); }, 0));

import { escapeHtml } from '../util.js';

export function renderEmpty(title, detail) {
  return `<div class="empty"><i data-lucide="link-2"></i><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

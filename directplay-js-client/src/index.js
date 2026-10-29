export class DirectPlayApiError extends Error {
  constructor(response, body) {
    super(`Direct Play API request failed with HTTP ${response.status} ${response.statusText}. ${body}`);
    this.name = 'DirectPlayApiError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
  }
}

export class DirectPlayClient {
  constructor({ baseUrl = 'http://127.0.0.1:9532/api/', token = '', fetchImpl = globalThis.fetch } = {}) {
    if (!fetchImpl) {
      throw new Error('A fetch implementation is required.');
    }

    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
    this.fetch = fetchImpl.bind(globalThis);
  }

  setConnection({ baseUrl, token } = {}) {
    if (baseUrl) this.baseUrl = normalizeBaseUrl(baseUrl);
    if (token !== undefined) this.token = token;
  }

  getApplicationState(options) { return this.get('app', options); }
  getClips(options) { return this.get('clips', options); }
  getClip(index, options) { return this.get(`clips/${index}`, options); }
  getClipPreview(index, options) { return this.getBinary(`clips/${index}/preview?ts=${Date.now()}`, options); }
  selectClip(index, options) { return this.put(`clips/${index}/select`, {}, options); }
  playClip(index, options) { return this.put(`clips/${index}/play`, {}, options); }
  pauseClip(index, options) { return this.put(`clips/${index}/pause`, {}, options); }
  stopClip(index, options) { return this.put(`clips/${index}/stop`, {}, options); }
  setClipLinked(index, linked, options) { return this.put(`clips/${index}/${linked ? 'link' : 'unlink'}`, {}, options); }
  setClipMark(index, isIn, options) { return this.put(`clips/${index}/${isIn ? 'mark-in' : 'mark-out'}`, {}, options); }
  toggleClipAudio(index, options) { return this.put(`clips/${index}/audio-toggle`, {}, options); }
  stepClip(index, direction, options) {
    return this.put(`clips/${index}/${direction < 0 ? 'step-backward' : 'step-forward'}`, {}, options);
  }
  seekClip(index, seconds, options) {
    return this.put(`clips/${index}/seek/${encodeURIComponent(Number(seconds).toFixed(3))}`, {}, options);
  }
  syncPlay(options) { return this.put('playback/sync-play', {}, options); }
  syncPause(options) { return this.put('playback/sync-pause', {}, options); }
  syncStop(options) { return this.put('playback/sync-stop', {}, options); }
  syncStep(direction, steps = 1, options) { return this.put(`playback/sync-step-${direction < 0 ? 'backward' : 'forward'}/${Math.max(1, Math.min(8, Math.round(steps)))}`, {}, options); }
  syncSeek(seconds, options) { return this.put(`playback/sync-seek/${encodeURIComponent(Number(seconds).toFixed(3))}`, {}, options); }
  syncMark(isIn, options) { return this.put(`playback/sync-mark-${isIn ? 'in' : 'out'}`, {}, options); }
  /** Shuttle linked sources at a signed speed like J/L (-8..8, negative = reverse); 0 stops like K. */
  syncShuttle(rate, options) { return this.put(`playback/sync-shuttle/${encodeURIComponent(Number(rate).toFixed(2))}`, {}, options); }
  /** Line linked sources up by recording timecode ('timecode') or start them all at 0 ('off'). */
  setAlignment(mode, options) { return this.put(`playback/alignment/${mode === 'off' ? 'off' : 'timecode'}`, {}, options); }
  getArchiveRoots(options) { return this.get('archive/roots', options); }
  addArchiveRoot(path, options) { return this.post('archive/root', { path }, options); }
  openArchiveItem(filePath, options) { return this.post('archive/open', { filePath }, options); }
  getArchiveThumbnail(filePath, options) { return this.getBinary(`archive/thumbnail?path=${encodeURIComponent(filePath)}`, options); }
  searchArchive({ name = '', timecode = '', date = '' } = {}, options) {
    const query = new URLSearchParams();
    if (name) query.set('name', name);
    if (timecode) query.set('timecode', timecode);
    if (date) query.set('date', date);
    const suffix = query.size ? `?${query}` : '';
    return this.get(`archive/search${suffix}`, options);
  }
  getAiSettings(options) { return this.get('ai/settings', options); }
  updateAiSettings(patch, options) { return this.put('ai/settings', patch, options); }
  getAiServer(options) { return this.get('ai/server', options); }
  /** checkMeaning: true runs the search with the AI vision model check (Direct Play's "Check the meaning"). */
  startAiSearch({ query, date, time, checkMeaning } = {}, options) {
    return this.post('ai/search', { query, date: date || undefined, time: time || undefined, checkMeaning: checkMeaning || undefined }, options);
  }
  getAiSearch(id, options) { return this.get(`ai/search/${encodeURIComponent(id)}`, options); }
  cancelAiSearch(id, options) { return this.post(`ai/search/${encodeURIComponent(id)}/cancel`, {}, options); }
  getExports(options) { return this.get('exports', options); }
  addSelectedExport(options) { return this.post('exports/selected', {}, options); }
  addLinkedExport(options) { return this.post('exports/linked', {}, options); }
  updateExportJob(id, patch, options) { return this.patch(`exports/${encodeURIComponent(id)}`, patch, options); }
  removeExportJob(id, options) { return this.delete(`exports/${encodeURIComponent(id)}`, options); }
  runExports(mode = 'selected', options) { return this.post('exports/run', { mode }, options); }
  clearCompletedExports(options) { return this.post('exports/clear-completed', {}, options); }
  setExportDestination(path, options) { return this.post('exports/destination', { path }, options); }

  get(path, options) { return this.request(path, { ...options, method: 'GET' }); }
  getBinary(path, options) { return this.requestBinary(path, { ...options, method: 'GET' }); }
  post(path, body, options) { return this.request(path, { ...options, method: 'POST', body }); }
  put(path, body = {}, options) { return this.request(path, { ...options, method: 'PUT', body }); }
  patch(path, body = {}, options) { return this.request(path, { ...options, method: 'PATCH', body }); }
  delete(path, options) { return this.request(path, { ...options, method: 'DELETE' }); }

  async request(path, { method = 'GET', body, signal, headers = {} } = {}) {
    const response = await this.fetch(new URL(path, getAbsoluteBaseUrl(this.baseUrl)), {
      method,
      headers: this.getRequestHeaders(headers, body, method),
      signal,
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) throw new DirectPlayApiError(response, text);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text.replace(/^"|"$/g, ''); }
  }

  async requestBinary(path, { method = 'GET', signal, headers = {} } = {}) {
    const response = await this.fetch(new URL(path, getAbsoluteBaseUrl(this.baseUrl)), {
      method,
      headers: this.getRequestHeaders(headers, undefined, method),
      signal
    });
    if (!response.ok) throw new DirectPlayApiError(response, await response.text());
    return response.blob();
  }

  getRequestHeaders(headers, body, method) {
    const requestHeaders = { Accept: 'application/json', ...headers };
    const token = this.token.trim();
    if (token) requestHeaders.Authorization = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
    if (body !== undefined && method !== 'GET') requestHeaders['Content-Type'] = 'application/json';
    return requestHeaders;
  }
}

function normalizeBaseUrl(value) {
  const url = String(value || '').trim();
  return url.endsWith('/') ? url : `${url}/`;
}

function getAbsoluteBaseUrl(baseUrl) {
  if (globalThis.location?.href) return new URL(baseUrl, globalThis.location.href);
  return baseUrl;
}

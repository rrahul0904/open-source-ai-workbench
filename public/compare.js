const $ = (id) => document.getElementById(id);
const state = { mode: 'demo', catalog: null, selected: new Set(), controller: null, result: null, cards: new Map(), prompt: '' };
const EXAMPLE = 'Design a reliable ETL architecture for 50 million daily records. Compare batch, streaming, data quality checks, costs, and operational risks.';
const authHeaders = () => $('apiKey').value ? { authorization: `Bearer ${$('apiKey').value}` } : {};
const safeLabel = value => String(value || '').replace(/[^\w .:/-]/g, '').slice(0, 90);

function status(message) { $('status').textContent = message; }
function mode(name) {
  if (state.controller) return;
  state.mode = name;
  $('demoMode').classList.toggle('selected', name === 'demo');
  $('liveMode').classList.toggle('selected', name === 'live');
  $('demoMode').setAttribute('aria-pressed', String(name === 'demo'));
  $('liveMode').setAttribute('aria-pressed', String(name === 'live'));
  $('consentWrap').hidden = name !== 'live';
  $('modeNotice').textContent = name === 'demo' ? 'All four demos are synthetic. No prompts are sent to external AI providers.' : 'Live runs send your prompt separately to selected configured providers. Operator access key and explicit consent are required.';
  state.selected = new Set((state.catalog?.modes[name] || []).filter(m => m.mode === 'demo' || m.ready).map(m => m.id));
  renderModels();
}
function renderModels() {
  const mount = $('models'); mount.replaceChildren();
  const items = state.catalog?.modes[state.mode] || [];
  for (const item of items) {
    const label = document.createElement('label'); label.className = 'model';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id; input.checked = state.selected.has(item.id); input.disabled = item.ready === false || Boolean(state.controller);
    input.addEventListener('change', () => { input.checked ? state.selected.add(item.id) : state.selected.delete(item.id); $('selectedCount').textContent = `${state.selected.size} / 4`; });
    const copy = document.createElement('span'); const name = document.createElement('b'); name.textContent = item.name; const detail = document.createElement('small'); detail.textContent = safeLabel(item.model || item.description || 'Not configured') + (item.ready === false ? ' · Not configured' : '');
    copy.append(name, detail); label.append(input, copy); mount.append(label);
  }
  if (!items.length) mount.textContent = 'No models available for this mode.';
  $('selectedCount').textContent = `${state.selected.size} / 4`;
}
async function loadCatalog() {
  status('Connecting to comparison API…');
  try {
    const response = await fetch('/api/compare/catalog', { headers: authHeaders(), cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    state.catalog = data;
    $('liveMode').disabled = !data.liveEnabled;
    $('modeIndicator').textContent = data.liveEnabled ? 'Demo + gated live' : 'Synthetic demo';
    $('footerMode').textContent = `${data.version} · ${data.storage} comparison`;
    if (!data.liveEnabled && state.mode === 'live') state.mode = 'demo';
    mode(state.mode); status('Connected. Ready to compare.');
  } catch (error) { state.catalog = null; state.selected.clear(); renderModels(); $('modeIndicator').textContent = 'Access required'; status(`Catalog unavailable: ${error.message}. If this workspace is protected, enter your access key and refresh.`); }
}
function resultCard(id) {
  const meta = state.catalog.modes[state.mode].find(m => m.id === id) || { name: id, model: id };
  const card = document.createElement('article'); card.className = 'result-card'; card.setAttribute('aria-label', `${meta.name} response`);
  const head = document.createElement('div'); head.className = 'card-head'; const labels = document.createElement('div');
  const name = document.createElement('strong'); name.textContent = meta.name; const subtitle = document.createElement('small'); subtitle.textContent = `${safeLabel(meta.model)} · ${state.mode === 'demo' ? 'SYNTHETIC' : 'LIVE'}`; labels.append(name, subtitle);
  const pill = document.createElement('span'); pill.className = 'status-pill'; pill.textContent = 'Pending'; pill.dataset.status = 'pending'; head.append(labels, pill);
  const text = document.createElement('pre'); text.className = 'card-text'; text.textContent = 'Awaiting provider…';
  const foot = document.createElement('div'); foot.className = 'card-foot'; foot.textContent = 'Usage details appear after completion.';
  card.append(head, text, foot); return { card, pill, text, foot, content: '' };
}
function prepareCards() {
  $('results').replaceChildren(); state.cards.clear();
  for (const id of state.selected) { const ui = resultCard(id); state.cards.set(id, ui); $('results').append(ui.card); }
  $('summary').hidden = true; $('copy').disabled = true; $('export').disabled = true;
}
function update(event) {
  if (event.type === 'run.started') { status(event.synthetic ? 'Four synthetic lenses running independently…' : 'Sending prompt to approved live providers…'); return; }
  const card = state.cards.get(event.modelId);
  if (card && event.type === 'provider.started') { card.pill.textContent = 'Streaming'; card.pill.dataset.status = 'running'; card.text.textContent = ''; }
  if (card && event.type === 'provider.delta') { card.content += String(event.text || ''); card.text.textContent = card.content; }
  if (card && event.type === 'provider.usage') { card.foot.textContent = 'Provider-reported usage: ' + JSON.stringify(event.usage).slice(0, 150); }
  if (card && event.type === 'provider.completed') { card.pill.textContent = 'Completed'; card.pill.dataset.status = 'completed'; if (!card.content) card.text.textContent = '(No text emitted)'; }
  if (card && event.type === 'provider.terminal') { card.pill.textContent = event.status; card.pill.dataset.status = event.status; card.text.textContent = card.content + (card.content ? '\n\n' : '') + `[${event.errorCode || 'Provider failed'} — no unverified retry was made.]`; }
  if (event.type === 'run.completed') {
    state.result = event.result;
    for (const model of event.result.models) {
      const view = state.cards.get(model.id); if (!view) continue;
      view.content = model.text; view.text.textContent = model.text || (model.errorCode ? `[${model.errorCode}]` : '(No text emitted)');
      view.pill.textContent = model.status; view.pill.dataset.status = model.status;
      view.foot.textContent = `${model.elapsedMs}ms${model.usage ? ' · Provider-reported usage: ' + JSON.stringify(model.usage).slice(0, 120) : ''}`;
    }
    $('summary').hidden = false; $('summaryText').textContent = event.result.synthesis.statement;
    $('copy').disabled = false; $('export').disabled = false;
    const ok = event.result.models.filter(m => m.status === 'completed').length;
    status(`Comparison finished. ${ok}/${event.result.models.length} providers completed in ${event.result.elapsedMs}ms.`);
  }
}
async function readEvents(body, onEvent) {
  if (!body) throw new Error('Streaming is unavailable from this server');
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
      if (buffer.length > 500000) throw new Error('Oversized event frame');
      let cut; while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
        const lines = chunk.split('\n');
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) {
          const event = JSON.parse(data);
          if (event.error) throw new Error(event.error);
          onEvent(event);
        }
      }
      if (done) return;
    }
  } finally { reader.releaseLock(); }
}
async function run(event) {
  event.preventDefault(); if (state.controller || !state.catalog) return;
  state.prompt = $('prompt').value.trim(); if (!state.prompt || state.prompt.length > 4000) return status('Provide a prompt of at most 4000 characters.');
  if (state.selected.size === 0) return status('Select at least one model.');
  if (state.mode === 'live' && !$('consent').checked) return status('Live mode requires explicit third-party provider consent.');
  state.result = null; state.controller = new AbortController(); $('run').disabled = true; $('cancel').disabled = false; $('demoMode').disabled = true; $('liveMode').disabled = true; prepareCards(); renderModels();
  const controller = state.controller;
  try {
    const response = await fetch('/api/compare/stream', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ prompt: state.prompt, mode: state.mode, models: [...state.selected], consent: state.mode === 'live' && $('consent').checked }), signal: controller.signal, cache: 'no-store' });
    if (!response.ok) { let detail; try { detail = (await response.json()).error; } catch {} throw new Error(detail || `HTTP ${response.status}`); }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Server did not return an event stream');
    await readEvents(response.body, update);
    if (!state.result) throw new Error('Stream ended without a final summary. Results may be incomplete.');
  } catch (error) { status(controller.signal.aborted ? 'Comparison cancelled. Partial answers are not verified.' : `Comparison interrupted: ${error.message}`); }
  finally { state.controller = null; $('run').disabled = false; $('cancel').disabled = true; $('demoMode').disabled = false; $('liveMode').disabled = !state.catalog.liveEnabled; renderModels(); }
}
function markdown() {
  if (!state.result) return '';
  return [`# Evidence Lab comparison`, `Mode: ${state.result.mode}${state.result.synthetic ? ' (synthetic outputs)' : ' (provider-generated outputs)'}`, `Run ID: ${state.result.runId}`, `Prompt: ${state.prompt}`, '', ...state.result.models.flatMap(m => [`## ${m.provider} / ${m.model}`, `Status: ${m.status}`, '', m.text || '(No complete text)', '']), '## Comparison note', state.result.synthesis.statement, 'Independent factual verification was not performed.'].join('\n');
}
$('demoMode').addEventListener('click', () => mode('demo'));
$('liveMode').addEventListener('click', () => mode('live'));
$('apiKey').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadCatalog(); } });
$('refresh').addEventListener('click', loadCatalog);
$('example').addEventListener('click', () => { $('prompt').value = EXAMPLE; $('prompt').dispatchEvent(new Event('input')); $('prompt').focus(); });
$('prompt').addEventListener('input', () => { $('charCount').textContent = `${$('prompt').value.length} / 4000 characters`; });
$('compareForm').addEventListener('submit', run);
$('cancel').addEventListener('click', () => state.controller?.abort());
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(markdown()); status('Markdown comparison copied.'); } catch { status('Clipboard unavailable; use JSON export.'); } });
$('export').addEventListener('click', () => { if (!state.result) return; const json = JSON.stringify({ ...state.result, prompt: state.prompt, exportNotice: 'Synthetic outputs are not real provider results. No factual verification.' }, null, 2); const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `evidence-lab-${state.result.runId}.json`; link.click(); URL.revokeObjectURL(url); });
loadCatalog();

const state = { capabilities: [], selected: null };
const samples = {
  'trading-research': { symbol: 'SNOW', question: 'Evaluate the setup and summarize the bull, bear and risk cases.' },
  'multi-model-chat': { prompt: 'Design a migration plan from a legacy warehouse to a cloud-native analytics platform.', provider: 'demo' },
  'video-composer': { topic: 'How agentic workflows work', durationSeconds: 30 },
  'finance-terminal': { symbol: 'DATA' },
  'content-factory': { topic: 'Modern data architecture', audience: 'enterprise data leaders', durationSeconds: 30 },
  'agentic-inbox': { subject: 'Production incident follow-up', body: 'Urgent: please review the incident summary and reply today.' },
  'voice-studio': { text: 'Your AI workbench is ready to create, investigate and automate.', voice: 'workbench-demo' },
  'osint-graph': { entities: [{ id: 'org-1', type: 'organization', label: 'Example Corp' }, { id: 'domain-1', type: 'domain', label: 'example.org' }], relationships: [] },
  'engineering-agent': { goal: 'Ship a production-ready workflow feature with exact verification evidence.' },
  'connector-runtime': { connector: 'demo-connector', operation: 'sync', payload: { records: 3 } },
  'launch-campaign': { topic: 'AI agents for data engineering', audience: 'senior data architects', durationSeconds: 24 }
};

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char])); }

function selectCapability(capability) {
  state.selected = capability;
  document.querySelectorAll('.capability').forEach((button) => button.classList.toggle('active', button.dataset.id === capability.id));
  document.querySelector('#workflowTitle').textContent = capability.name;
  document.querySelector('#workflowDescription').textContent = capability.description;
  document.querySelector('#categoryLabel').textContent = `${capability.category.toUpperCase()} · ${capability.inspiredBy}`;
  resetSample();
}

function resetSample() {
  const sample = samples[state.selected?.id] || {};
  document.querySelector('#workflowInput').value = JSON.stringify(sample, null, 2);
}

function renderCapabilities(capabilities) {
  const mount = document.querySelector('#capabilityList');
  mount.innerHTML = capabilities.map((capability) => `<button class="capability" data-id="${escapeHtml(capability.id)}"><strong>${escapeHtml(capability.name)}</strong><span>${escapeHtml(capability.category)} · ${escapeHtml(capability.inspiredBy)}</span></button>`).join('');
  mount.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => selectCapability(capabilities.find((item) => item.id === button.dataset.id))));
  selectCapability(capabilities[0]);
}

function renderProviders(data) {
  const providers = data.providers || {};
  document.querySelector('#runtimeMode').textContent = data.authMode === 'protected' ? 'Protected' : 'Zero-config demo';
  document.querySelector('#providerGrid').innerHTML = Object.entries(providers).map(([key, value]) => `<div class="provider"><span>${escapeHtml(key)}</span><b>${escapeHtml(value)}</b></div>`).join('');
}

function renderAudio(run) {
  const audio = run?.output?.audioDataUrl || run?.output?.voice?.audioDataUrl || run?.output?.content?.voice?.audioDataUrl;
  document.querySelector('#audioMount').innerHTML = audio ? `<audio controls src="${audio}"></audio>` : '';
}

async function refreshHistory() {
  try {
    const data = await api('/api/runs');
    document.querySelector('#runHistory').innerHTML = data.runs.length ? data.runs.slice(0, 10).map((run) => `<div class="history-item"><strong>${escapeHtml(run.capability)}</strong><span class="${run.status === 'succeeded' ? 'success' : 'failed'}">${escapeHtml(run.status)} · ${run.durationMs}ms</span></div>`).join('') : '<div class="history-item"><span>No runs yet.</span></div>';
  } catch {}
}

async function runWorkflow(workflowId, input) {
  const result = document.querySelector('#result');
  result.textContent = 'Running…';
  document.querySelector('#duration').textContent = '';
  document.querySelector('#audioMount').innerHTML = '';
  try {
    const run = await api('/api/workflows/run', { method: 'POST', body: JSON.stringify({ workflowId, input }) });
    result.textContent = JSON.stringify(run.output, null, 2);
    document.querySelector('#duration').textContent = `${run.durationMs}ms`;
    renderAudio(run);
    await refreshHistory();
    return run;
  } catch (error) {
    result.textContent = `Error: ${error.message}`;
    throw error;
  }
}

document.querySelector('#workflowForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selected) return;
  try { await runWorkflow(state.selected.id, JSON.parse(document.querySelector('#workflowInput').value)); }
  catch (error) { if (error instanceof SyntaxError) document.querySelector('#result').textContent = `Invalid JSON: ${error.message}`; }
});
document.querySelector('#resetInput').addEventListener('click', resetSample);
document.querySelector('#launchDemo').addEventListener('click', async () => {
  const capability = state.capabilities.find((item) => item.id === 'launch-campaign');
  selectCapability(capability);
  document.querySelector('#workbench').scrollIntoView({ behavior: 'smooth' });
  await runWorkflow('launch-campaign', samples['launch-campaign']);
});

async function init() {
  try {
    const [health, catalogue] = await Promise.all([api('/api/health'), api('/api/capabilities')]);
    document.querySelector('#systemStatus').textContent = `${health.capabilities} capabilities online`;
    state.capabilities = catalogue.capabilities;
    renderCapabilities(catalogue.capabilities);
    renderProviders(catalogue);
    await refreshHistory();
  } catch (error) {
    document.querySelector('#systemStatus').textContent = `Runtime unavailable: ${error.message}`;
  }
}
init();

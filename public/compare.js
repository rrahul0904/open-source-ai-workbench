/* RE-334 original, synthetic-only browser controller; session-only DOM state. */
const form = document.querySelector('#compareForm');
const startButton = document.querySelector('#start');
const cancelButton = document.querySelector('#cancel');
const notice = document.querySelector('#announcer');
const errorBox = document.querySelector('#error');
const connection = document.querySelector('#connection');
const cards = new Map([...document.querySelectorAll('.lane')].map((card) => [card.dataset.model, card]));
let current = null;

function announce(message) { notice.textContent = message; }
function error(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.focus?.();
}
function status(id, message) {
  const card = cards.get(id);
  if (card) card.querySelector('[data-status]').textContent = message;
}
function reset(models) {
  errorBox.hidden = true;
  errorBox.textContent = '';
  for (const [id, card] of cards) {
    card.hidden = !models.includes(id);
    card.querySelector('[data-output]').textContent = 'No output yet.';
    status(id, models.includes(id) ? 'Waiting' : 'Not selected');
  }
}
function finished(message, failed = false) {
  const run = current;
  if (!run || run.done) return;
  run.done = true;
  run.source?.close();
  startButton.disabled = false;
  cancelButton.disabled = true;
  connection.textContent = failed ? 'Stream stopped' : 'Finished';
  announce(message);
  if (failed) error(message);
}
function receive(message) {
  const run = current;
  if (!run || run.done) return;
  let event;
  try { event = JSON.parse(message.data); }
  catch { finished('Invalid event from synthetic stream.', true); return; }
  const match = /^(.+):([1-9][0-9]*)$/.exec(message.lastEventId || event.eventId || '');
  if (!match || match[1] !== run.id) {
    finished('Invalid run event identifier.', true); return;
  }
  const sequence = Number(match[2]);
  if (!Number.isSafeInteger(sequence)) { finished('Invalid event sequence.', true); return; }
  if (sequence <= run.lastSequence) return; // replayed frames never append duplicate text
  if (sequence !== run.lastSequence + 1) {
    finished('A streamed event was missed. Start a fresh comparison.', true); return;
  }
  run.lastSequence = sequence;
  if (event.type === 'provider.started') {
    status(event.modelId, 'Streaming synthetic output');
  } else if (event.type === 'provider.delta') {
    const output = cards.get(event.modelId)?.querySelector('[data-output]');
    if (output && typeof event.text === 'string') {
      if (output.textContent === 'No output yet.') output.textContent = '';
      output.textContent += event.text;
    }
  } else if (event.type === 'provider.completed') {
    status(event.modelId, 'Completed');
  } else if (event.type === 'provider.terminal') {
    status(event.modelId, `${event.status}: ${event.error || 'Synthetic adapter stopped'}`);
  } else if (event.type === 'run.completed') {
    finished(`Synthetic comparison finished: ${event.completedCount} complete. No synthesis or factual verification was performed.`);
  } else if (event.type === 'run.failed') {
    finished('Synthetic comparison stopped unexpectedly.', true);
  }
}
function connect(run) {
  const source = new EventSource(run.eventsUrl);
  run.source = source;
  const types = ['run.started', 'provider.started', 'provider.delta',
    'provider.completed', 'provider.terminal', 'run.completed', 'run.failed'];
  for (const type of types) source.addEventListener(type, receive);
  source.onopen = () => {
    if (current !== run || run.done) return;
    run.retries = 0;
    connection.textContent = 'Connected · streaming events';
    announce('Synthetic stream connected.');
  };
  source.onerror = () => {
    if (current !== run || run.done) return;
    run.retries += 1;
    connection.textContent = 'Connection interrupted · reconnecting';
    announce('Connection interrupted. Replaying from the last received event.');
    // EventSource automatically sends Last-Event-ID on a network reconnect.
    if (source.readyState === EventSource.CLOSED || run.retries > 5) {
      finished('Stream unavailable; this page cannot verify the run outcome.', true);
    }
  };
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (current && !current.done) return;
  const prompt = form.querySelector('#prompt').value;
  const models = [...form.querySelectorAll('input[name="models"]:checked')].map((input) => input.value);
  if (!models.length) { error('Choose at least one demo adapter.'); return; }
  reset(models);
  startButton.disabled = true;
  cancelButton.disabled = true;
  connection.textContent = 'Starting';
  announce('Starting synthetic comparison.');
  try {
    const response = await fetch('/api/compare/runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, models })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not start comparison.');
    current = { id: body.runId, eventsUrl: body.eventsUrl, cancelUrl: body.cancelUrl,
      source: null, lastSequence: 0, retries: 0, done: false };
    cancelButton.disabled = false;
    connect(current);
  } catch (caught) {
    startButton.disabled = false;
    connection.textContent = 'Not connected';
    error(caught.message || 'Could not start comparison.');
    announce('Synthetic comparison could not start.');
  }
});
cancelButton.addEventListener('click', async () => {
  const run = current;
  if (!run || run.done) return;
  cancelButton.disabled = true;
  announce('Requesting cancellation of the current synthetic run.');
  try {
    const response = await fetch(run.cancelUrl, { method: 'DELETE' });
    if (!response.ok) throw new Error('Cancellation request failed.');
    // Keep the stream open for independent provider.terminal and run.completed events.
    announce('Cancellation requested; collecting final provider statuses.');
  } catch {
    cancelButton.disabled = false;
    error('Could not send cancellation. Retry while connected.');
  }
});

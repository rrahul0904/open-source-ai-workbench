/** First-party documented provider streaming API mappings, no arbitrary user-defined URL or model. */
import { createDemoAdapters } from '../model-compare.mjs';
import { getLiveSpec } from './registry.mjs';

export class ProviderError extends Error { constructor(code = 'PROVIDER_FAILURE') { super(code); this.name = 'ProviderError'; this.code = code; } }

// Handles CRLF, fragmented JSON and multiple events in one network chunk. Does not surface raw provider errors.
export async function* parseSSE(body, signal) {
  if (!body || typeof body.getReader !== 'function') throw new ProviderError('INVALID_PROVIDER_STREAM');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let terminal = false;
  let lastCR = false;
  try {
    while (true) {
      if (signal?.aborted) throw new ProviderError('CANCELLED');
      const { value, done } = await reader.read();
      let decoded = decoder.decode(value || new Uint8Array(), { stream: !done });
      if (lastCR && decoded.startsWith('\n')) decoded = decoded.slice(1);
      lastCR = decoded.endsWith('\r');
      buffered += decoded.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (buffered.length > 100_000) throw new ProviderError('PROVIDER_EVENT_TOO_LARGE');
      let cut;
      while ((cut = buffered.indexOf('\n\n')) !== -1) {
        const frame = buffered.slice(0, cut); buffered = buffered.slice(cut + 2);
        const lines = frame.split('\n');
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
        if (!data) continue;
        if (data === '[DONE]') { terminal = true; yield { event: 'done', data: null }; return; }
        let json;
        try { json = JSON.parse(data); } catch { throw new ProviderError('INVALID_PROVIDER_EVENT'); }
        yield { event, data: json };
      }
      if (done) {
        if (buffered.trim()) throw new ProviderError('INCOMPLETE_PROVIDER_EVENT');
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function providerRequest(id, spec, prompt, maxOutputTokens) {
  switch (id) {
    case 'openai':
      return { url: 'https://api.openai.com/v1/chat/completions', headers: { authorization: `Bearer ${spec.apiKey}` }, body: { model: spec.model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: maxOutputTokens, stream: true, stream_options: { include_usage: true } } };
    case 'deepseek':
      return { url: 'https://api.deepseek.com/chat/completions', headers: { authorization: `Bearer ${spec.apiKey}` }, body: { model: spec.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxOutputTokens, stream: true, stream_options: { include_usage: true } } };
    case 'anthropic':
      return { url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': spec.apiKey, 'anthropic-version': '2023-06-01' }, body: { model: spec.model, max_tokens: maxOutputTokens, stream: true, messages: [{ role: 'user', content: prompt }] } };
    case 'gemini':
      return { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(spec.model)}:streamGenerateContent?alt=sse`, headers: { 'x-goog-api-key': spec.apiKey }, body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens } } };
    default: throw new ProviderError('UNKNOWN_PROVIDER');
  }
}

export function createAdapters({ mode, env = process.env, fetchImpl = fetch } = {}) {
  if (mode === 'demo') return createDemoAdapters();
  if (mode !== 'live') throw new ProviderError('INVALID_MODE');
  return Object.fromEntries(['openai', 'anthropic', 'gemini', 'deepseek'].map(id => [id, {
    async *stream({ prompt, signal, maxOutputTokens = 512 }) {
      const spec = getLiveSpec(id, env);
      if (!spec) throw new ProviderError('PROVIDER_UNCONFIGURED');
      const request = providerRequest(id, spec, prompt, maxOutputTokens);
      const response = await fetchImpl(request.url, { method: 'POST', headers: { 'content-type': 'application/json', ...request.headers }, body: JSON.stringify(request.body), signal });
      if (!response.ok) throw new ProviderError(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR');
      let emitted = 0, terminated = false;
      for await (const item of parseSSE(response.body, signal)) {
        if (item.event === 'done') { terminated = true; break; }
        if (id === 'anthropic' && item.data?.type === 'message_stop') terminated = true;
        if (id === 'gemini' && item.data?.candidates?.[0]?.finishReason) terminated = true;
        if (item.event === 'error' || item.data.type === 'error' || item.data.error) throw new ProviderError('PROVIDER_STREAM_ERROR');
        let delta = '';
        let usage = null;
        if (id === 'anthropic') {
          if (item.data.type === 'content_block_delta' && item.data.delta?.type === 'text_delta') delta = item.data.delta.text || '';
          if (item.data.type === 'message_start') usage = item.data.message?.usage || null;
          if (item.data.type === 'message_delta') usage = item.data.usage || null;
        } else if (id === 'gemini') {
          delta = item.data.candidates?.[0]?.content?.parts?.filter(part => typeof part.text === 'string').map(part => part.text).join('') || '';
          usage = item.data.usageMetadata || null;
        } else {
          delta = item.data.choices?.[0]?.delta?.content || '';
          usage = item.data.usage || null;
        }
        if (typeof delta === 'string' && delta) {
          emitted += delta.length;
          if (emitted > 16_000) throw new ProviderError('OUTPUT_LIMIT');
          yield { delta };
        }
        if (usage) yield { usage };
      }
      if (!terminated) throw new ProviderError('INCOMPLETE_PROVIDER_STREAM');
    }
  }]));
}

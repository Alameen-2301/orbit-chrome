import { endpoint, jsonObject, redact } from './config.js';

export function requestHeaders(profile, secrets = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const key = (secrets.apiKey || '').trim();
  if (profile.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  if (key && profile.authMode !== 'none') {
    const mode = profile.authMode === 'auto' ? ({anthropic: 'x-api-key', gemini: 'x-goog-api-key'}[profile.protocol] || 'bearer') : profile.authMode;
    if (mode === 'bearer') headers.Authorization = `Bearer ${key}`;
    else headers[mode] = key;
  }
  for (const [name, value] of Object.entries(jsonObject(secrets.extraHeaders, 'Custom headers'))) {
    if (!/^[\w-]+$/.test(name) || /^(host|cookie|origin|referer|content-length|connection|proxy-.*|sec-.*)$/i.test(name)) {
      throw new Error(`The ${name} header is not allowed.`);
    }
    if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error(`Invalid value for header ${name}.`);
    // Headers are case-insensitive; replacing a default must not create duplicates.
    const previous = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    if (previous) delete headers[previous];
    headers[name] = value;
  }
  return headers;
}

export function completionRequest(profile, messages, system) {
  const { model, protocol, extraBody = {} } = profile;
  let path, body;
  if (protocol === 'chat') {
    path = 'chat/completions';
    body = { ...extraBody, model, messages: [{role: 'system', content: system}, ...messages], stream: false };
  } else if (protocol === 'responses') {
    path = 'responses';
    body = { max_output_tokens: 4096, store: false, ...extraBody, model, instructions: system, input: messages, stream: false };
  } else if (protocol === 'anthropic') {
    path = 'messages';
    body = { max_tokens: 4096, ...extraBody, model, system, messages, stream: false };
  } else if (protocol === 'gemini') {
    path = `models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`;
    body = {
      ...extraBody,
      systemInstruction: {parts: [{text: system}]},
      contents: messages.map(m => ({role: m.role === 'assistant' ? 'model' : 'user', parts: [{text: m.content}]})),
    };
  } else if (protocol === 'ollama') {
    path = 'api/chat';
    body = { ...extraBody, model, messages: [{role: 'system', content: system}, ...messages], stream: false };
  } else throw new Error('Unsupported API format.');
  return { url: endpoint(profile, profile.requestPath || path), body };
}

export function extractText(protocol, data) {
  let text;
  if (protocol === 'chat') {
    const content = data.choices?.[0]?.message?.content;
    text = typeof content === 'string' ? content : content?.filter(p => p.type === 'text').map(p => p.text).join('\n');
    if (data.choices?.[0]?.finish_reason === 'length') throw new Error('The model reached its output limit. Increase the token limit in request options.');
  } else if (protocol === 'responses') {
    text = data.output_text || data.output?.flatMap(item => item.content || []).filter(p => p.type === 'output_text').map(p => p.text).join('\n');
    if (data.status === 'incomplete') throw new Error('The model response was incomplete. Increase max_output_tokens in request options.');
  } else if (protocol === 'anthropic') {
    text = data.content?.filter(p => p.type === 'text').map(p => p.text).join('\n');
    if (data.stop_reason === 'max_tokens') throw new Error('Claude reached its output limit. Increase max_tokens in request options.');
  } else if (protocol === 'gemini') {
    text = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('\n');
    const reason = data.candidates?.[0]?.finishReason;
    if (reason && reason !== 'STOP') throw new Error(`Gemini stopped: ${reason}.`);
  } else if (protocol === 'ollama') text = data.message?.content;
  if (!text?.trim()) throw new Error('The provider returned no text. Check that this is a chat/text model and that its output budget is sufficient.');
  return text.trim();
}

export async function fetchJson(url, {headers, body, signal, fetchImpl = fetch, timeout = 120000}) {
  const timer = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, timer]) : timer;
  let response;
  try {
    response = await fetchImpl(url, {
      method: body ? 'POST' : 'GET', headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: combined, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Task stopped.', 'AbortError');
    if (timer.aborted) throw new Error('The provider took more than two minutes. Try a faster model or a smaller page.');
    throw new Error('Could not reach the API. Check its URL, Chrome site access, CORS support, and whether your local server is running.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`The API returned HTTP ${response.status} without a JSON response. Check the endpoint path.`); }
  if (!response.ok || data.error) {
    const detail = data.error?.message || (typeof data.error === 'string' ? data.error : data.message) || response.statusText;
    throw new Error(`API ${response.status}: ${String(detail).slice(0, 600)}`);
  }
  return data;
}

export async function complete(profile, secrets, messages, system, signal, fetchImpl) {
  try {
    const request = completionRequest(profile, messages, system);
    const data = await fetchJson(request.url, {headers: requestHeaders(profile, secrets), body: request.body, signal, fetchImpl});
    return extractText(profile.protocol, data);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(redact(error.message, secrets));
  }
}

export async function listModels(profile, secrets, signal, fetchImpl) {
  try {
    const headers = requestHeaders(profile, secrets);
    const models = [];
    let cursor;
    for (let page = 0; page < 12; page++) {
      let path = profile.protocol === 'ollama' ? 'api/tags' : 'models';
      if (profile.protocol === 'gemini') path += `?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`;
      else if (profile.protocol === 'anthropic') path += `?limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`;
      const data = await fetchJson(endpoint(profile, path), {headers, signal, fetchImpl});
      if (profile.protocol === 'gemini') {
        models.push(...(data.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => ({id: m.name.replace(/^models\//, ''), name: m.displayName || m.name})));
        cursor = data.nextPageToken;
      } else if (profile.protocol === 'ollama') {
        models.push(...(data.models || []).map(m => ({id: m.name, name: m.name})));
        cursor = null;
      } else {
        models.push(...(data.data || []).map(m => ({id: m.id, name: m.display_name || m.name || m.id})));
        cursor = profile.protocol === 'anthropic' && data.has_more ? data.last_id : null;
      }
      if (!cursor) break;
    }
    const unique = [...new Map(models.filter(m => typeof m.id === 'string').map(m => [m.id, m])).values()];
    if (!unique.length) throw new Error('No models were listed. Enter a model ID manually; your provider may not offer model discovery.');
    return unique.sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) { throw new Error(redact(error.message, secrets)); }
}

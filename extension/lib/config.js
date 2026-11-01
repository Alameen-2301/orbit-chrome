export const PRESETS = [
  { id: 'openai', name: 'OpenAI', protocol: 'responses', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic · Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'gemini', name: 'Google · Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'chat', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', name: 'Groq', protocol: 'chat', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'chat', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'mistral', name: 'Mistral', protocol: 'chat', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'xai', name: 'xAI', protocol: 'chat', baseUrl: 'https://api.x.ai/v1' },
  { id: 'together', name: 'Together AI', protocol: 'chat', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'cerebras', name: 'Cerebras', protocol: 'chat', baseUrl: 'https://api.cerebras.ai/v1' },
  { id: 'ollama', name: 'Ollama · local', protocol: 'ollama', baseUrl: 'http://localhost:11434' },
  { id: 'lmstudio', name: 'LM Studio · local', protocol: 'chat', baseUrl: 'http://localhost:1234/v1' },
  { id: 'custom', name: 'Custom endpoint', protocol: 'chat', baseUrl: '' },
];

export const DEFAULT_PREFERENCES = { maxSteps: 16, pageLimit: 18000 };
export const PROTOCOLS = ['chat', 'responses', 'anthropic', 'gemini', 'ollama'];

export function httpUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Enter a complete http:// or https:// URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP(S) URLs without embedded credentials are allowed.');
  }
  return url;
}

export function apiBase(raw) {
  const url = httpUrl(raw);
  if (url.search || url.hash) throw new Error('Keep query parameters in the request path, not the API base URL.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Remote API endpoints must use HTTPS. HTTP is supported for local servers only.');
  }
  return url.href.replace(/\/+$/, '');
}

export function originPattern(raw) {
  const url = httpUrl(raw);
  return `${url.protocol}//${url.hostname}/*`;
}

export function jsonObject(value, label) {
  let parsed;
  try { parsed = typeof value === 'string' ? JSON.parse(value || '{}') : (value ?? {}); }
  catch { throw new Error(`${label} must be valid JSON.`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
  return parsed;
}

export function validateProfile(input, requireModel = true) {
  if (!PROTOCOLS.includes(input.protocol)) throw new Error('Select a supported API format.');
  const profile = {
    id: String(input.id || crypto.randomUUID()),
    preset: String(input.preset || 'custom'),
    name: String(input.name || 'My connection').trim().slice(0, 80),
    protocol: input.protocol,
    baseUrl: apiBase(input.baseUrl),
    model: String(input.model || '').trim(),
    requestPath: String(input.requestPath || '').trim(),
    authMode: input.authMode || 'auto',
    extraBody: jsonObject(input.extraBody, 'Request options'),
    remember: !!input.remember,
  };
  if (requireModel && !profile.model) throw new Error('Choose a model or enter its exact model ID.');
  if (profile.model.length > 240 || /[\r\n]/.test(profile.model)) throw new Error('The model ID is invalid.');
  if (!['auto', 'bearer', 'api-key', 'x-api-key', 'none'].includes(profile.authMode)) throw new Error('Unknown authentication mode.');
  if (profile.requestPath) endpoint(profile, profile.requestPath);
  const reserved = ['model', 'messages', 'input', 'instructions', 'system', 'systemInstruction', 'contents', 'stream', 'tools', 'tool_choice', '__proto__', 'constructor', 'prototype'];
  for (const key of Object.keys(profile.extraBody)) {
    if (reserved.includes(key)) throw new Error(`Request options cannot override ${key}.`);
  }
  return profile;
}

export function endpoint(profile, path) {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.includes('#')) throw new Error('The request path must be relative to the API base URL.');
  const base = apiBase(profile.baseUrl);
  const url = new URL(`${base}/${path.replace(/^\/+/, '')}`);
  if (url.origin !== new URL(base).origin) throw new Error('The endpoint must use the configured API origin.');
  return url.href;
}

export function safePageUrl(raw) {
  const url = httpUrl(raw);
  if (['chromewebstore.google.com', 'chrome.google.com'].includes(url.hostname)) {
    throw new Error('Chrome prevents extensions from controlling the Chrome Web Store.');
  }
  return url.href;
}

export function redact(text, secrets = {}) {
  let result = String(text);
  for (const value of [secrets.apiKey, ...Object.values(secrets.extraHeaders || {})]) {
    if (typeof value === 'string' && value.length >= 4) result = result.split(value).join('[redacted]');
  }
  return result;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, apiBase, endpoint, originPattern, safePageUrl } from '../extension/lib/config.js';
import { completionRequest, extractText, requestHeaders, complete, listModels, fetchJson } from '../extension/lib/providers.js';

const profile = (protocol = 'chat', extra = {}) => validateProfile({name: 'Test', protocol, baseUrl: 'https://api.example.test/v1', model: 'any-text-model', authMode: 'auto', ...extra});
const messages = [{role: 'user', content: 'Hello'}, {role: 'assistant', content: 'Hi'}];
const json = data => new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}});

test('API origins reject embedded credentials, insecure remote hosts, and query strings', () => {
  assert.throws(() => apiBase('https://user:secret@example.test/v1'), /credentials/);
  assert.throws(() => apiBase('http://example.test/v1'), /HTTPS/);
  assert.throws(() => apiBase('https://example.test/v1?key=secret'), /query/);
  assert.throws(() => apiBase('file:///etc/passwd'), /HTTP/);
  assert.equal(apiBase('http://localhost:11434/'), 'http://localhost:11434');
  assert.equal(apiBase('http://[::1]:11434/'), 'http://[::1]:11434');
});

test('custom paths cannot redirect API credentials to another origin', () => {
  const p = profile();
  for (const path of ['https://attacker.test/chat', '//attacker.test/chat', 'chat#fragment']) assert.throws(() => endpoint(p, path));
  assert.equal(endpoint(p, 'chat/completions?api-version=2025-01-01'), 'https://api.example.test/v1/chat/completions?api-version=2025-01-01');
  assert.equal(originPattern('http://localhost:1234/v1'), 'http://localhost/*');
  assert.throws(() => safePageUrl('javascript:alert(1)'));
  assert.throws(() => safePageUrl('chrome://settings'));
  assert.throws(() => safePageUrl('https://chromewebstore.google.com/detail/x'));
});

test('request options cannot replace the conversation or register extra tools', () => {
  for (const key of ['messages', 'system', 'stream', 'tools', 'model', 'input']) assert.throws(() => profile('chat', {extraBody: {[key]: []}}), /cannot override/);
  assert.throws(() => profile('chat', {extraBody: '[]'}), /JSON object/);
});

test('Chat Completions preserves system and conversation without incompatible default parameters', () => {
  const request = completionRequest(profile(), messages, 'System instructions');
  assert.equal(request.url, 'https://api.example.test/v1/chat/completions');
  assert.deepEqual(request.body.messages, [{role:'system',content:'System instructions'}, ...messages]);
  assert.equal(request.body.stream, false);
  assert.equal(request.body.temperature, undefined);
  assert.equal(request.body.max_tokens, undefined);
});

test('Responses uses input and instructions; requests no provider storage by default', () => {
  const {url, body} = completionRequest(profile('responses'), messages, 'System');
  assert.match(url, /\/responses$/);
  assert.deepEqual(body.input, messages); assert.equal(body.instructions, 'System'); assert.equal(body.store, false);
});

test('Anthropic uses top-level system and the required token budget', () => {
  const {body, url} = completionRequest(profile('anthropic', {extraBody: {max_tokens: 8192}}), messages, 'System');
  assert.match(url, /\/messages$/); assert.equal(body.system, 'System'); assert.equal(body.max_tokens, 8192);
  assert.deepEqual(body.messages, messages);
  const headers = requestHeaders(profile('anthropic'), {apiKey: 'secret-key'});
  assert.equal(headers['x-api-key'], 'secret-key'); assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
});

test('Gemini maps assistant roles and authenticates without putting the key in its URL', () => {
  const p = profile('gemini', {model: 'models/gemini-text'});
  const {body, url} = completionRequest(p, messages, 'System');
  assert.match(url, /\/models\/gemini-text:generateContent$/);
  assert.deepEqual(body.contents.map(m => m.role), ['user', 'model']);
  assert.equal(body.systemInstruction.parts[0].text, 'System');
  assert.equal(requestHeaders(p, {apiKey: 'private'})['x-goog-api-key'], 'private');
  assert.ok(!url.includes('private'));
});

test('Ollama native chat accepts an unkeyed local endpoint', () => {
  const p = profile('ollama', {baseUrl: 'http://localhost:11434'});
  const {body, url} = completionRequest(p, messages, 'System');
  assert.equal(url, 'http://localhost:11434/api/chat'); assert.equal(body.stream, false);
  assert.equal(requestHeaders(p, {}).Authorization, undefined);
});

test('custom auth supports Azure api-key and case-insensitive header replacement', () => {
  const p = profile('chat', {authMode: 'api-key'});
  assert.equal(requestHeaders(p, {apiKey: 'azure-key'})['api-key'], 'azure-key');
  const headers = requestHeaders(profile(), {apiKey:'key', extraHeaders: {authorization: 'Bearer override'}});
  assert.equal(headers.Authorization, undefined); assert.equal(headers.authorization, 'Bearer override');
  for (const header of ['Cookie','Host','Proxy-Authorization','Sec-Fetch-Site']) assert.throws(() => requestHeaders(p, {extraHeaders:{[header]:'bad'}}), /not allowed/);
  assert.throws(() => requestHeaders(p, {extraHeaders:{'X-Test':'a\r\nb'}}), /Invalid/);
});

test('all adapters extract visible text and never substitute hidden thinking for content', () => {
  assert.equal(extractText('chat',{choices:[{message:{content:'hello'}}]}), 'hello');
  assert.equal(extractText('responses',{output:[{type:'reasoning',summary:[]},{content:[{type:'output_text',text:'hello'}]}]}), 'hello');
  assert.equal(extractText('anthropic',{content:[{type:'thinking',thinking:'secret'},{type:'text',text:'hello'}]}), 'hello');
  assert.equal(extractText('gemini',{candidates:[{content:{parts:[{thought:true,text:'secret'},{text:'hello'}]},finishReason:'STOP'}]}), 'hello');
  assert.equal(extractText('ollama',{message:{thinking:'secret',content:'hello'}}), 'hello');
  assert.throws(() => extractText('chat', {choices:[{message:{content:null}}]}), /no text/);
});

test('truncated or blocked responses never become executable partial actions', () => {
  assert.throws(() => extractText('chat', {choices:[{message:{content:'{"action":'},finish_reason:'length'}]}), /output limit/);
  assert.throws(() => extractText('responses', {status:'incomplete',output_text:'{"action":'}), /incomplete/);
  assert.throws(() => extractText('anthropic', {stop_reason:'max_tokens',content:[{type:'text',text:'{"action":'}]}), /output limit/);
  assert.throws(() => extractText('gemini', {candidates:[{finishReason:'SAFETY'}]}), /SAFETY/);
});

test('transport omits cookies and referrers and refuses redirects', async () => {
  let options;
  const result = await fetchJson('https://api.example.test', {headers:{},body:{hello:1},fetchImpl:async (_url, args) => {options=args;return json({ok:true});}});
  assert.deepEqual(result,{ok:true}); assert.equal(options.redirect,'error'); assert.equal(options.credentials,'omit'); assert.equal(options.referrerPolicy,'no-referrer');
});

test('provider errors cannot echo a saved credential into the UI', async () => {
  const secrets = {apiKey:'sk-private-very-secret',extraHeaders:{'X-Secret':'header-secret'}};
  const fetchImpl = async () => new Response(JSON.stringify({error:{message:'invalid sk-private-very-secret header-secret'}}), {status:401});
  await assert.rejects(complete(profile(),secrets,messages,'System',undefined,fetchImpl), error => {
    assert.ok(!error.message.includes(secrets.apiKey)); assert.ok(!error.message.includes('header-secret')); assert.match(error.message,/401/); return true;
  });
});

test('aborting an in-flight call remains an AbortError', async () => {
  const controller = new AbortController();
  const pending = complete(profile(), {}, messages, 'System', controller.signal, async (_url,{signal}) => new Promise((_resolve,reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled','AbortError')))));
  controller.abort(); await assert.rejects(pending, {name:'AbortError'});
});

test('Gemini model discovery follows pagination and filters non-generative models', async () => {
  let requests=0;
  const models = await listModels(profile('gemini'),{},undefined,async url => {
    requests++;
    if (requests===1) return json({models:[{name:'models/text-a',supportedGenerationMethods:['generateContent']},{name:'models/embed',supportedGenerationMethods:['embedContent']}],nextPageToken:'page two'});
    assert.match(url,/pageToken=page%20two/); return json({models:[{name:'models/text-b',supportedGenerationMethods:['generateContent']}]});
  });
  assert.equal(requests,2); assert.deepEqual(models.map(m=>m.id),['text-a','text-b']);
});

test('Anthropic catalog pagination and Ollama tags use their native response shapes', async () => {
  let count=0;
  const models=await listModels(profile('anthropic'),{},undefined,async url => {count++; return count===1 ? json({data:[{id:'claude-a'}],has_more:true,last_id:'claude-a'}) : (assert.match(url,/after_id=claude-a/),json({data:[{id:'claude-b'}],has_more:false}));});
  assert.deepEqual(models.map(m=>m.id),['claude-a','claude-b']);
  const local=await listModels(profile('ollama'),{},undefined,async url => {assert.match(url,/\/api\/tags$/);return json({models:[{name:'local-model:latest'}]});});
  assert.equal(local[0].id,'local-model:latest');
});

test('empty catalogs report a manual model ID fallback', async () => {
  await assert.rejects(listModels(profile(),{},undefined,async()=>json({data:[]})),/manually/);
});

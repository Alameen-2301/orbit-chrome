import { PRESETS, DEFAULT_PREFERENCES, validateProfile, jsonObject, originPattern, safePageUrl, redact } from './lib/config.js';
import { complete, listModels, requestHeaders } from './lib/providers.js';
import { runAgent } from './lib/agent.js';
import { READ_TOOLS, actionTitle } from './lib/tools.js';
import { secureStorage, loadConnections, loadSecrets, saveConnection, deleteConnection } from './lib/storage.js';

const $ = id => document.getElementById(id);
const state = { profiles: [], selected: '', preferences: {...DEFAULT_PREFERENCES}, history: [], activity: [], mode: 'assist', busy: false, settingsBusy: false, activeTab: null, windowId: null, controller: null, runId: null, editId: '', review: null };
let persistQueue = Promise.resolve();

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}

function status(text, error = false, settings = false) {
  const element = $(settings ? 'settings-status' : 'status');
  element.textContent = text; element.classList.toggle('error', error);
}

function addMessage(role, content, persist = true) {
  const article = document.createElement('article'); article.className = `message ${role}`;
  const label = document.createElement('div'); label.className = 'message-label';
  label.textContent = {user: 'YOU', assistant: 'ORBIT', action: 'WORKING ON IT', error: 'COULD NOT COMPLETE', 'read-context': 'PAGE CONTEXT'}[role] || 'ORBIT';
  const body = document.createElement('div'); body.className = 'message-content'; body.textContent = content;
  article.append(label, body); $('messages').append(article); $('welcome').hidden = true;
  if (persist) {
    state.history.push({role, content}); state.history = state.history.slice(-60);
    queuePersist();
  }
  $('chat-view').scrollTop = $('chat-view').scrollHeight;
}

function queuePersist() {
  const payload = structuredClone({history: state.history, activity: state.activity, mode: state.mode});
  persistQueue = persistQueue.catch(() => {}).then(() => chrome.storage.session.set({[`conversation:${state.windowId}`]: payload}));
  persistQueue.catch(() => status('Session could not be saved. You can still continue.', true));
}

function activity(title, detail, extra, error = false) {
  state.activity.unshift({title, detail, extra, error, time: Date.now()});
  state.activity = state.activity.slice(0, 80); renderActivity(); queuePersist();
}

function renderActivity() {
  $('activity-list').replaceChildren(); $('activity-count').textContent = String(state.activity.length); $('activity-empty').hidden = !!state.activity.length;
  for (const item of state.activity) {
    const row = document.createElement('article'); row.className = `activity-item${item.error ? ' error' : ''}`;
    const dot = document.createElement('span'); dot.className = 'activity-dot'; dot.append(icon(item.error ? 'close' : 'check'));
    const content = document.createElement('div');
    const title = document.createElement('h4'); title.textContent = item.title;
    const detail = document.createElement('p'); detail.textContent = item.detail || '';
    const time = document.createElement('time'); time.dateTime = new Date(item.time).toISOString(); time.textContent = new Date(item.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    content.append(title, detail, time);
    if (item.extra) {
      const disclosure = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Details';
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(item.extra, null, 2); disclosure.append(summary, pre); content.append(disclosure);
    }
    row.append(dot, content); $('activity-list').append(row);
  }
}

function showView(view) {
  $('chat-view').hidden = view !== 'chat'; $('activity-view').hidden = view !== 'activity';
  for (const name of ['chat', 'activity']) { $(`${name}-tab`).classList.toggle('active', view === name); $(`${name}-tab`).setAttribute('aria-selected', String(view === name)); }
}

function renderConnections() {
  for (const id of ['connection-select', 'edit-profile']) {
    const select = $(id); select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = id === 'edit-profile' ? 'New connection' : 'Connect a model'; select.append(empty);
    for (const profile of state.profiles) { const option = document.createElement('option'); option.value = profile.id; option.textContent = `${profile.name} · ${profile.model}`; select.append(option); }
    select.value = id === 'connection-select' ? state.selected : state.editId;
  }
  $('connection-indicator').classList.toggle('connected', !!state.selected);
  $('connect-shortcut').textContent = state.selected ? 'Edit ↗' : 'Set up ↗';
  document.querySelector('.bring-key').classList.toggle('connected', !!state.selected);
}

async function refreshTab() {
  const tabs = await chrome.tabs.query({active: true, windowId: state.windowId});
  state.activeTab = tabs[0] || null;
  let hostname = 'Current page';
  try { hostname = new URL(state.activeTab?.url).hostname || 'Browser page'; } catch {}
  $('page-name').textContent = hostname; $('page-name').title = state.activeTab?.title || '';
  $('page-state').textContent = $('attach-page').checked ? 'Attach on send' : 'Context off';
}

async function rpc(type, data = {}) {
  const result = await chrome.runtime.sendMessage({type, ...data});
  if (!result?.ok) throw Object.assign(new Error(result?.error || 'Orbit could not contact the browser tools. Reload the extension and reopen the panel.'), {code: result?.code, origin: result?.origin});
  return result.result;
}

function review({title, description, rows = [], notice, permissionOrigin, onApprove, signal}) {
  if (signal?.aborted) return Promise.reject(new DOMException('Task stopped.', 'AbortError'));
  if (state.review) return Promise.reject(new Error('Another review is already open.'));
  $('approval-title').textContent = title; $('approval-description').textContent = description || '';
  $('approval-notice').textContent = notice || 'Review the details before continuing.';
  $('approval-details').replaceChildren();
  for (const [label, value] of rows) {
    if (value == null || value === '') continue;
    const row = document.createElement('div'); row.className = 'approval-detail'; const heading = document.createElement('strong'); heading.textContent = label;
    const content = document.createElement(typeof value === 'object' ? 'pre' : 'div'); content.textContent = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value); row.append(heading, content); $('approval-details').append(row);
  }
  $('approve-action').replaceChildren(document.createTextNode(permissionOrigin ? 'Allow access' : 'Approve once'), icon('check'));
  $('approve-action').disabled = false; $('decline-action').disabled = false;
  return new Promise((resolve, reject) => {
    function finish(accepted, error) {
      signal?.removeEventListener('abort', abort); state.review = null;
      $('approval-dialog').close(); $('approve-action').onclick = null; $('decline-action').onclick = null;
      if (error) reject(error); else resolve(accepted);
    }
    function abort() { finish(false, new DOMException('Task stopped.', 'AbortError')); }
    state.review = {cancel: () => finish(false)};
    $('approve-action').onclick = async () => {
      $('approve-action').disabled = true; $('decline-action').disabled = true;
      try {
        // This optional permission call must start directly inside this click handler.
        const accepted = permissionOrigin ? await chrome.permissions.request({origins: [permissionOrigin]}) : true;
        if (signal?.aborted || !state.review) return;
        if (!accepted) return finish(false);
        const result = onApprove ? await onApprove() : true;
        if (!state.review) return;
        finish(result);
      } catch (error) { if (state.review) finish(false, error); }
    };
    $('decline-action').onclick = () => finish(false);
    signal?.addEventListener('abort', abort, {once: true});
    $('approval-dialog').showModal();
  });
}

async function withPermission(operation, signal) {
  try { return await operation(); }
  catch (error) {
    if (error.code !== 'HOST_PERMISSION' || !error.origin) throw error;
    const provider = state.profiles.find(p => p.id === state.selected);
    const accepted = await review({title: 'Connect this website', description: 'Orbit needs site access to read or work with this page.', rows: [['Website', error.origin], ['AI endpoint', provider?.baseUrl]], notice: 'Visible page text and field values (sensitive fields excluded) may be sent to your selected AI provider for this task. Chrome will ask you to grant site access.', permissionOrigin: error.origin, signal});
    if (!accepted) throw Object.assign(new Error('Site access declined.'), {code: 'DENIED'});
    return operation();
  }
}

async function executeTool(action, context, signal) {
  if (READ_TOOLS.includes(action.tool)) return withPermission(() => rpc('READ_TOOL', {action, context}), signal);
  const prepared = await withPermission(() => rpc('PREPARE_ACTION', {action, context}), signal);
  if (signal.aborted) throw new DOMException('Task stopped.', 'AbortError');
  const {preview, token} = prepared;
  const rows = [['Tab', preview.tab ? `${preview.tab.title}\n${preview.tab.url}` : null], ['Action', action.tool], ['Destination', action.args.url], ['Target', preview.observed?.element], ['New value', action.args.value], ['Direction', action.args.direction], ['Form fields', preview.observed?.formFields?.length ? preview.observed.formFields : null], ['Page context', preview.observed?.nearbyText]];
  let result;
  try {
    result = await review({title: preview.title, description: 'Orbit is ready to take this step for you.', rows, notice: preview.notice, signal, onApprove: () => rpc('EXECUTE_APPROVED', {token})});
  } catch (error) { await rpc('DISCARD_APPROVAL', {token}).catch(() => {}); throw error; }
  if (!result) { await rpc('DISCARD_APPROVAL', {token}); throw Object.assign(new Error('Action declined.'), {code: 'DENIED'}); }
  return result;
}

function setBusy(busy) {
  state.busy = busy; $('send').hidden = busy; $('stop').hidden = !busy;
  for (const id of ['connection-select', 'open-settings', 'connect-shortcut', 'new-chat', 'mode-ask', 'mode-assist', 'attach-page']) $(id).disabled = busy;
  $('prompt').disabled = busy;
}

async function startTask(event) {
  event?.preventDefault();
  if (state.busy) return;
  const prompt = $('prompt').value.trim(); if (!prompt) return;
  const profile = state.profiles.find(p => p.id === state.selected);
  if (!profile) { await openSettings(); status('Connect a model first, then send your message.', false, true); return; }
  setBusy(true);
  let secrets;
  try { secrets = await loadSecrets(profile.id); }
  catch (error) { setBusy(false); status(error.message, true); return; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.baseUrl).hostname);
  if (!secrets.apiKey && !Object.keys(secrets.extraHeaders || {}).length && !local && profile.authMode !== 'none') {
    setBusy(false); await openSettings(); status('Add your API key. Session-only keys are cleared when Chrome restarts or the extension reloads.', true, true); return;
  }
  setBusy(true); showView('chat');
  state.controller = new AbortController(); state.runId = crypto.randomUUID();
  const {signal} = state.controller;
  const history = state.history.filter(m => ['user', 'assistant'].includes(m.role));
  addMessage('user', prompt); $('prompt').value = '';
  const context = {windowId: state.windowId, runId: state.runId, pageLimit: state.preferences.pageLimit};
  try {
    await refreshTab();
    const tabId = state.activeTab?.id;
    let initialPage;
    if ($('attach-page').checked && tabId != null) {
      try {
        safePageUrl(state.activeTab.url);
        initialPage = await executeTool({tool: 'read_page', args: {tabId}}, context, signal);
        addMessage('read-context', `Attached ${initialPage.title || new URL(initialPage.url).hostname}`);
        activity('Page attached', initialPage.url, {characters: initialPage.text.length, elements: initialPage.elements.length});
      } catch (error) {
        if (signal.aborted) throw error;
        if (error.code === 'DENIED') throw error;
        activity('Page not attached', error.message, null, true);
        addMessage('read-context', `Page context unavailable: ${error.message}`);
      }
    }
    await runAgent({prompt, history, mode: state.mode, tabId, initialPage, maxSteps: state.preferences.maxSteps, signal,
      complete: (messages, system, taskSignal) => complete(profile, secrets, messages, system, taskSignal),
      execute: (action, taskSignal) => executeTool(action, context, taskSignal),
      onEvent(event) {
        if (event.type === 'thinking') status(`Working · step ${event.step} of ${state.preferences.maxSteps}`);
        if (event.type === 'answer') addMessage('assistant', event.text);
        if (event.type === 'action') { addMessage('action', event.text || actionTitle(event.action)); status(actionTitle(event.action)); }
        if (event.type === 'result') {
          const {result, action} = event;
          const detail = result.error || result.url || result.note || result.performed || (result.tabs ? `${result.tabs.length} tabs` : 'Completed');
          const extra = READ_TOOLS.includes(action.tool) ? {tabId: action.args.tabId, textCharacters: result.text?.length, elements: result.elements?.length} : {action, result};
          activity(actionTitle(action), detail, extra, !!result.error);
        }
      },
    });
    status('Ready when you are.');
  } catch (error) {
    const message = signal.aborted ? 'Task stopped. Any actions already completed remain in place.' : error.code === 'DENIED' ? 'Site access declined. This task has stopped.' : redact(error.message, secrets);
    addMessage(signal.aborted || error.code === 'DENIED' ? 'assistant' : 'error', message); status(signal.aborted ? 'Stopped.' : 'Task paused. Check the message above.', !signal.aborted);
    activity(signal.aborted ? 'Task stopped' : 'Task paused', message, null, !signal.aborted);
  } finally {
    await rpc('CANCEL_RUN', {runId: state.runId}).catch(() => {});
    setBusy(false); state.controller = null; state.runId = null; await refreshTab(); $('prompt').focus();
  }
}

async function editProfile(id = '') {
  state.editId = id;
  const profile = state.profiles.find(p => p.id === id);
  const preset = PRESETS.find(p => p.id === (profile?.preset || 'openai')) || PRESETS[0];
  const secrets = profile ? await loadSecrets(profile.id) : {apiKey: '', extraHeaders: {}};
  $('edit-profile').value = id; $('provider').value = preset.id;
  $('protocol').value = profile?.protocol || preset.protocol; $('base-url').value = profile?.baseUrl ?? preset.baseUrl;
  $('api-key').value = secrets.apiKey; $('api-key').type = 'password'; $('toggle-key').textContent = 'Show';
  $('remember-key').checked = profile?.remember || false;
  $('model').value = profile?.model || ''; $('profile-name').value = profile?.name || '';
  $('request-path').value = profile?.requestPath || ''; $('auth-mode').value = profile?.authMode || 'auto';
  $('extra-headers').value = Object.keys(secrets.extraHeaders || {}).length ? JSON.stringify(secrets.extraHeaders, null, 2) : '';
  $('extra-body').value = Object.keys(profile?.extraBody || {}).length ? JSON.stringify(profile.extraBody, null, 2) : '';
  $('max-steps').value = state.preferences.maxSteps; $('page-limit').value = state.preferences.pageLimit;
  $('forget-profile').hidden = !id; $('model-catalog').replaceChildren(); $('catalog-note').textContent = 'Load the provider’s catalog, or enter a model ID.';
  status('', false, true);
}

async function openSettings() {
  if (state.busy) return;
  await editProfile(state.selected); renderConnections(); $('settings-dialog').showModal();
}

function formProfile(requireModel = true) {
  const provider = PRESETS.find(p => p.id === $('provider').value);
  const profile = validateProfile({id: state.editId || undefined, preset: provider.id, name: $('profile-name').value || provider.name,
    protocol: $('protocol').value, baseUrl: $('base-url').value, model: $('model').value, remember: $('remember-key').checked,
    requestPath: $('request-path').value, authMode: $('auth-mode').value, extraBody: $('extra-body').value}, requireModel);
  const secrets = {apiKey: $('api-key').value.trim(), extraHeaders: jsonObject($('extra-headers').value, 'Custom headers')};
  requestHeaders(profile, secrets);
  return {profile, secrets};
}

function preferencesFromForm() {
  const maxSteps = Number($('max-steps').value), pageLimit = Number($('page-limit').value);
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 30) throw new Error('The step limit must be between 1 and 30.');
  if (!Number.isInteger(pageLimit) || pageLimit < 1000 || pageLimit > 40000) throw new Error('The page text limit must be between 1,000 and 40,000.');
  return {maxSteps, pageLimit};
}

async function settingsAction(kind, event) {
  event?.preventDefault();
  if (state.settingsBusy) return;
  const button = $(kind === 'save' ? 'save-profile' : kind === 'discover' ? 'discover-models' : 'test-connection');
  let secrets;
  try {
    const input = formProfile(kind !== 'discover'); const {profile} = input; secrets = input.secrets;
    const preferences = preferencesFromForm();
    // Start native permission request in the original user gesture, before other awaits.
    const permission = chrome.permissions.request({origins: [originPattern(profile.baseUrl)]});
    state.settingsBusy = true;
    for (const id of ['save-profile', 'discover-models', 'test-connection', 'provider', 'edit-profile', 'add-profile', 'forget-profile']) $(id).disabled = true;
    button.disabled = true; status('Connecting…', false, true);
    if (!await permission) throw new Error('API host access was declined. This connection was not used.');
    if (kind === 'save') {
      state.profiles = await saveConnection(profile, secrets, state.profiles, preferences); state.selected = profile.id; state.preferences = preferences;
      state.editId = profile.id; renderConnections(); $('settings-dialog').close(); status(`Connected to ${profile.name}.`);
    } else if (kind === 'discover') {
      const models = await listModels(profile, secrets);
      $('model-catalog').replaceChildren();
      for (const model of models) { const option = document.createElement('option'); option.value = model.id; option.label = model.name; $('model-catalog').append(option); }
      $('catalog-note').textContent = `${models.length} models loaded. Choose a text/chat model; catalogs can also include other model types.`;
      status('Models loaded. Select one in the Model ID field.', false, true); $('model').focus();
    } else {
      await complete(profile, secrets, [{role: 'user', content: 'Reply with the word connected.'}], 'This is a connection test. Reply briefly.');
      status('Connection works. Save it to start using Orbit.', false, true);
    }
  } catch (error) { status(redact(error.message, secrets), true, true); }
  finally {
    state.settingsBusy = false;
    for (const id of ['save-profile', 'discover-models', 'test-connection', 'provider', 'edit-profile', 'add-profile', 'forget-profile']) $(id).disabled = false;
    button.disabled = false;
  }
}

async function clearConversation() {
  if (state.busy) return;
  state.history = []; state.activity = []; $('messages').replaceChildren(); $('welcome').hidden = false;
  renderActivity(); queuePersist(); showView('chat'); status('A fresh start.');
}

async function initialize() {
  await secureStorage();
  state.windowId = (await chrome.windows.getCurrent()).id;
  const connections = await loadConnections(); Object.assign(state, {profiles: connections.profiles, selected: connections.selected, preferences: {...DEFAULT_PREFERENCES, ...connections.preferences}});
  const key = `conversation:${state.windowId}`; const session = (await chrome.storage.session.get(key))[key];
  if (session) { state.history = session.history || []; state.activity = session.activity || []; state.mode = session.mode || 'assist'; }
  for (const message of state.history) addMessage(message.role, message.content, false);
  for (const preset of PRESETS) { const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.name; $('provider').append(option); }
  renderConnections(); renderActivity(); setMode(state.mode); await refreshTab();
  await rpc('PING');
}

function setMode(mode) {
  state.mode = mode;
  for (const name of ['ask', 'assist']) { $(`mode-${name}`).classList.toggle('active', name === mode); $(`mode-${name}`).setAttribute('aria-pressed', String(name === mode)); }
  $('prompt').placeholder = mode === 'ask' ? 'Ask about this page or anything else…' : 'What can I help you do?';
}

$('composer').addEventListener('submit', startTask);
$('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); startTask(); } });
$('stop').onclick = () => { state.controller?.abort(); if (state.runId) rpc('CANCEL_RUN', {runId: state.runId}).catch(() => {}); };
for (const id of ['open-settings', 'connect-shortcut', 'welcome-connect']) $(id).onclick = openSettings;
$('close-settings').onclick = () => $('settings-dialog').close();
$('new-chat').onclick = clearConversation;
document.querySelector('.brand').onclick = event => { event.preventDefault(); showView('chat'); };
$('chat-tab').onclick = () => showView('chat'); $('activity-tab').onclick = () => showView('activity');
for (const mode of ['ask', 'assist']) $(`mode-${mode}`).onclick = () => { setMode(mode); queuePersist(); };
$('attach-page').onchange = refreshTab;
$('connection-select').onchange = async event => { if (!event.target.value) { await openSettings(); renderConnections(); return; } state.selected = event.target.value; await chrome.storage.local.set({'orbit-selected': state.selected}); renderConnections(); };
$('edit-profile').onchange = event => editProfile(event.target.value);
$('add-profile').onclick = () => editProfile('');
$('provider').onchange = () => { const preset = PRESETS.find(p => p.id === $('provider').value); $('protocol').value = preset.protocol; $('base-url').value = preset.baseUrl; $('model').value = ''; $('api-key').value = ''; $('extra-headers').value = ''; $('extra-body').value = ''; $('request-path').value = ''; $('auth-mode').value = 'auto'; $('profile-name').value = ''; $('model-catalog').replaceChildren(); $('catalog-note').textContent = 'Load the provider’s catalog, or enter a model ID.'; };
$('toggle-key').onclick = () => { const hide = $('api-key').type === 'password'; $('api-key').type = hide ? 'text' : 'password'; $('toggle-key').textContent = hide ? 'Hide' : 'Show'; };
$('settings-form').onsubmit = event => settingsAction('save', event);
$('discover-models').onclick = event => settingsAction('discover', event);
$('test-connection').onclick = event => settingsAction('test', event);
$('forget-profile').onclick = async () => { if (!state.editId) return; state.profiles = await deleteConnection(state.editId, state.profiles); state.selected = state.profiles[0]?.id || ''; await editProfile(state.selected); renderConnections(); status('Connection deleted.', false, true); };
$('clear-session').onclick = async () => { await clearConversation(); status('Chat and activity cleared.', false, true); };
$('approval-dialog').addEventListener('cancel', event => { event.preventDefault(); state.review?.cancel(); });
chrome.tabs.onActivated.addListener(() => refreshTab().catch(() => {}));
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.title) refreshTab().catch(() => {}); });
window.addEventListener('pagehide', () => { state.controller?.abort(); if (state.runId) chrome.runtime.sendMessage({type: 'CANCEL_RUN', runId: state.runId}).catch(() => {}); });
initialize().catch(error => { status(error.message, true); $('send').disabled = true; });

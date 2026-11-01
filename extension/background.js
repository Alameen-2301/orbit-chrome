import { originPattern, safePageUrl } from './lib/config.js';
import { READ_TOOLS, WRITE_TOOLS, validateAction, actionTitle } from './lib/tools.js';

const pendingPrefix = 'approval:';
const claimed = new Set();
const cancelled = new Set();
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
  chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
]);
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});

function panelSender(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('sidepanel.html');
}

function fail(message, code, extra = {}) { return Object.assign(new Error(message), {code, ...extra}); }

async function scopedTab(tabId, windowId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId !== windowId) throw new Error('This tab belongs to another window. Open Orbit in that window to work there.');
  safePageUrl(tab.url);
  return tab;
}

async function page(tabId, windowId, command, extra = {}) {
  const tab = await scopedTab(tabId, windowId);
  const origin = originPattern(tab.url);
  if (!await chrome.permissions.contains({origins: [origin]})) throw fail(`Site access is needed for ${new URL(tab.url).hostname}.`, 'HOST_PERMISSION', {origin});
  await chrome.scripting.executeScript({target: {tabId}, files: ['content.js']});
  const response = await chrome.tabs.sendMessage(tabId, {channel: 'orbit-page', command, ...extra}, {frameId: 0});
  if (!response?.ok) throw new Error(response?.error || 'The page did not respond. Refresh it and try again.');
  return response.result;
}

async function read(action, context) {
  if (action.tool === 'list_tabs') {
    const tabs = await chrome.tabs.query({windowId: context.windowId});
    return {tabs: tabs.slice(0, 120).map(t => ({tabId: t.id, title: t.title, url: t.url, active: t.active})), truncated: tabs.length > 120};
  }
  return page(action.args.tabId, context.windowId, action.tool === 'read_page' ? 'read' : 'selection', {limit: context.pageLimit});
}

async function prepare(action, context, sender) {
  let tab, observed;
  if (action.tool !== 'open_tab') tab = await scopedTab(action.args.tabId, context.windowId);
  if (['click', 'fill', 'select', 'scroll'].includes(action.tool)) observed = await page(tab.id, context.windowId, 'inspect', {target: action.args.target});
  if (['fill', 'select'].includes(action.tool) && observed.element.sensitive) throw new Error('Sensitive fields must be handled manually.');
  const token = crypto.randomUUID();
  const preview = {
    title: actionTitle(action), action, tab: tab ? {tabId: tab.id, title: tab.title, url: tab.url} : null,
    observed: observed || null,
    notice: action.tool === 'click' ? 'A click may send, submit, purchase, or delete. Review the page, target, and form values before approving.' : 'Review this exact action. It will run once after you approve.',
  };
  if (cancelled.has(context.runId)) throw fail('Task stopped.', 'CANCELLED');
  const entry = {action, context, observed, preview, senderDocument: sender.documentId, senderUrl: sender.url, url: tab?.url, expires: Date.now() + 120000};
  await chrome.storage.session.set({[pendingPrefix + token]: entry});
  // A cancellation may have arrived while storage was being written.
  if (cancelled.has(context.runId)) { await chrome.storage.session.remove(pendingPrefix + token); throw fail('Task stopped.', 'CANCELLED'); }
  return {token, preview};
}

async function waitForTab(tabId) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function executeApproved(token, sender) {
  if (typeof token !== 'string' || claimed.has(token)) throw new Error('This approval has already been used.');
  claimed.add(token);
  try {
    const key = pendingPrefix + token;
    const entry = (await chrome.storage.session.get(key))[key];
    await chrome.storage.session.remove(key); // Consume BEFORE running any effect.
    if (!entry || entry.expires < Date.now()) throw new Error('This approval expired. Request a new preview.');
    if (entry.senderDocument !== sender.documentId || entry.senderUrl !== sender.url) throw new Error('This approval belongs to a different panel.');
    const {action, context, observed} = entry;
    if (cancelled.has(context.runId)) throw fail('Task stopped.', 'CANCELLED');
    let tab;
    if (action.tool !== 'open_tab') {
      tab = await scopedTab(action.args.tabId, context.windowId);
      if (tab.url !== entry.url) throw new Error('The tab navigated after the preview. Request a new approval.');
    }
    if (action.tool === 'open_tab') {
      const created = await chrome.tabs.create({url: action.args.url, active: true, windowId: context.windowId});
      await waitForTab(created.id);
      return {performed: 'opened', tabId: created.id, url: created.url};
    }
    if (action.tool === 'navigate') {
      await chrome.tabs.update(tab.id, {url: action.args.url});
      await waitForTab(tab.id);
      return {performed: 'navigated', tabId: tab.id, url: (await chrome.tabs.get(tab.id)).url};
    }
    if (action.tool === 'switch_tab') { await chrome.tabs.update(tab.id, {active: true}); return {performed: 'switched', tabId: tab.id}; }
    if (action.tool === 'close_tab') { await chrome.tabs.remove(tab.id); return {performed: 'closed', tabId: tab.id}; }
    return page(tab.id, context.windowId, 'perform', {action, expected: observed});
  } finally {
    // Keep a bounded used-token guard in memory; absent tokens are rejected in storage too.
    if (claimed.size > 500) claimed.delete(claimed.values().next().value);
  }
}

async function handle(message, sender) {
  await ready;
  if (!panelSender(sender)) throw new Error('Only the Orbit side panel can request browser tools.');
  if (message.type === 'PING') return {version: chrome.runtime.getManifest().version};
  if (message.type === 'EXECUTE_APPROVED') return executeApproved(message.token, sender);
  if (message.type === 'DISCARD_APPROVAL') { await chrome.storage.session.remove(pendingPrefix + message.token); return {}; }
  if (message.type === 'CANCEL_RUN') {
    cancelled.add(message.runId);
    if (cancelled.size > 500) cancelled.delete(cancelled.values().next().value);
    const entries = await chrome.storage.session.get(null);
    const remove = Object.entries(entries).filter(([key, value]) => key.startsWith(pendingPrefix) && (value.expires < Date.now() || value.context.runId === message.runId)).map(([key]) => key);
    await chrome.storage.session.remove(remove);
    return {};
  }
  const context = message.context;
  if (!context || !Number.isInteger(context.windowId) || typeof context.runId !== 'string') throw new Error('Invalid browser context.');
  const action = validateAction(message.action);
  if (cancelled.has(context.runId)) throw fail('Task stopped.', 'CANCELLED');
  if (message.type === 'READ_TOOL' && READ_TOOLS.includes(action.tool)) return read(action, context);
  if (message.type === 'PREPARE_ACTION' && WRITE_TOOLS.includes(action.tool)) return prepare(action, context, sender);
  throw new Error('Unknown or unapproved browser operation.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(result => sendResponse({ok: true, result}), error => sendResponse({ok: false, error: error.message, code: error.code, origin: error.origin}));
  return true;
});

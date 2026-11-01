import { safePageUrl } from './config.js';

export const READ_TOOLS = ['read_page', 'read_selection', 'list_tabs'];
export const WRITE_TOOLS = ['open_tab', 'navigate', 'switch_tab', 'close_tab', 'click', 'fill', 'select', 'scroll'];
export const TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

export function validateAction(action, defaultTabId) {
  if (!action || typeof action !== 'object' || !TOOLS.includes(action.tool)) throw new Error('The model requested an unknown browser tool.');
  const input = action.args ?? {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Tool arguments must be an object.');
  const args = {};
  if (!['list_tabs', 'open_tab'].includes(action.tool)) {
    args.tabId = input.tabId ?? defaultTabId;
    if (!Number.isSafeInteger(args.tabId) || args.tabId < 0) throw new Error('A valid tab ID is required.');
  }
  if (['open_tab', 'navigate'].includes(action.tool)) args.url = safePageUrl(input.url);
  if (['click', 'fill', 'select'].includes(action.tool)) {
    if (typeof input.target !== 'string' || !/^[a-f0-9-]+:\d+$/.test(input.target)) throw new Error('Use an exact target ID from a fresh page snapshot.');
    args.target = input.target;
  }
  if (['fill', 'select'].includes(action.tool)) {
    if (typeof input.value !== 'string' || input.value.length > 20000) throw new Error('Field text must be a string under 20,000 characters.');
    args.value = input.value;
  }
  if (action.tool === 'scroll') {
    if (!['up', 'down', 'top', 'bottom'].includes(input.direction)) throw new Error('Scroll direction must be up, down, top, or bottom.');
    args.direction = input.direction;
  }
  return {tool: action.tool, args};
}

export function actionTitle(action) {
  const titles = { read_page: 'Read page', read_selection: 'Read selected text', list_tabs: 'List open tabs', open_tab: 'Open a tab', navigate: 'Navigate this tab', switch_tab: 'Switch tabs', close_tab: 'Close a tab', click: 'Click an element', fill: 'Write into a field', select: 'Choose an option', scroll: 'Scroll the page' };
  return titles[action.tool] || action.tool;
}

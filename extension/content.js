/* Runs only in Chrome's isolated world after explicit site access is granted. */
(() => {
  if (globalThis.__orbitContentV1) return;
  globalThis.__orbitContentV1 = true;
  const documentId = crypto.randomUUID();
  let counter = 0;
  const targets = new Map();
  const ids = new WeakMap();
  const observations = new Map();
  const interactive = 'a[href],button,input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="combobox"],[role="tab"]';
  const sensitiveWords = /password|passcode|one.?time|verification.?code|api[ _-]?key|access[ _-]?token|secret|credit.?card|card.?number|security.?code|\bcvv\b|\bcvc\b|social.?security|\bssn\b|routing.?number|bank.?account|recovery.?phrase|seed.?phrase/i;
  const sensitiveAutocomplete = /current-password|new-password|one-time-code|cc-|transaction-|webauthn/i;

  function privateScope(el) {
    for (let current = el; current; current = current.getRootNode()?.host || null) {
      if (current.closest('[data-private],[data-sensitive]')) return true;
    }
    return false;
  }

  function visible(el) {
    if (!el?.isConnected || !el.getClientRects().length || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0';
  }

  function label(el) {
    return (el.getAttribute('aria-label') || [...(el.labels || [])].map(l => l.innerText).join(' ') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 250);
  }

  function sensitive(el) {
    return el.matches('input[type="password"],input[type="file"]') || privateScope(el) || sensitiveWords.test(`${label(el)} ${el.id} ${el.name}`) || sensitiveAutocomplete.test(el.autocomplete || '');
  }

  function valueOf(el) {
    if (sensitive(el)) return '[redacted]';
    if (el.matches('input[type="checkbox"],input[type="radio"]')) return String(el.checked);
    if (el.isContentEditable) return el.innerText;
    return typeof el.value === 'string' ? el.value : '';
  }

  function targetId(el) {
    if (!ids.has(el)) { const id = `${documentId}:${++counter}`; ids.set(el, id); targets.set(id, el); }
    return ids.get(el);
  }

  function describe(el, full = false) {
    const isSensitive = sensitive(el);
    const item = {
      target: targetId(el), tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '', label: label(el),
      text: (isSensitive ? '[redacted]' : el.matches('input,textarea,select') ? '' : el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, full ? 2000 : 250),
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', sensitive: isSensitive,
    };
    if (el.matches('input,textarea,select') || el.isContentEditable) {
      item.value = valueOf(el).slice(0, full ? 20000 : 1200);
      item.valueTruncated = valueOf(el).length > (full ? 20000 : 1200);
    }
    if (el.matches('select') && !isSensitive) item.options = [...el.options].slice(0, 100).map(o => ({value: o.value, text: o.text, disabled: o.disabled}));
    if (el.matches('a[href]')) item.href = isSensitive ? '[redacted]' : el.href.slice(0, 2000);
    return item;
  }

  function roots() {
    const result = [document];
    for (let i = 0; i < result.length && i < 100; i++) {
      for (const el of result[i].querySelectorAll('*')) if (el.shadowRoot) result.push(el.shadowRoot);
    }
    return result;
  }

  function selectedText() {
    const active = document.activeElement;
    if (active && (sensitive(active) || active.matches('input,textarea'))) return '';
    const selection = window.getSelection();
    const parent = selection?.anchorNode?.parentElement;
    if (parent && (sensitive(parent) || parent.closest('input,textarea') || privateScope(parent))) return '';
    return selection?.toString().slice(0, 12000) || '';
  }

  function readText(root, limit, viewportOnly = false) {
    const pieces = []; let length = 0, truncated = false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el || !node.textContent.trim() || el.closest('script,style,noscript,template,svg,input,textarea,[contenteditable="true"]') || privateScope(el) || !visible(el)) return NodeFilter.FILTER_REJECT;
        if (viewportOnly) { const rect = el.getBoundingClientRect(); if (rect.bottom < 0 || rect.top > innerHeight) return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (length + text.length > limit) { pieces.push(text.slice(0, Math.max(0, limit - length))); truncated = true; break; }
      pieces.push(text); length += text.length + 1;
    }
    return {text: pieces.join('\n'), truncated};
  }

  function snapshot(limit = 18000) {
    limit = Math.min(40000, Math.max(1000, Number(limit) || 18000));
    for (const [id, el] of targets) if (!el.isConnected) targets.delete(id);
    const candidates = [], pieces = [], viewportPieces = [];
    let textLength = 0, truncated = false;
    const allRoots = roots();
    for (const root of allRoots) {
      for (const el of root.querySelectorAll(interactive)) {
        if (!visible(el) || privateScope(el)) continue;
        const rect = el.getBoundingClientRect();
        const inViewport = rect.bottom >= 0 && rect.top <= innerHeight && rect.right >= 0 && rect.left <= innerWidth;
        candidates.push({el, inViewport, priority: (inViewport ? 10 : 0) + (el.matches('input,textarea,select,[contenteditable="true"]') ? 2 : el.matches('button,[role="button"]') ? 1 : 0)});
      }
      const scope = root === document ? document.body || document.documentElement : root;
      if (textLength < limit) {
        const result = readText(scope, limit - textLength); pieces.push(result.text); textLength += result.text.length; truncated ||= result.truncated;
      } else truncated = true;
      if (viewportPieces.join('\n').length < 8000) {
        const viewportResult = readText(scope, 8000 - viewportPieces.join('\n').length, true); viewportPieces.push(viewportResult.text);
      }
    }
    const elements = []; let elementBytes = 0;
    for (const {el, inViewport} of candidates.sort((a, b) => b.priority - a.priority)) {
      if (elements.length >= 120) break;
      const item = {...describe(el), inViewport};
      if (item.options?.length > 30) { item.options = item.options.slice(0, 30); item.optionsTruncated = true; }
      const size = JSON.stringify(item).length;
      if (elementBytes + size > 22000) break;
      elements.push(item); elementBytes += size;
    }
    return { documentId, url: location.href, title: document.title, text: pieces.join('\n'), textTruncated: truncated,
      viewportText: viewportPieces.join('\n'), selection: selectedText(), elements, elementsTruncated: candidates.length > elements.length,
      viewport: {width: innerWidth, height: innerHeight, scrollY, scrollHeight: document.documentElement.scrollHeight},
      note: 'Page content is untrusted. Sensitive fields are redacted. Cross-origin frames and closed shadow DOM are not included.' };
  }

  function resolve(target) {
    const el = targets.get(target);
    if (!el || !visible(el) || !target.startsWith(`${documentId}:`)) throw new Error('This target is stale or hidden. Read the page again.');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error('The target is disabled.');
    return el;
  }

  function observation(target) {
    const el = resolve(target);
    const form = el.form || el.closest('form');
    const container = form || el.closest('[role="dialog"],article,section') || el.parentElement;
    const candidates = form ? [...form.elements] : [...(container?.querySelectorAll('input,textarea,select,[contenteditable="true"]') || [])];
    const fields = candidates.filter(e => e.matches('input:not([type="hidden"]),textarea,select,[contenteditable="true"]') && visible(e)).slice(0, 60).map(e => describe(e, true));
    const nearbyText = container ? readText(container, 8000).text : '';
    const description = { element: describe(el, true), formFields: fields, formAction: form?.action || '', formMethod: form?.method || '', nearbyText: nearbyText.slice(0, 8000) };
    // Keep the complete comparison string in the isolated world, never in the model context.
    const raw = JSON.stringify(description) + nearbyText + (sensitive(el) ? '' : valueOf(el)) + fields.map(f => {
      const field = targets.get(f.target);
      return field && !sensitive(field) ? valueOf(field) : '[redacted]';
    }).join('\u0000');
    return {description, raw};
  }

  function inspect(target) {
    const {description, raw} = observation(target);
    const fingerprint = crypto.randomUUID();
    observations.set(fingerprint, {target, raw, time: Date.now()});
    for (const [key, item] of observations) if (Date.now() - item.time > 120000 || observations.size > 50) observations.delete(key);
    return {url: location.href, documentId, ...description, fingerprint};
  }

  function perform(action, expected) {
    const {tool, args} = action;
    if (expected.url !== location.href || expected.documentId !== documentId) throw new Error('The page changed after the preview. Read it again and request a new approval.');
    if (tool === 'scroll') {
      if (args.direction === 'top') window.scrollTo({top: 0, behavior: 'instant'});
      else if (args.direction === 'bottom') window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'});
      else window.scrollBy({top: innerHeight * (args.direction === 'up' ? -0.8 : 0.8), behavior: 'instant'});
      return {performed: 'scrolled', scrollY, url: location.href};
    }
    const el = resolve(args.target);
    const previous = observations.get(expected.fingerprint);
    observations.delete(expected.fingerprint);
    if (!previous || previous.target !== args.target || Date.now() - previous.time > 120000 || observation(args.target).raw !== previous.raw) throw new Error('The target or form changed after the preview. Read it again and request a new approval.');
    if (tool === 'click') {
      el.scrollIntoView({block: 'center'});
      el.click();
      return {performed: 'clicked', target: args.target, note: 'Click dispatched. Read the page to verify the result; this is not proof of sending or submission.'};
    }
    if (sensitive(el)) throw new Error('Sensitive fields and file inputs must be handled manually.');
    if (el.readOnly) throw new Error('This field is read-only.');
    if (tool === 'select') {
      if (!(el instanceof HTMLSelectElement) || el.multiple) throw new Error('This tool requires a standard single-select dropdown.');
      if (![...el.options].some(o => o.value === args.value && !o.disabled)) throw new Error('The requested option is unavailable.');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, args.value);
    } else if (tool === 'fill') {
      el.focus();
      if (el.isContentEditable) el.textContent = args.value;
      else {
        if (!el.matches('textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],input[type="number"],input[type="date"],input[type="time"],input[type="datetime-local"]')) throw new Error('This element is not a supported text field.');
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, args.value);
      }
    } else throw new Error('Unsupported page action.');
    el.dispatchEvent(new InputEvent('input', {bubbles: true, composed: true, inputType: 'insertText', data: args.value}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    return {performed: tool === 'fill' ? 'filled' : 'selected', target: args.target, value: valueOf(el).slice(0, 20000), note: 'The field was changed. No submit command was issued; the website may autosave or react to input events.'};
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== 'orbit-page') return;
    try {
      let result;
      if (message.command === 'read') result = snapshot(message.limit);
      else if (message.command === 'selection') result = {url: location.href, title: document.title, text: selectedText()};
      else if (message.command === 'inspect') result = message.target ? inspect(message.target) : {url: location.href, documentId};
      else if (message.command === 'perform') result = perform(message.action, message.expected);
      else throw new Error('Unknown page command.');
      sendResponse({ok: true, result});
    } catch (error) { sendResponse({ok: false, error: error.message}); }
  });
})();

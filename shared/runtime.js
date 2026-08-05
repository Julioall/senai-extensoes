(() => {
  'use strict';

  if (globalThis.SenaiExt) return;

  const SETTINGS_KEY = 'senaiExtensionsSettings';
  const DEFAULTS = Object.freeze({
    modules: {
      moodle: true,
      drivePdf: true,
      kahoot: true
    },
    moodle: {
      importer: true,
      gradeReports: true,
      coursePendingChecks: true,
      categoryPendingChecks: true,
      pendingBadges: true,
      pendingDownloads: true,
      overwriteGrades: true,
      overwriteFeedback: true,
      flexibleNames: true
    },
    drivePdf: {
      includeBackground: true,
      compactMargins: false
    },
    kahoot: {
      replaceCurrent: true,
      validateBeforeRun: true,
      delayMs: 900
    }
  });

  const isPlainObject = value => value && typeof value === 'object' && !Array.isArray(value);

  function mergeDeep(base, patch) {
    const result = typeof structuredClone === 'function' ? structuredClone(base) : JSON.parse(JSON.stringify(base));
    Object.entries(patch || {}).forEach(([key, value]) => {
      if (isPlainObject(value) && isPlainObject(result[key])) result[key] = mergeDeep(result[key], value);
      else result[key] = value;
    });
    return result;
  }

  function storageGet(defaultValue) {
    return new Promise(resolve => {
      if (!globalThis.chrome?.storage?.local) {
        resolve(defaultValue);
        return;
      }
      chrome.storage.local.get({ [SETTINGS_KEY]: defaultValue }, values => {
        resolve(values[SETTINGS_KEY] || defaultValue);
      });
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      if (!globalThis.chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set({ [SETTINGS_KEY]: value }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async function getSettings() {
    return mergeDeep(DEFAULTS, await storageGet(DEFAULTS));
  }

  async function updateSettings(patch) {
    const next = mergeDeep(await getSettings(), patch);
    await storageSet(next);
    return next;
  }

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function visibleText(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll(
      '.sr-only,.visually-hidden,.accesshide,[aria-hidden="true"],img,svg,i,.userinitials,[data-region="favourite-icon"]'
    ).forEach(node => node.remove());
    return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function detectDelimiter(text) {
    const first = String(text || '').split(/\r?\n/).find(line => line.trim()) || '';
    const candidates = [';', '\t', ','];
    return candidates
      .map(delimiter => ({ delimiter, count: first.split(delimiter).length }))
      .sort((a, b) => b.count - a.count)[0].delimiter;
  }

  function parseDelimited(text, delimiter = detectDelimiter(text)) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (char === '"' && quoted && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        row.push(field.trim());
        field = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(field.trim());
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }

    row.push(field.trim());
    if (row.some(cell => cell !== '')) rows.push(row);
    return rows;
  }

  function similarity(left, right) {
    const a = new Set(normalizeText(left).split(' ').filter(Boolean));
    const b = new Set(normalizeText(right).split(' ').filter(Boolean));
    if (!a.size || !b.size) return 0;
    const intersection = [...a].filter(token => b.has(token)).length;
    return (2 * intersection) / (a.size + b.size);
  }

  function setNativeValue(element, value) {
    if (!element) return;
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
    ['input', 'change', 'blur'].forEach(type => element.dispatchEvent(new Event(type, { bubbles: true })));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  globalThis.SenaiExt = Object.freeze({
    SETTINGS_KEY,
    DEFAULTS,
    mergeDeep,
    getSettings,
    updateSettings,
    normalizeText,
    visibleText,
    escapeHtml,
    escapeXml,
    parseDelimited,
    detectDelimiter,
    similarity,
    setNativeValue,
    downloadBlob,
    sleep
  });
})();

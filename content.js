(function startContentScript() {
  'use strict';

  const ext = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  const rawReplaceState = history.replaceState;
  let lastSeenUrl = location.href;
  const SOURCE = 'clean-trail-extension-v1';

  async function readSettings() {
    const stored = await ext.storage.local.get(UrlCleaner.STORAGE_KEY);
    return UrlCleaner.normalizeSettings(stored && stored[UrlCleaner.STORAGE_KEY]);
  }

  function replaceUrl(url) {
    if (url === location.href) return false;
    rawReplaceState.call(history, history.state, document.title, url);
    lastSeenUrl = location.href;
    return true;
  }

  async function cleanCurrentUrl() {
    const currentUrl = location.href;
    const settings = await readSettings();
    const result = UrlCleaner.cleanUrl(currentUrl, settings);
    lastSeenUrl = currentUrl;
    if (!result.changed) return;
    if (replaceUrl(result.cleaned)) {
      ext.runtime.sendMessage({
        type: 'pageCleaned',
        removed: result.removed.map((item) => item.name),
        url: result.cleaned
      }).catch(() => {});
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== SOURCE) return;
    if (event.data.type === 'request-clean') {
      readSettings().then((settings) => {
        const result = UrlCleaner.cleanUrl(String(event.data.url || ''), settings);
        window.postMessage({
          source: SOURCE,
          type: 'apply-cleaned',
          requestId: event.data.requestId,
          url: String(event.data.url || ''),
          cleaned: result.cleaned,
          removed: result.removed.map((item) => item.name)
        }, '*');
      }).catch(() => {});
    }
    if (event.data.type === 'cleaned' && event.data.changed) {
      ext.runtime.sendMessage({
        type: 'pageCleaned',
        removed: Array.isArray(event.data.removed) ? event.data.removed : [],
        url: location.href
      }).catch(() => {});
    }
  });

  if (ext.storage && ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[UrlCleaner.STORAGE_KEY]) cleanCurrentUrl().catch(() => {});
    });
  }

  async function writeClipboard(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    }
  }

  function showToast(message) {
    const oldToast = document.querySelector('[data-clean-trail-toast]');
    if (oldToast) oldToast.remove();
    const toast = document.createElement('div');
    toast.dataset.cleanTrailToast = 'true';
    toast.textContent = String(message || '');
    Object.assign(toast.style, {
      position: 'fixed',
      zIndex: '2147483647',
      right: '20px',
      bottom: '20px',
      maxWidth: 'min(420px, calc(100vw - 40px))',
      padding: '11px 15px',
      borderRadius: '12px',
      background: '#102a43',
      color: '#f0f9ff',
      boxShadow: '0 12px 30px rgba(15, 23, 42, .24)',
      font: '600 13px/1.4 system-ui, sans-serif'
    });
    (document.body || document.documentElement).appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  ext.runtime.onMessage.addListener(async (message) => {
    if (!message || !message.type) return undefined;
    if (message.type === 'copyText') {
      try {
        const ok = await writeClipboard(String(message.text || ''));
        return { ok };
      } catch (error) {
        return { ok: false, error: 'clipboard_denied' };
      }
    }
    if (message.type === 'applyCleanedUrl') {
      try {
        const requested = new URL(String(message.url || ''), location.href);
        if (!['http:', 'https:'].includes(requested.protocol)) return { ok: false };
        replaceUrl(requested.href);
        return { ok: true, url: location.href };
      } catch (error) {
        return { ok: false };
      }
    }
    if (message.type === 'toast') {
      showToast(message.message);
      return { ok: true };
    }
    return undefined;
  });

  cleanCurrentUrl().catch(() => {});
}());

importScripts('shared/cleaner.js');

(function startBackground() {
  'use strict';

  const ext = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  const action = ext.action || ext.browserAction;
  const MENU_ID = 'copy-clean-url';
  const ALARM_NAME = 'sync-subscriptions';
  const SYNC_PERIOD_MINUTES = 360;
  const MAX_SUBSCRIPTION_BYTES = 512 * 1024;
  const MAX_SUBSCRIPTION_RULES = 2000;

  function safeCall(task, fallback) {
    return Promise.resolve().then(task).catch(() => fallback);
  }

  async function readSettings() {
    const stored = await ext.storage.local.get(UrlCleaner.STORAGE_KEY);
    return UrlCleaner.normalizeSettings(stored && stored[UrlCleaner.STORAGE_KEY]);
  }

  async function writeSettings(settings) {
    const normalized = UrlCleaner.normalizeSettings(settings);
    await ext.storage.local.set({ [UrlCleaner.STORAGE_KEY]: normalized });
    return normalized;
  }

  async function ensureSettings() {
    const stored = await ext.storage.local.get(UrlCleaner.STORAGE_KEY);
    if (!stored || !stored[UrlCleaner.STORAGE_KEY]) {
      return writeSettings(UrlCleaner.defaultSettings());
    }
    return UrlCleaner.normalizeSettings(stored[UrlCleaner.STORAGE_KEY]);
  }

  async function createContextMenu() {
    if (!ext.contextMenus) return;
    await safeCall(() => ext.contextMenus.removeAll(), undefined);
    await safeCall(() => ext.contextMenus.create({
      id: MENU_ID,
      title: '複製無痕連結',
      contexts: ['link']
    }), undefined);
  }

  async function setBadge(tabId, count) {
    if (!action || !action.setBadgeText || tabId == null) return;
    const text = count > 0 ? String(Math.min(count, 99)) : '';
    await safeCall(() => action.setBadgeText({ tabId, text }), undefined);
    if (text && action.setBadgeBackgroundColor) {
      await safeCall(() => action.setBadgeBackgroundColor({ tabId, color: '#0e7490' }), undefined);
    }
  }

  async function updateBadge(tab) {
    if (!tab || tab.id == null || !tab.url) return;
    const settings = await readSettings();
    const result = UrlCleaner.cleanUrl(tab.url, settings);
    await setBadge(tab.id, result.changed ? result.removed.length : 0);
  }

  async function refreshBadges() {
    if (!ext.tabs) return;
    const tabs = await safeCall(() => ext.tabs.query({}), []);
    await Promise.all((tabs || []).map((tab) => updateBadge(tab)));
  }

  async function readResponseText(response) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_SUBSCRIPTION_BYTES) {
      throw new Error('規則清單太大');
    }
    if (!response.body || !response.body.getReader) {
      const text = await response.text();
      if (text.length > MAX_SUBSCRIPTION_BYTES) throw new Error('規則清單太大');
      return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_SUBSCRIPTION_BYTES) {
        await reader.cancel();
        throw new Error('規則清單太大');
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  function parseSubscriptionBody(text, contentType) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('規則清單是空的');
    let payload = text;
    if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error('JSON 規則清單格式錯誤');
      }
    }
    const parsed = UrlCleaner.parseRuleList(payload, 'subscription');
    if (!parsed.rules.length) throw new Error('找不到有效規則');
    if (parsed.rules.length > MAX_SUBSCRIPTION_RULES) throw new Error('規則數量超過上限');
    return parsed;
  }

  async function syncOneSubscription(subscription) {
    const attemptAt = Date.now();
    const next = { ...subscription, lastAttemptAt: attemptAt };
    try {
      if (!UrlCleaner.isHttpUrl(subscription.url)) throw new Error('只允許 HTTP(S) 網址');
      const response = await fetch(subscription.url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'follow'
      });
      const body = await readResponseText(response);
      const parsed = parseSubscriptionBody(body, response.headers.get('content-type') || '');
      next.rules = parsed.rules.map((rule) => ({ ...rule, source: `subscription:${subscription.url}` }));
      next.status = 'ok';
      next.lastError = '';
      next.lastSyncedAt = Date.now();
    } catch (error) {
      // Keep the last known good rules when an endpoint temporarily fails.
      next.status = 'error';
      next.lastError = error && error.message ? error.message.slice(0, 200) : '同步失敗';
    }
    return next;
  }

  async function syncSubscriptions() {
    const settings = await readSettings();
    if (!settings.subscriptions.length) return settings;
    const subscriptions = [];
    for (const subscription of settings.subscriptions) {
      subscriptions.push(await syncOneSubscription(subscription));
    }
    const updated = await writeSettings({ ...settings, subscriptions });
    await refreshBadges();
    return updated;
  }

  async function scheduleSync() {
    if (!ext.alarms) return;
    await safeCall(() => ext.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES }), undefined);
  }

  async function copyInTab(tabId, value) {
    if (tabId == null) throw new Error('找不到目前分頁');
    const message = { type: 'copyText', text: value };
    try {
      const response = await ext.tabs.sendMessage(tabId, message);
      if (response && response.ok) return true;
    } catch (error) {
      // Pages such as chrome:// cannot receive a content-script message.
    }
    if (ext.scripting && ext.scripting.executeScript) {
      const results = await ext.scripting.executeScript({
        target: { tabId },
        func: async (text) => {
          try {
            await navigator.clipboard.writeText(text);
            return true;
          } catch (error) {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const copied = document.execCommand('copy');
            area.remove();
            return copied;
          }
        },
        args: [value]
      });
      if (results && results.some((item) => item.result === true)) return true;
    }
    throw new Error('瀏覽器拒絕剪貼簿權限，請從 Popup 按下複製');
  }

  async function handleContextMenu(info, tab) {
    if (!info || info.menuItemId !== MENU_ID || !info.linkUrl) return;
    const settings = await readSettings();
    const result = UrlCleaner.cleanUrl(info.linkUrl, settings);
    try {
      await copyInTab(tab && tab.id, result.cleaned);
      await setBadge(tab && tab.id, result.removed.length);
      await safeCall(() => ext.tabs.sendMessage(tab.id, {
        type: 'toast',
        message: result.changed ? `已複製，移除 ${result.removed.length} 個追蹤參數` : '已複製連結（沒有命中規則）'
      }), undefined);
    } catch (error) {
      await safeCall(() => ext.tabs.sendMessage(tab && tab.id, {
        type: 'toast',
        message: error.message || '複製失敗'
      }), undefined);
    }
  }

  async function handleCommand(command) {
    if (command !== 'copy-clean-url') return;
    const tabs = await ext.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.url) return;
    const settings = await readSettings();
    const result = UrlCleaner.cleanUrl(tab.url, settings);
    try {
      await copyInTab(tab.id, result.cleaned);
      await safeCall(() => ext.tabs.sendMessage(tab.id, {
        type: 'toast',
        message: result.changed ? `已複製，移除 ${result.removed.length} 個追蹤參數` : '已複製連結（沒有命中規則）'
      }), undefined);
    } catch (error) {
      await safeCall(() => ext.tabs.sendMessage(tab.id, { type: 'toast', message: error.message }), undefined);
    }
  }

  async function handleMessage(message, sender) {
    if (!message || !message.type) return undefined;
    if (message.type === 'getSettings') return readSettings();
    if (message.type === 'saveSettings') {
      const saved = await writeSettings(message.settings);
      await refreshBadges();
      return { ok: true, settings: saved };
    }
    if (message.type === 'syncSubscriptions') {
      const synced = await syncSubscriptions();
      return { ok: true, settings: synced };
    }
    if (message.type === 'pageCleaned') {
      const tabId = sender && sender.tab && sender.tab.id;
      if (tabId != null) await setBadge(tabId, Array.isArray(message.removed) ? message.removed.length : 0);
      return { ok: true };
    }
    if (message.type === 'copyInCurrentTab') {
      const tabId = sender && sender.tab && sender.tab.id;
      await copyInTab(tabId, String(message.text || ''));
      return { ok: true };
    }
    return undefined;
  }

  ext.runtime.onInstalled.addListener(() => {
    ensureSettings().then(createContextMenu).then(scheduleSync).catch(() => {});
  });
  if (ext.runtime.onStartup) {
    ext.runtime.onStartup.addListener(() => {
      ensureSettings().then(createContextMenu).then(scheduleSync).catch(() => {});
    });
  }
  if (ext.contextMenus && ext.contextMenus.onClicked) {
    ext.contextMenus.onClicked.addListener((info, tab) => {
      handleContextMenu(info, tab).catch(() => {});
    });
  }
  if (ext.commands && ext.commands.onCommand) {
    ext.commands.onCommand.addListener((command) => handleCommand(command).catch(() => {}));
  }
  if (ext.alarms && ext.alarms.onAlarm) {
    ext.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === ALARM_NAME) syncSubscriptions().catch(() => {});
    });
  }
  if (ext.tabs && ext.tabs.onUpdated) {
    ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url || changeInfo.status === 'complete') updateBadge({ ...tab, id: tabId }).catch(() => {});
    });
  }
  if (ext.storage && ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[UrlCleaner.STORAGE_KEY]) refreshBadges().catch(() => {});
    });
  }
  ext.runtime.onMessage.addListener((message, sender) => handleMessage(message, sender));

  ensureSettings().then(createContextMenu).then(scheduleSync).catch(() => {});
}());

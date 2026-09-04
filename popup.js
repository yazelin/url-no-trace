(function startPopup() {
  'use strict';

  const ext = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  let activeTab = null;
  let settings = UrlCleaner.defaultSettings();
  let preview = null;

  const elements = {
    activeState: document.querySelector('#active-state'),
    unsupported: document.querySelector('#unsupported'),
    content: document.querySelector('#content'),
    currentHost: document.querySelector('#current-host'),
    originalUrl: document.querySelector('#original-url'),
    cleanUrl: document.querySelector('#clean-url'),
    removedSection: document.querySelector('#removed-section'),
    removedCount: document.querySelector('#removed-count'),
    removedList: document.querySelector('#removed-list'),
    resultNote: document.querySelector('#result-note'),
    copyButton: document.querySelector('#copy-button'),
    applyButton: document.querySelector('#apply-button'),
    whitelistButton: document.querySelector('#whitelist-button'),
    whitelistDescription: document.querySelector('#whitelist-description'),
    pauseToggle: document.querySelector('#pause-toggle'),
    settingsLink: document.querySelector('#settings-link'),
    feedback: document.querySelector('#feedback')
  };

  function showFeedback(message, warning) {
    elements.feedback.textContent = message || '';
    elements.feedback.style.color = warning ? '#b45309' : '';
  }

  async function readSettings() {
    const stored = await ext.storage.local.get(UrlCleaner.STORAGE_KEY);
    return UrlCleaner.normalizeSettings(stored && stored[UrlCleaner.STORAGE_KEY]);
  }

  async function saveSettings(next) {
    settings = UrlCleaner.normalizeSettings(next);
    await ext.storage.local.set({ [UrlCleaner.STORAGE_KEY]: settings });
    return settings;
  }

  function currentHost() {
    try { return new URL(activeTab && activeTab.url).hostname; } catch (error) { return ''; }
  }

  function isWhitelisted() {
    const host = currentHost();
    return !!host && settings.whitelist.some((entry) => UrlCleaner.hostMatches(host, entry));
  }

  function renderRemoved(items) {
    elements.removedList.replaceChildren();
    elements.removedCount.textContent = String(items.length);
    elements.removedSection.classList.toggle('is-hidden', !items.length);
    for (const item of items) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = item.name;
      elements.removedList.appendChild(chip);
    }
  }

  function render() {
    const host = currentHost();
    const supported = !!activeTab && !!activeTab.url && UrlCleaner.isHttpUrl(activeTab.url);
    elements.unsupported.classList.toggle('is-hidden', supported);
    elements.content.classList.toggle('is-hidden', !supported);
    if (!supported) {
      elements.activeState.textContent = settings.paused ? '已暫停' : '無法注入';
      elements.activeState.classList.toggle('is-paused', settings.paused);
      return;
    }

    preview = UrlCleaner.cleanUrl(activeTab.url, settings);
    elements.activeState.textContent = settings.paused ? '已暫停' : '啟用中';
    elements.activeState.classList.toggle('is-paused', settings.paused);
    elements.currentHost.textContent = host || '目前分頁';
    elements.originalUrl.textContent = preview.original;
    elements.cleanUrl.textContent = preview.cleaned;
    renderRemoved(preview.removed);
    elements.copyButton.disabled = false;
    elements.applyButton.disabled = !preview.changed;
    elements.pauseToggle.checked = settings.paused;
    const whitelisted = isWhitelisted();
    elements.whitelistButton.textContent = whitelisted ? '移除白名單' : '加入白名單';
    elements.whitelistDescription.textContent = whitelisted ? '此網域目前不會被清理' : '需要保留參數？加入白名單';
    if (preview.skipped === 'paused') {
      elements.resultNote.textContent = '已暫停：目前網址不會被修改';
      elements.resultNote.className = 'result-note is-warning';
    } else if (preview.skipped === 'whitelisted') {
      elements.resultNote.textContent = '白名單網域：目前網址不會被修改';
      elements.resultNote.className = 'result-note is-warning';
    } else if (preview.changed) {
      elements.resultNote.textContent = `可以移除 ${preview.removed.length} 個追蹤參數`;
      elements.resultNote.className = 'result-note is-good';
    } else {
      elements.resultNote.textContent = '目前網址沒有命中清理規則';
      elements.resultNote.className = 'result-note';
    }
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    }
  }

  async function copyCleanUrl() {
    if (!preview) return;
    const ok = await copyText(preview.cleaned);
    showFeedback(ok ? '已複製到剪貼簿' : '瀏覽器拒絕剪貼簿權限', !ok);
  }

  async function applyCleanUrl() {
    if (!preview || !preview.changed || !activeTab || activeTab.id == null) return;
    try {
      const response = await ext.tabs.sendMessage(activeTab.id, {
        type: 'applyCleanedUrl',
        url: preview.cleaned
      });
      if (!response || !response.ok) throw new Error('content script unavailable');
      showFeedback('已套用到網址列');
      activeTab.url = preview.cleaned;
      render();
    } catch (error) {
      try {
        await ext.tabs.update(activeTab.id, { url: preview.cleaned });
        showFeedback('已套用；頁面會重新載入');
      } catch (updateError) {
        showFeedback('這個頁面不允許套用網址', true);
      }
    }
  }

  async function toggleWhitelist() {
    const host = currentHost();
    if (!host) return;
    const whitelisted = isWhitelisted();
    const nextWhitelist = whitelisted
      ? settings.whitelist.filter((entry) => !UrlCleaner.hostMatches(host, entry))
      : settings.whitelist.concat(host);
    await saveSettings({ ...settings, whitelist: nextWhitelist });
    render();
    showFeedback(whitelisted ? '已移除白名單' : `已將 ${host} 加入白名單`);
  }

  async function togglePause() {
    await saveSettings({ ...settings, paused: elements.pauseToggle.checked });
    render();
    showFeedback(settings.paused ? '已暫停全域清理' : '已恢復全域清理');
  }

  async function openSettings(event) {
    event.preventDefault();
    if (ext.runtime.openOptionsPage) await ext.runtime.openOptionsPage();
    else await ext.tabs.create({ url: ext.runtime.getURL('options.html') });
  }

  async function init() {
    try {
      const tabs = await ext.tabs.query({ active: true, currentWindow: true });
      activeTab = tabs && tabs[0];
      settings = await readSettings();
      render();
    } catch (error) {
      showFeedback('無法讀取目前分頁', true);
    }
  }

  elements.copyButton.addEventListener('click', () => copyCleanUrl().catch(() => showFeedback('複製失敗', true)));
  elements.applyButton.addEventListener('click', () => applyCleanUrl().catch(() => showFeedback('套用失敗', true)));
  elements.whitelistButton.addEventListener('click', () => toggleWhitelist().catch(() => showFeedback('白名單更新失敗', true)));
  elements.pauseToggle.addEventListener('change', () => togglePause().catch(() => showFeedback('暫停設定更新失敗', true)));
  elements.settingsLink.addEventListener('click', (event) => openSettings(event).catch(() => {}));
  init();
}());

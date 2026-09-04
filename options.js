(function startOptions() {
  'use strict';

  const ext = typeof browser !== 'undefined' && browser.runtime ? browser : chrome;
  let settings = UrlCleaner.defaultSettings();

  const el = {
    notice: document.querySelector('#notice'),
    summary: document.querySelector('#rule-summary'),
    pause: document.querySelector('#global-pause'),
    ruleForm: document.querySelector('#rule-form'),
    rulePattern: document.querySelector('#rule-pattern'),
    ruleKind: document.querySelector('#rule-kind'),
    ruleHost: document.querySelector('#rule-host'),
    customRules: document.querySelector('#custom-rules'),
    customEmpty: document.querySelector('#custom-empty'),
    subscriptionForm: document.querySelector('#subscription-form'),
    subscriptionUrl: document.querySelector('#subscription-url'),
    sync: document.querySelector('#sync-button'),
    subscriptions: document.querySelector('#subscriptions'),
    subscriptionEmpty: document.querySelector('#subscription-empty'),
    whitelistForm: document.querySelector('#whitelist-form'),
    whitelistHost: document.querySelector('#whitelist-host'),
    whitelist: document.querySelector('#whitelist'),
    whitelistEmpty: document.querySelector('#whitelist-empty'),
    reset: document.querySelector('#reset-button')
  };

  function setNotice(message, warning) {
    el.notice.textContent = message || '';
    el.notice.style.color = warning ? '#b45309' : '';
  }

  async function readSettings() {
    const stored = await ext.storage.local.get(UrlCleaner.STORAGE_KEY);
    return UrlCleaner.normalizeSettings(stored && stored[UrlCleaner.STORAGE_KEY]);
  }

  async function save(next) {
    settings = UrlCleaner.normalizeSettings(next);
    await ext.storage.local.set({ [UrlCleaner.STORAGE_KEY]: settings });
    return settings;
  }

  function addText(parent, tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    parent.appendChild(node);
    return node;
  }

  function renderSummary() {
    const custom = settings.customRules.length;
    const subscriptions = settings.subscriptions.length;
    const subscribedRules = settings.subscriptions.reduce((total, item) => total + item.rules.length, 0);
    el.summary.textContent = `${UrlCleaner.getDefaultRules().length} 個內建規則 · ${custom} 個自訂 · ${subscribedRules} 個訂閱規則`;
    el.pause.checked = settings.paused;
    el.sync.disabled = !subscriptions;
  }

  function renderCustomRules() {
    el.customRules.replaceChildren();
    el.customEmpty.hidden = settings.customRules.length > 0;
    for (const rule of settings.customRules) {
      const row = document.createElement('div');
      row.className = 'list-row';
      const main = document.createElement('div');
      main.className = 'row-main';
      addText(main, 'span', 'row-title', UrlCleaner.displayRule(rule));
      addText(main, 'span', 'row-meta', rule.hostPattern ? `限定 ${rule.hostPattern}` : '所有網站');
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small-button is-danger';
      remove.textContent = '刪除';
      remove.addEventListener('click', () => removeCustomRule(rule.id).catch(() => setNotice('規則刪除失敗', true)));
      actions.appendChild(remove);
      row.append(main, actions);
      el.customRules.appendChild(row);
    }
  }

  function formatTime(timestamp) {
    if (!timestamp) return '尚未同步';
    try { return `上次同步 ${new Date(timestamp).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}`; }
    catch (error) { return '已同步'; }
  }

  function renderSubscriptions() {
    el.subscriptions.replaceChildren();
    el.subscriptionEmpty.hidden = settings.subscriptions.length > 0;
    for (const subscription of settings.subscriptions) {
      const row = document.createElement('div');
      row.className = 'list-row';
      const main = document.createElement('div');
      main.className = 'row-main';
      addText(main, 'span', 'row-title', subscription.url);
      const meta = subscription.lastError ? subscription.lastError : `${subscription.rules.length} 條規則 · ${formatTime(subscription.lastSyncedAt)}`;
      addText(main, 'span', 'row-meta', meta);
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const status = addText(actions, 'span', `row-status${subscription.status === 'error' ? ' is-error' : ''}`, subscription.status === 'error' ? '同步失敗' : (subscription.status === 'ok' ? '已同步' : '待同步'));
      status.title = subscription.lastError || '';
      const sync = document.createElement('button');
      sync.type = 'button';
      sync.className = 'small-button';
      sync.textContent = '同步';
      sync.addEventListener('click', () => syncSubscriptions().catch(() => setNotice('同步失敗', true)));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small-button is-danger';
      remove.textContent = '移除';
      remove.addEventListener('click', () => removeSubscription(subscription.id).catch(() => setNotice('清單移除失敗', true)));
      actions.append(sync, remove);
      row.append(main, actions);
      el.subscriptions.appendChild(row);
    }
  }

  function renderWhitelist() {
    el.whitelist.replaceChildren();
    el.whitelistEmpty.hidden = settings.whitelist.length > 0;
    for (const host of settings.whitelist) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      addText(tag, 'span', '', host);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `移除 ${host}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => removeWhitelist(host).catch(() => setNotice('白名單更新失敗', true)));
      tag.appendChild(remove);
      el.whitelist.appendChild(tag);
    }
  }

  function render() {
    renderSummary();
    renderCustomRules();
    renderSubscriptions();
    renderWhitelist();
  }

  async function addCustomRule(event) {
    event.preventDefault();
    const parsed = UrlCleaner.createRule({
      pattern: el.rulePattern.value,
      kind: el.ruleKind.value,
      hostPattern: el.ruleHost.value,
      source: 'custom'
    });
    if (!parsed.ok) {
      setNotice(parsed.error, true);
      return;
    }
    settings = await save({ ...settings, customRules: settings.customRules.concat(parsed.rule) });
    el.ruleForm.reset();
    render();
    setNotice('已新增自訂規則');
  }

  async function removeCustomRule(id) {
    settings = await save({ ...settings, customRules: settings.customRules.filter((rule) => rule.id !== id) });
    render();
    setNotice('已刪除自訂規則');
  }

  async function addSubscription(event) {
    event.preventDefault();
    const url = el.subscriptionUrl.value.trim();
    if (!UrlCleaner.isHttpUrl(url)) {
      setNotice('規則清單必須是 HTTP(S) 網址', true);
      return;
    }
    if (settings.subscriptions.some((item) => item.url === url)) {
      setNotice('這份規則清單已經加入', true);
      return;
    }
    const subscription = { id: `subscription:${url}`, url, rules: [], status: 'idle', lastError: '' };
    settings = await save({ ...settings, subscriptions: settings.subscriptions.concat(subscription) });
    el.subscriptionForm.reset();
    render();
    setNotice('已加入，開始同步規則…');
    await syncSubscriptions();
  }

  async function syncSubscriptions() {
    el.sync.disabled = true;
    setNotice('正在同步規則清單…');
    try {
      const response = await ext.runtime.sendMessage({ type: 'syncSubscriptions' });
      if (!response || !response.ok) throw new Error('sync_failed');
      settings = UrlCleaner.normalizeSettings(response.settings);
      render();
      const errors = settings.subscriptions.filter((item) => item.status === 'error').length;
      setNotice(errors ? `${errors} 份清單同步失敗，已保留上一份有效規則` : '規則清單同步完成');
    } catch (error) {
      settings = await readSettings();
      render();
      setNotice('同步失敗；若已有有效版本，仍會繼續使用', true);
    } finally {
      el.sync.disabled = !settings.subscriptions.length;
    }
  }

  async function removeSubscription(id) {
    settings = await save({ ...settings, subscriptions: settings.subscriptions.filter((item) => item.id !== id) });
    render();
    setNotice('已移除規則清單');
  }

  async function addWhitelist(event) {
    event.preventDefault();
    const host = UrlCleaner.normalizeHost(el.whitelistHost.value);
    if (!host || host.includes(':') || host.includes('?') || host.includes('#') || host.includes(' ')) {
      setNotice('請輸入有效網域，例如 bank.example.tw', true);
      return;
    }
    if (settings.whitelist.some((entry) => UrlCleaner.hostMatches(host, entry))) {
      setNotice('這個網域已在白名單中', true);
      return;
    }
    settings = await save({ ...settings, whitelist: settings.whitelist.concat(host) });
    el.whitelistForm.reset();
    render();
    setNotice(`已將 ${host} 加入白名單`);
  }

  async function removeWhitelist(host) {
    settings = await save({ ...settings, whitelist: settings.whitelist.filter((entry) => entry !== host) });
    render();
    setNotice(`已移除 ${host}`);
  }

  async function togglePause() {
    settings = await save({ ...settings, paused: el.pause.checked });
    render();
    setNotice(settings.paused ? '已暫停全域清理' : '已恢復全域清理');
  }

  async function resetSettings() {
    if (!confirm('確定清除自訂規則、訂閱與白名單？內建規則不會被刪除。')) return;
    settings = await save({ paused: settings.paused, whitelist: [], customRules: [], subscriptions: [] });
    render();
    setNotice('已清除自訂設定');
  }

  async function init() {
    try {
      settings = await readSettings();
      render();
    } catch (error) {
      setNotice('無法讀取設定', true);
    }
  }

  el.ruleForm.addEventListener('submit', (event) => addCustomRule(event).catch(() => setNotice('規則新增失敗', true)));
  el.subscriptionForm.addEventListener('submit', (event) => addSubscription(event).catch(() => setNotice('清單新增失敗', true)));
  el.whitelistForm.addEventListener('submit', (event) => addWhitelist(event).catch(() => setNotice('白名單新增失敗', true)));
  el.sync.addEventListener('click', () => syncSubscriptions().catch(() => setNotice('同步失敗', true)));
  el.pause.addEventListener('change', () => togglePause().catch(() => setNotice('暫停設定失敗', true)));
  el.reset.addEventListener('click', () => resetSettings().catch(() => setNotice('清除設定失敗', true)));
  init();
}());

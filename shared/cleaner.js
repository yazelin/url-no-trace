(function attachCleaner(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UrlCleaner = factory();
  }
}(typeof self !== 'undefined' ? self : this, function createCleaner() {
  'use strict';

  const MAX_RULE_LENGTH = 256;
  const MAX_REGEX_LENGTH = 160;
  const MAX_URL_LENGTH = 100000;
  const MAX_RULES = 2000;
  const MAX_WHITELIST = 100;
  const STORAGE_KEY = 'settings';

  const BUILTIN_RULES = [
    { pattern: 'utm_', kind: 'prefix', label: 'UTM 行銷追蹤' },
    { pattern: 'fbclid', kind: 'exact', label: 'Facebook 點擊追蹤' },
    { pattern: 'gclid', kind: 'exact', label: 'Google Ads 點擊追蹤' },
    { pattern: 'dclid', kind: 'exact', label: 'DoubleClick 點擊追蹤' },
    { pattern: 'gbraid', kind: 'exact', label: 'Google Ads 裝置追蹤' },
    { pattern: 'wbraid', kind: 'exact', label: 'Google Ads 網路追蹤' },
    { pattern: 'gad_source', kind: 'exact', label: 'Google Ads 來源' },
    { pattern: 'gad_campaignid', kind: 'exact', label: 'Google Ads 活動' },
    { pattern: 'msclkid', kind: 'exact', label: 'Microsoft Ads 點擊追蹤' },
    { pattern: 'yclid', kind: 'exact', label: 'Yandex 點擊追蹤' },
    { pattern: 'ttclid', kind: 'exact', label: 'TikTok 點擊追蹤' },
    { pattern: 'tiktok_r', kind: 'exact', label: 'TikTok 轉介追蹤' },
    { pattern: 'igsh', kind: 'prefix', label: 'Instagram 分享追蹤' },
    { pattern: 'li_fat_id', kind: 'exact', label: 'LinkedIn 點擊追蹤' },
    { pattern: 'mkt_tok', kind: 'exact', label: '行銷郵件追蹤' },
    { pattern: 'mc_cid', kind: 'exact', label: 'Mailchimp 活動追蹤' },
    { pattern: 'mc_eid', kind: 'exact', label: 'Mailchimp 收件人追蹤' },
    { pattern: '_hsenc', kind: 'exact', label: 'HubSpot 追蹤' },
    { pattern: '_hsmi', kind: 'exact', label: 'HubSpot 郵件追蹤' },
    { pattern: 'ref', kind: 'exact', label: '常見轉介追蹤' },
    { pattern: 'ref_src', kind: 'exact', label: '轉介來源追蹤' },
    { pattern: 'spm', kind: 'exact', label: '亞洲平台 SPM 追蹤' },
    { pattern: 'share_', kind: 'prefix', label: '分享來源追蹤' },
    { pattern: 'smtt', kind: 'exact', hostPattern: 'shopee.tw', label: 'Shopee 分享追蹤' },
    { pattern: 'af_siteid', kind: 'exact', hostPattern: 'shopee.tw', label: 'Shopee 聯盟追蹤' },
    { pattern: 'af_sub1', kind: 'exact', hostPattern: 'shopee.tw', label: 'Shopee 聯盟追蹤' },
    { pattern: 'uls_trackid', kind: 'exact', hostPattern: 'shopee.tw', label: 'Shopee 追蹤' },
    { pattern: 'from', kind: 'exact', hostPattern: 'ptt.cc', label: 'PTT 來源追蹤' },
    { pattern: 'source', kind: 'exact', hostPattern: 'dcard.tw', label: 'Dcard 來源追蹤' }
  ];

  function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeHost(value) {
    return asString(value)
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/^\.+|\.+$/g, '');
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function hostMatches(hostname, pattern) {
    const host = normalizeHost(hostname);
    let wanted = normalizeHost(pattern);
    if (!host || !wanted) return false;
    if (wanted.startsWith('*.')) wanted = wanted.slice(2);
    return host === wanted || host.endsWith(`.${wanted}`);
  }

  function parseRegexPattern(rawPattern, rawFlags) {
    let pattern = asString(rawPattern);
    let flags = asString(rawFlags);
    if (pattern.toLowerCase().startsWith('regex:')) pattern = pattern.slice(6).trim();

    if (pattern.startsWith('/')) {
      const lastSlash = pattern.lastIndexOf('/');
      if (lastSlash > 0) {
        if (!flags) flags = pattern.slice(lastSlash + 1);
        pattern = pattern.slice(1, lastSlash);
      }
    }

    if (!pattern || pattern.length > MAX_REGEX_LENGTH) {
      return { ok: false, error: `正則長度需介於 1 到 ${MAX_REGEX_LENGTH} 字元` };
    }
    if (!flags) flags = 'i';
    if (!/^[imu]*$/.test(flags) || new Set(flags).size !== flags.length) {
      return { ok: false, error: '正則只允許 i、m、u 旗標，且不可重複' };
    }

    try {
      // Compile at save/parse time so an invalid user rule never reaches cleaning.
      // The cleaner only tests this against a bounded parameter name.
      new RegExp(pattern, flags);
    } catch (error) {
      return { ok: false, error: '正則表達式無法編譯' };
    }
    return { ok: true, pattern, flags };
  }

  function inferRuleKind(pattern) {
    const raw = asString(pattern);
    if (raw.toLowerCase().startsWith('regex:') || (raw.startsWith('/') && raw.lastIndexOf('/') > 0)) {
      return 'regex';
    }
    return raw.endsWith('*') ? 'prefix' : 'exact';
  }

  function createRule(input) {
    const source = asString(input && input.source) || 'custom';
    const rawPattern = asString(input && input.pattern);
    const requestedKind = asString(input && input.kind) || inferRuleKind(rawPattern);
    const kind = requestedKind === 'auto' ? inferRuleKind(rawPattern) : requestedKind;
    if (!rawPattern || rawPattern.length > MAX_RULE_LENGTH) {
      return { ok: false, error: `規則長度需介於 1 到 ${MAX_RULE_LENGTH} 字元` };
    }
    if (!['exact', 'prefix', 'regex'].includes(kind)) {
      return { ok: false, error: '規則類型不正確' };
    }

    let pattern = rawPattern;
    let flags = asString(input && input.flags);
    if (kind === 'prefix' && pattern.endsWith('*')) pattern = pattern.slice(0, -1);
    if (kind === 'regex') {
      const parsed = parseRegexPattern(pattern, flags);
      if (!parsed.ok) return parsed;
      pattern = parsed.pattern;
      flags = parsed.flags;
    }
    if (!pattern) return { ok: false, error: '規則不可為空白' };
    if (kind !== 'regex') flags = '';

    const hostPattern = normalizeHost(input && (input.hostPattern || input.host));
    const id = asString(input && input.id)
      || `${source}:${kind}:${pattern}:${hostPattern}:${flags}`;
    return {
      ok: true,
      rule: {
        id,
        pattern,
        kind,
        flags,
        hostPattern,
        source,
        label: asString(input && input.label)
      }
    };
  }

  function normalizeRuleList(rules, source) {
    if (!Array.isArray(rules)) return [];
    const result = [];
    const seen = new Set();
    for (const item of rules) {
      const candidate = typeof item === 'string' ? { pattern: item, source } : { ...(item || {}), source: source || item.source };
      const parsed = createRule(candidate);
      if (!parsed.ok) continue;
      const rule = parsed.rule;
      if (seen.has(rule.id)) continue;
      seen.add(rule.id);
      result.push(rule);
      if (result.length >= MAX_RULES) break;
    }
    return result;
  }

  function pushRuleValues(value, output) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') output.push(item);
        else if (item && typeof item === 'object') {
          if (typeof item.pattern === 'string') output.push(item);
          else pushRuleValues(item.rules, output);
        }
      }
    }
  }

  function extractRuleValues(payload) {
    if (Array.isArray(payload)) return payload;
    if (typeof payload === 'string') {
      return payload.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
        .map((line) => line.replace(/^[-*]\s+/, ''));
    }
    if (!payload || typeof payload !== 'object') return [];

    const output = [];
    for (const key of ['rules', 'parameters', 'trackingParameters', 'filterRules']) {
      pushRuleValues(payload[key], output);
    }
    if (payload.providers && typeof payload.providers === 'object') {
      for (const provider of Object.values(payload.providers)) {
        if (provider && typeof provider === 'object') {
          pushRuleValues(provider.rules, output);
          pushRuleValues(provider.parameters, output);
        }
      }
    }
    if (payload.data && typeof payload.data === 'object') {
      output.push(...extractRuleValues(payload.data));
    }
    return output;
  }

  function parseRuleList(payload, source) {
    const raw = extractRuleValues(payload);
    const rules = normalizeRuleList(raw, source || 'subscription');
    return {
      rules,
      received: raw.length,
      rejected: Math.max(0, raw.length - rules.length)
    };
  }

  function getDefaultRules() {
    return normalizeRuleList(BUILTIN_RULES, 'builtin');
  }

  function defaultSettings() {
    return {
      paused: false,
      whitelist: [],
      customRules: [],
      subscriptions: []
    };
  }

  function normalizeSubscription(value) {
    if (!value || typeof value !== 'object') return null;
    const url = asString(value.url);
    if (!isHttpUrl(url)) return null;
    const parsedRules = normalizeRuleList(value.rules, `subscription:${url}`);
    return {
      id: asString(value.id) || `subscription:${url}`,
      url,
      rules: parsedRules,
      lastSyncedAt: Number.isFinite(Number(value.lastSyncedAt)) ? Number(value.lastSyncedAt) : 0,
      lastAttemptAt: Number.isFinite(Number(value.lastAttemptAt)) ? Number(value.lastAttemptAt) : 0,
      lastError: asString(value.lastError),
      status: value.status === 'ok' || value.status === 'error' ? value.status : 'idle'
    };
  }

  function normalizeSettings(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const customRules = normalizeRuleList(raw.customRules, 'custom');
    const subscriptions = Array.isArray(raw.subscriptions)
      ? raw.subscriptions.map(normalizeSubscription).filter(Boolean)
      : [];
    const whitelist = Array.isArray(raw.whitelist)
      ? [...new Set(raw.whitelist.map(normalizeHost).filter(Boolean))].slice(0, MAX_WHITELIST)
      : [];
    return {
      paused: raw.paused === true,
      whitelist,
      customRules,
      subscriptions
    };
  }

  function allRules(settings) {
    const normalized = normalizeSettings(settings);
    const subscriptionRules = normalized.subscriptions.flatMap((item) => item.rules);
    return getDefaultRules().concat(normalized.customRules, subscriptionRules);
  }

  function matchesRule(rule, parameterName, hostname) {
    if (rule.hostPattern && !hostMatches(hostname, rule.hostPattern)) return false;
    const name = String(parameterName).slice(0, 512);
    if (rule.kind === 'exact') return name.toLowerCase() === rule.pattern.toLowerCase();
    if (rule.kind === 'prefix') return name.toLowerCase().startsWith(rule.pattern.toLowerCase());
    if (rule.kind === 'regex') {
      try {
        return new RegExp(rule.pattern, rule.flags || 'i').test(name);
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  function cleanUrl(input, rawSettings) {
    const original = typeof input === 'string' ? input : String(input || '');
    const settings = normalizeSettings(rawSettings);
    const base = {
      original,
      cleaned: original,
      changed: false,
      removed: [],
      skipped: ''
    };
    if (!original || original.length > MAX_URL_LENGTH) {
      base.skipped = 'invalid';
      return base;
    }

    let parsed;
    try {
      parsed = new URL(original);
    } catch (error) {
      base.skipped = 'invalid';
      return base;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      base.skipped = 'unsupported';
      return base;
    }
    if (settings.paused) {
      base.skipped = 'paused';
      return base;
    }
    if (settings.whitelist.some((host) => hostMatches(parsed.hostname, host))) {
      base.skipped = 'whitelisted';
      return base;
    }

    const rules = allRules(settings);
    const removed = [];
    for (const [name] of [...parsed.searchParams.entries()]) {
      const rule = rules.find((candidate) => matchesRule(candidate, name, parsed.hostname));
      if (rule) {
        parsed.searchParams.delete(name);
        removed.push({ name, ruleId: rule.id, label: rule.label || rule.pattern });
      }
    }
    if (!removed.length) return base;

    const nextQuery = parsed.searchParams.toString();
    parsed.search = nextQuery ? `?${nextQuery}` : '';
    return {
      original,
      cleaned: parsed.href,
      changed: parsed.href !== original,
      removed,
      skipped: ''
    };
  }

  function displayRule(rule) {
    if (!rule) return '';
    if (rule.kind === 'prefix') return `${rule.pattern}*`;
    if (rule.kind === 'regex') return `/${rule.pattern}/${rule.flags || 'i'}`;
    return rule.pattern;
  }

  return {
    STORAGE_KEY,
    MAX_RULE_LENGTH,
    MAX_RULES,
    BUILTIN_RULES,
    defaultSettings,
    normalizeSettings,
    normalizeHost,
    isHttpUrl,
    hostMatches,
    createRule,
    normalizeRuleList,
    parseRuleList,
    displayRule,
    getDefaultRules,
    cleanUrl,
    matchesRule
  };
}));

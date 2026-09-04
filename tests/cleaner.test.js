const test = require('node:test');
const assert = require('node:assert/strict');
const Cleaner = require('../shared/cleaner.js');

test('removes common and Taiwan-focused tracking parameters while preserving useful query values', () => {
  const result = Cleaner.cleanUrl(
    'https://example.com/article?utm_source=ig&keep=1&igsh=secret&view=full#comments',
    Cleaner.defaultSettings(),
  );

  assert.equal(result.changed, true);
  assert.equal(result.cleaned, 'https://example.com/article?keep=1&view=full#comments');
  assert.deepEqual(result.removed.map((item) => item.name), ['utm_source', 'igsh']);
});

test('does not rewrite URLs that have no matching parameters', () => {
  const url = 'https://example.com/page?query=hello%20world&mode=compact#top';
  const result = Cleaner.cleanUrl(url, Cleaner.defaultSettings());
  assert.equal(result.changed, false);
  assert.equal(result.cleaned, url);
  assert.deepEqual(result.removed, []);
});

test('supports exact, prefix and regex custom rules', () => {
  const exact = Cleaner.createRule({ pattern: 'tracking_id', kind: 'exact', source: 'custom' });
  const prefix = Cleaner.createRule({ pattern: 'campaign_*', kind: 'prefix', source: 'custom' });
  const regex = Cleaner.createRule({ pattern: '/^x_[0-9]+$/', kind: 'regex', source: 'custom' });
  assert.equal(exact.ok, true);
  assert.equal(prefix.ok, true);
  assert.equal(regex.ok, true);

  const result = Cleaner.cleanUrl(
    'https://example.com/?tracking_id=1&campaign_name=spring&x_42=yes&keep=ok',
    { customRules: [exact.rule, prefix.rule, regex.rule] },
  );
  assert.equal(result.cleaned, 'https://example.com/?keep=ok');
  assert.deepEqual(result.removed.map((item) => item.name), ['tracking_id', 'campaign_name', 'x_42']);
});

test('rejects malformed or unsafe-to-store regex rules', () => {
  const malformed = Cleaner.createRule({ pattern: '/[/', kind: 'regex' });
  const unsupportedFlag = Cleaner.createRule({ pattern: '/foo/g', kind: 'regex' });
  const oversized = Cleaner.createRule({ pattern: 'x'.repeat(161), kind: 'regex' });
  assert.equal(malformed.ok, false);
  assert.equal(unsupportedFlag.ok, false);
  assert.equal(oversized.ok, false);
});

test('applies a whitelist to the exact host and its subdomains, not lookalikes', () => {
  const settings = { whitelist: ['example.com'] };
  assert.equal(Cleaner.cleanUrl('https://example.com/?utm_source=x', settings).skipped, 'whitelisted');
  assert.equal(Cleaner.cleanUrl('https://sub.example.com/?utm_source=x', settings).skipped, 'whitelisted');
  const lookalike = Cleaner.cleanUrl('https://notexample.com/?utm_source=x', settings);
  assert.equal(lookalike.changed, true);
  assert.equal(Cleaner.hostMatches('notexample.com', 'example.com'), false);
});

test('global pause and unsupported protocols are explicit no-op states', () => {
  assert.equal(Cleaner.cleanUrl('https://example.com/?fbclid=1', { paused: true }).skipped, 'paused');
  assert.equal(Cleaner.cleanUrl('mailto:user@example.com?utm_source=x').skipped, 'unsupported');
});

test('parses plain text, generic JSON and ClearURLs-style provider lists', () => {
  const plain = Cleaner.parseRuleList('# comment\nutm_*\nfbclid\n\n/^[a-z]+_id$/i', 'subscription:test');
  assert.equal(plain.rules.length, 3);

  const json = Cleaner.parseRuleList({ rules: ['gclid', { pattern: 'spm', kind: 'exact' }] }, 'subscription:test');
  assert.equal(json.rules.length, 2);

  const clearUrls = Cleaner.parseRuleList({
    providers: {
      sample: { urlPattern: '^https://example.com', rules: ['affiliate_id', 'utm_'] }
    }
  }, 'subscription:test');
  assert.deepEqual(clearUrls.rules.map((rule) => Cleaner.displayRule(rule)), ['affiliate_id', 'utm_']);
});

test('normalizes stored settings and drops invalid persisted rules', () => {
  const settings = Cleaner.normalizeSettings({
    paused: 'yes',
    whitelist: ['https://Example.COM/path', '', 'example.com'],
    customRules: [{ pattern: 'ok' }, { pattern: '/[/' }],
    subscriptions: [{ url: 'https://rules.example/list.txt', rules: ['utm_*'] }, { url: 'file:///tmp/no' }]
  });
  assert.equal(settings.paused, false);
  assert.deepEqual(settings.whitelist, ['example.com']);
  assert.equal(settings.customRules.length, 1);
  assert.equal(settings.subscriptions.length, 1);
});

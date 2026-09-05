const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('manifest points only to local extension files', () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((item) => item.js)
  ];
  for (const file of files) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), true);
  assert.deepEqual(Object.keys(manifest.icons).sort(), ['128', '16', '32', '48']);
  for (const file of Object.values(manifest.icons)) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file);
  }
});

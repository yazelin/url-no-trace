import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConnection } from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(REPO_ROOT, 'tests', 'fixtures');
const WAIT_STEP_MS = 100;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findBinary(name, environmentName) {
  const configured = environmentName && process.env[environmentName];
  if (configured) return configured;
  const result = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  throw new Error(`找不到 ${name}；請安裝它，或設定 ${environmentName || name.toUpperCase() + '_PATH'}`);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} 失敗${detail ? `：${detail}` : ''}`);
  }
  return result.stdout.trim();
}

async function waitForValue(readValue, predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await readValue();
    if (predicate(lastValue)) return lastValue;
    await sleep(WAIT_STEP_MS);
  }
  throw new Error(`等待${label}逾時；最後值：${JSON.stringify(lastValue)}`);
}

async function startFixtureServer() {
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      if (requestUrl.pathname === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
      }
      const filename = requestUrl.pathname === '/' ? 'page.html' : requestUrl.pathname.slice(1);
      if (!/^(page\.html|rules\.json)$/.test(filename)) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      const body = await readFile(path.join(FIXTURE_ROOT, filename));
      response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filename)] });
      response.end(body);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(() => resolve()));
}

async function startXvfb() {
  const xvfbPath = findBinary('Xvfb', 'XVFB_PATH');
  for (let displayNumber = 100; displayNumber < 200; displayNumber += 1) {
    if (existsSync(`/tmp/.X11-unix/X${displayNumber}`)) continue;
    const processHandle = spawn(xvfbPath, [
      `:${displayNumber}`,
      '-screen', '0', '1440x1000x24',
      '-ac'
    ], { stdio: 'ignore' });
    await sleep(300);
    if (processHandle.exitCode === null) {
      return { processHandle, display: `:${displayNumber}` };
    }
  }
  throw new Error('找不到可用的 Xvfb display');
}

async function startPortal(portalPath) {
  const processHandle = spawn(portalPath, ['--isolated-bus', REPO_ROOT], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let errorOutput = '';
  processHandle.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
  const address = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('filechooser portal 啟動逾時')), 15000);
    processHandle.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const addressLine = output.match(/^DBUS_SESSION_BUS_ADDRESS=(.+)$/m);
      if (addressLine && /^FILECHOOSER_PORTAL_READY$/m.test(output)) {
        clearTimeout(deadline);
        resolve(addressLine[1].trim());
      }
    });
    processHandle.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    processHandle.once('exit', (code) => {
      if (code !== null) {
        clearTimeout(deadline);
        reject(new Error(`filechooser portal 結束（${code}）：${errorOutput || output}`));
      }
    });
  });
  return { processHandle, address };
}

async function waitForJson(url, timeout = 15000) {
  return waitForValue(async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      return null;
    }
  }, (value) => value !== null, url, timeout);
}

async function startChrome(chromePath, display, busAddress) {
  const profilePath = await mkdtemp(path.join(tmpdir(), 'url-no-trace-e2e-'));
  const portProbe = createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));

  const processHandle = spawn(chromePath, [
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--ozone-platform=x11',
    '--window-size=1050,980',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    'about:blank'
  ], {
    detached: true,
    env: { ...process.env, DISPLAY: display, DBUS_SESSION_BUS_ADDRESS: busAddress },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let errorOutput = '';
  processHandle.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
  await waitForJson(`http://127.0.0.1:${port}/json/list`, 20000).catch((error) => {
    throw new Error(`Chrome 啟動失敗：${errorOutput || error.message}`);
  });
  return { processHandle, port, profilePath };
}

async function stopProcess(processHandle, killGroup = false) {
  if (!processHandle || processHandle.exitCode !== null) return;
  try {
    if (killGroup && processHandle.pid) process.kill(-processHandle.pid, 'SIGTERM');
    else processHandle.kill('SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  await Promise.race([
    new Promise((resolve) => processHandle.once('exit', resolve)),
    sleep(3000)
  ]);
  if (processHandle.exitCode === null) {
    try {
      if (killGroup && processHandle.pid) process.kill(-processHandle.pid, 'SIGKILL');
      else processHandle.kill('SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

class CdpClient {
  constructor(url) {
    const parsed = new URL(url);
    this.host = parsed.hostname;
    this.port = Number(parsed.port || 80);
    this.path = `${parsed.pathname}${parsed.search}`;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.handshakeComplete = false;
    this.handshakeBuffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    const key = randomBytes(16).toString('base64');
    await new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      this.socket = socket;
      const timeout = setTimeout(() => reject(new Error('CDP WebSocket handshake 逾時')), 10000);
      socket.on('connect', () => {
        socket.write([
          `GET ${this.path} HTTP/1.1`,
          `Host: ${this.host}:${this.port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          ''
        ].join('\r\n'));
      });
      socket.on('data', (chunk) => {
        if (!this.handshakeComplete) {
          this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
          const headerEnd = this.handshakeBuffer.indexOf('\r\n\r\n');
          if (headerEnd < 0) return;
          const header = this.handshakeBuffer.subarray(0, headerEnd).toString();
          if (!/^HTTP\/1\.1 101/.test(header)) {
            clearTimeout(timeout);
            reject(new Error(`CDP WebSocket 被拒絕：${header}`));
            return;
          }
          this.handshakeComplete = true;
          this.buffer = this.handshakeBuffer.subarray(headerEnd + 4);
          this.handshakeBuffer = Buffer.alloc(0);
          clearTimeout(timeout);
          resolve();
          this.#drainFrames();
          return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.#drainFrames();
      });
      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
        this.#rejectPending(error);
      });
      socket.on('close', () => {
        const error = new Error('CDP WebSocket 已關閉');
        this.#rejectPending(error);
      });
    });
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  #drainFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      let offset = 2;
      let payloadLength = second & 0x7f;
      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        payloadLength = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const masked = (second & 0x80) !== 0;
      const maskOffset = masked ? 4 : 0;
      if (this.buffer.length < offset + maskOffset + payloadLength) return;
      let payload = this.buffer.subarray(offset + maskOffset, offset + maskOffset + payloadLength);
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        payload = Buffer.from(payload);
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }
      this.buffer = this.buffer.subarray(offset + maskOffset + payloadLength);
      const opcode = first & 0x0f;
      if (opcode === 0x8) {
        this.socket.destroy();
        return;
      }
      if (opcode === 0x9) {
        this.#writeFrame(payload, 0xA);
        continue;
      }
      if (opcode !== 0x1) continue;
      let message;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch (error) {
        continue;
      }
      if (message.id == null) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result || {});
    }
  }

  #writeFrame(payload, opcode = 0x1) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const mask = randomBytes(4);
    const encoded = Buffer.from(body);
    for (let index = 0; index < encoded.length; index += 1) encoded[index] ^= mask[index % 4];
    let header;
    if (encoded.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | encoded.length]);
    } else if (encoded.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(encoded.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(encoded.length), 2);
    }
    this.socket.write(Buffer.concat([header, mask, encoded]));
  }

  send(method, params = {}) {
    if (!this.socket || !this.handshakeComplete) return Promise.reject(new Error('CDP 尚未連線'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.#writeFrame(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || '頁面 JavaScript 執行失敗');
    }
    return response.result?.value;
  }

  close() {
    if (this.socket) this.socket.destroy();
  }
}

function deepTextScript() {
  return `(() => {
    function text(root) {
      let value = root.body?.innerText || root.textContent || '';
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) value += text(element.shadowRoot);
      }
      return value.replace(/\\s+/g, ' ').trim();
    }
    return text(document);
  })()`;
}

function developerModeStateScript() {
  return `(() => {
    function find(root, predicate) {
      if (!root) return null;
      for (const element of root.querySelectorAll('*')) {
        if (predicate(element)) return element;
        if (element.shadowRoot) {
          const found = find(element.shadowRoot, predicate);
          if (found) return found;
        }
      }
      return null;
    }
    const toolbar = document.querySelector('extensions-toolbar');
    const toggle = find(document, (element) => element.localName === 'cr-toggle');
    if (!toggle) return {
      found: false,
      toolbar: Boolean(toolbar),
      toolbarShadow: Boolean(toolbar && toolbar.shadowRoot)
    };
    return { found: true, checked: Boolean(toggle.checked) };
  })()`;
}

function hasLoadUnpackedButtonScript() {
  return `(() => {
    function find(root, predicate) {
      if (!root) return null;
      for (const element of root.querySelectorAll('*')) {
        if (predicate(element)) return element;
        if (element.shadowRoot) {
          const found = find(element.shadowRoot, predicate);
          if (found) return found;
        }
      }
      return null;
    }
    const button = find(document, (element) => element.localName === 'cr-button' && element.textContent.trim() === '載入未封裝項目');
    return Boolean(button);
  })()`;
}

function elementCenterScript(elementPredicate) {
  return `(() => {
    function find(root, predicate) {
      if (!root) return null;
      for (const element of root.querySelectorAll('*')) {
        if (predicate(element)) return element;
        if (element.shadowRoot) {
          const found = find(element.shadowRoot, predicate);
          if (found) return found;
        }
      }
      return null;
    }
    const element = find(document, ${elementPredicate});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}

async function clickCdpElement(cdp, elementPredicate, label) {
  const center = await waitForValue(
    () => cdp.evaluate(elementCenterScript(elementPredicate)),
    (value) => Boolean(value && value.x >= 0 && value.y >= 0),
    `${label}位置`,
    10000
  );
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: center.x,
    y: center.y,
    button: 'left',
    clickCount: 1
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: center.x,
    y: center.y,
    button: 'left',
    clickCount: 1
  });
}

async function focusCdpElement(cdp, elementPredicate, label) {
  await waitForValue(
    () => cdp.evaluate(`(() => {
      function find(root, predicate) {
        if (!root) return null;
        for (const element of root.querySelectorAll('*')) {
          if (predicate(element)) return element;
          if (element.shadowRoot) {
            const found = find(element.shadowRoot, predicate);
            if (found) return found;
          }
        }
        return null;
      }
      const element = find(document, ${elementPredicate});
      if (!element) return false;
      element.focus();
      return document.activeElement === element || element.matches(':focus');
    })()`),
    (value) => value === true,
    `${label}聚焦`,
    10000
  );
}

function extensionCardScript() {
  return `(() => {
    function text(root) {
      let value = root.body?.innerText || root.textContent || '';
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) value += text(element.shadowRoot);
      }
      return value.replace(/\\s+/g, ' ').trim();
    }
    const pageText = text(document);
    const marker = 'Clean Trail';
    const markerIndex = pageText.indexOf(marker);
    const card = markerIndex < 0 ? '' : pageText.slice(Math.max(0, markerIndex - 80), markerIndex + 320);
    return { found: markerIndex >= 0, text: card, hasError: card.includes('錯誤') };
  })()`;
}

function findChromeWindow(display) {
  const environment = { ...process.env, DISPLAY: display };
  const ids = runCommand('xdotool', ['search', '--onlyvisible', '--name', 'Google Chrome'], { env: environment })
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length) throw new Error('找不到可聚焦的 Chrome 視窗');
  return ids[0];
}

async function copyWithShortcut(display) {
  const environment = { ...process.env, DISPLAY: display };
  const windowId = findChromeWindow(display);
  runCommand('xdotool', ['windowfocus', '--sync', windowId], { env: environment });
  runCommand('xdotool', ['key', '--window', windowId, '--clearmodifiers', 'ctrl+shift+y'], { env: environment });
  return waitForValue(() => {
    for (const target of ['UTF8_STRING', 'text/plain;charset=utf-8', 'text/plain', 'STRING']) {
      try {
        const value = runCommand('xclip', ['-selection', 'clipboard', '-o', '-t', target], { env: environment });
        if (value) return value;
      } catch (error) {
        // Keep polling while the extension handles the command.
      }
    }
    return null;
  }, (value) => value !== null, '快捷鍵剪貼簿', 5000);
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await waitForValue(() => cdp.evaluate('location.href'), (value) => value === url, `網址 ${url}`, 10000);
}

async function submitForm(cdp, selector, values) {
  const serialized = JSON.stringify(values);
  const expression = `(() => {
    const values = ${serialized};
    for (const [selector, value] of Object.entries(values)) {
      const field = document.querySelector(selector);
      if (!field) throw new Error('找不到欄位 ' + selector);
      field.value = value;
    }
    document.querySelector('${selector}').requestSubmit();
    return true;
  })()`;
  return cdp.evaluate(expression);
}

test('Google Chrome E2E：載入、清理、設定與快捷鍵', { timeout: 120000 }, async () => {
  const chromePath = findBinary('google-chrome', 'CHROME_PATH');
  const portalPath = findBinary('filechooser-portal', 'FILECHOOSER_PORTAL_BIN');
  const { server, baseUrl } = await startFixtureServer();
  let xvfb;
  let portal;
  let chrome;
  let cdp;
  try {
    xvfb = await startXvfb();
    portal = await startPortal(portalPath);
    chrome = await startChrome(chromePath, xvfb.display, portal.address);
    const targetsUrl = `http://127.0.0.1:${chrome.port}/json/list`;
    const initialTargets = await waitForJson(targetsUrl);
    const pageTarget = initialTargets.find((target) => target.type === 'page');
    assert.ok(pageTarget, 'Chrome 沒有可用的頁面 target');
    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    await navigate(cdp, 'chrome://extensions/');
    const developerMode = await waitForValue(
      () => cdp.evaluate(developerModeStateScript()),
      (value) => Boolean(value?.found),
      'Chrome 開發人員模式切換',
      10000
    );
    assert.equal(developerMode.found, true, '找不到 Chrome 開發人員模式切換');
    if (!developerMode.checked) {
      await clickCdpElement(
        cdp,
        '(element) => element.localName === "cr-toggle"',
        'Chrome 開發人員模式切換'
      );
    }
    await waitForValue(() => cdp.evaluate(deepTextScript()), (value) => value.includes('載入未封裝項目'), 'Chrome 載入按鈕');
    await waitForValue(() => cdp.evaluate(hasLoadUnpackedButtonScript()), (value) => value === true, 'Chrome 載入按鈕元素');
    await clickCdpElement(
      cdp,
      '(element) => element.localName === "cr-button" && element.textContent.trim() === "載入未封裝項目"',
      'Chrome 載入按鈕'
    );
    await sleep(300);
    if (!(await cdp.evaluate(extensionCardScript())).found) {
      await focusCdpElement(
        cdp,
        '(element) => element.localName === "cr-button" && element.textContent.trim() === "載入未封裝項目"',
        'Chrome 載入按鈕'
      );
      const environment = { ...process.env, DISPLAY: xvfb.display };
      const windowId = findChromeWindow(xvfb.display);
      runCommand('xdotool', ['windowfocus', windowId], { env: environment });
      runCommand('xdotool', ['key', '--clearmodifiers', 'Return'], { env: environment });
    }
    await waitForValue(
      () => cdp.evaluate(extensionCardScript()),
      (value) => value.found,
      'Clean Trail 擴充功能卡片',
      15000
    );

    const loadedTargets = await waitForValue(
      async () => (await waitForJson(targetsUrl)).find((target) => target.type === 'service_worker' && target.url.endsWith('/background.js')),
      (value) => Boolean(value),
      'Clean Trail service worker',
      15000
    );
    const extensionId = new URL(loadedTargets.url).hostname;

    const initialUrl = `${baseUrl}/page.html?utm_source=e2e&igsh=secret&keep=1#top`;
    await navigate(cdp, initialUrl);
    const cleanedInitialUrl = `${baseUrl}/page.html?keep=1#top`;
    await waitForValue(() => cdp.evaluate('location.href'), (value) => value === cleanedInitialUrl, '初始網址清理');

    await cdp.evaluate(`history.pushState({}, '', '/page.html?gclid=e2e-spa&keep=2#demo')`);
    const cleanedSpaUrl = `${baseUrl}/page.html?keep=2#demo`;
    await waitForValue(() => cdp.evaluate('location.href'), (value) => value === cleanedSpaUrl, 'SPA pushState 清理');

    await navigate(cdp, `chrome-extension://${extensionId}/options.html`);
    await waitForValue(() => cdp.evaluate('document.querySelector("#rule-summary")?.textContent'), (value) => value && !value.includes('讀取中'), '設定頁初始化');
    await submitForm(cdp, '#rule-form', {
      '#rule-pattern': 'chrome_e2e_marker',
      '#rule-kind': 'exact'
    });
    await waitForValue(() => cdp.evaluate(deepTextScript()), (value) => value.includes('chrome_e2e_marker'), '自訂規則儲存');
    await submitForm(cdp, '#subscription-form', { '#subscription-url': `${baseUrl}/rules.json` });
    await waitForValue(
      () => cdp.evaluate(`chrome.storage.local.get('settings').then(({ settings }) =>
        settings?.subscriptions?.some((subscription) =>
          subscription.rules.some((rule) => rule.pattern === 'subscription_marker')))`),
      (value) => value === true,
      '訂閱規則同步'
    );

    await navigate(cdp, `${baseUrl}/page.html?chrome_e2e_marker=1&subscription_marker=1&keep=3`);
    const cleanedRulesUrl = `${baseUrl}/page.html?keep=3`;
    await waitForValue(() => cdp.evaluate('location.href'), (value) => value === cleanedRulesUrl, '自訂與訂閱規則清理');

    await navigate(cdp, `chrome-extension://${extensionId}/options.html`);
    await waitForValue(() => cdp.evaluate('document.querySelector("#rule-summary")?.textContent'), (value) => value && !value.includes('讀取中'), '暫停設定頁初始化');
    await cdp.evaluate(`document.querySelector('#global-pause').click()`);
    await waitForValue(() => cdp.evaluate('document.querySelector("#global-pause")?.checked'), (value) => value === true, '全域暫停');
    await waitForValue(
      () => cdp.evaluate(`chrome.storage.local.get('settings').then(({ settings }) => settings?.paused)`),
      (value) => value === true,
      '全域暫停儲存'
    );
    const pausedUrl = `${baseUrl}/page.html?utm_source=paused&keep=4`;
    await navigate(cdp, pausedUrl);
    await waitForValue(() => cdp.evaluate('location.href'), (value) => value === pausedUrl, '暫停時保留網址');
    await navigate(cdp, `chrome-extension://${extensionId}/options.html`);
    await waitForValue(() => cdp.evaluate('document.querySelector("#rule-summary")?.textContent'), (value) => value && !value.includes('讀取中'), '恢復清理設定頁初始化');
    await cdp.evaluate(`document.querySelector('#global-pause').click()`);
    await waitForValue(() => cdp.evaluate('document.querySelector("#global-pause")?.checked'), (value) => value === false, '恢復清理');
    await waitForValue(
      () => cdp.evaluate(`chrome.storage.local.get('settings').then(({ settings }) => settings?.paused)`),
      (value) => value === false,
      '恢復清理儲存'
    );

    const resumedRawUrl = `${baseUrl}/page.html?utm_source=resumed&keep=5`;
    await navigate(cdp, resumedRawUrl);
    await waitForValue(() => cdp.evaluate('location.href'), (value) => value === `${baseUrl}/page.html?keep=5`, '恢復後清理');
    await navigate(cdp, `chrome-extension://${extensionId}/options.html`);
    await waitForValue(() => cdp.evaluate('document.querySelector("#rule-summary")?.textContent'), (value) => value && !value.includes('讀取中'), '白名單設定頁初始化');
    await submitForm(cdp, '#whitelist-form', { '#whitelist-host': '127.0.0.1' });
    await waitForValue(() => cdp.evaluate(deepTextScript()), (value) => value.includes('127.0.0.1'), '白名單儲存');
    const whitelistedUrl = `${baseUrl}/page.html?utm_source=whitelisted&keep=6`;
    await navigate(cdp, whitelistedUrl);
    await waitForValue(() => cdp.evaluate('location.href'), (value) => value === whitelistedUrl, '白名單保留網址');

    await navigate(cdp, `chrome-extension://${extensionId}/options.html`);
    await waitForValue(() => cdp.evaluate('document.querySelector("#rule-summary")?.textContent'), (value) => value && !value.includes('讀取中'), '移除白名單設定頁初始化');
    await cdp.evaluate(`document.querySelector('#whitelist button')?.click()`);
    await waitForValue(
      () => cdp.evaluate(`chrome.storage.local.get('settings').then(({ settings }) => !settings?.whitelist?.includes('127.0.0.1'))`),
      (value) => value === true,
      '白名單移除'
    );
    const shortcutRawUrl = `${baseUrl}/page.html?utm_source=shortcut&keep=7`;
    await navigate(cdp, shortcutRawUrl);
    const shortcutCleanUrl = `${baseUrl}/page.html?keep=7`;
    await waitForValue(() => cdp.evaluate('location.href'), (value) => value === shortcutCleanUrl, '快捷鍵前置清理');
    await cdp.send('Page.bringToFront');
    const clipboard = await copyWithShortcut(xvfb.display);
    assert.equal(clipboard, shortcutCleanUrl, '快捷鍵複製結果不符');

    await navigate(cdp, 'chrome://extensions/');
    const finalCard = await waitForValue(() => cdp.evaluate(extensionCardScript()), (value) => value.found, '最終擴充功能卡片');
    assert.equal(finalCard.hasError, false, `Chrome 顯示擴充功能錯誤：${finalCard.text}`);

    console.log(JSON.stringify({
      browser: 'Google Chrome',
      chromePath,
      extensionId,
      initial: cleanedInitialUrl,
      spa: cleanedSpaUrl,
      rules: cleanedRulesUrl,
      paused: pausedUrl,
      whitelisted: whitelistedUrl,
      shortcut: clipboard,
      extensionError: finalCard.hasError
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    if (chrome) await stopProcess(chrome.processHandle, true);
    if (portal) await stopProcess(portal.processHandle);
    if (xvfb) await stopProcess(xvfb.processHandle);
    if (chrome?.profilePath) await rm(chrome.profilePath, { recursive: true, force: true });
    await stopServer(server);
  }
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDirectory, '..');
if (typeof WebSocket !== 'function') throw new Error('Browser checks require Node.js 22 or later.');
const browserPath = browserArgument();
const profileDirectory = await mkdtemp(path.join(tmpdir(), 'portable-markdown-editor-browser-check-'));
const browserErrors = [];
let browserProcess;
let connection;
let server;
let targetId;

async function main() {
  try {
    server = await startStaticServer();
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'browser check server did not expose a loopback port');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    browserProcess = launchBrowser();
    const websocketUrl = await waitForDevToolsWebSocket(browserProcess);
    connection = await CdpConnection.open(websocketUrl);
    ({ targetId } = await connection.send('Target.createTarget', { url: 'about:blank' }));
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
    await connection.send('Page.enable', {}, sessionId);
    await connection.send('Runtime.enable', {}, sessionId);
    await connection.send('Log.enable', {}, sessionId);
    connection.onEvent((message) => collectBrowserError(message, sessionId));

    await checkVendorSelfTest(baseUrl, sessionId);
    await checkImageAssets(baseUrl, sessionId);
    await checkMermaidVisuals(baseUrl, sessionId);
    await checkAppStartup(baseUrl, sessionId);

    assert.deepEqual(browserErrors, [], `browser console errors:\n${browserErrors.join('\n')}`);
    console.log(`browser checks passed (${path.basename(browserPath)})`);
  } finally {
    if (connection) {
      if (targetId) await connection.send('Target.closeTarget', { targetId }).catch(() => {});
      await connection.send('Browser.close').catch(() => {});
      connection.close();
    }
    if (browserProcess) await stopBrowserProcess(browserProcess);
    if (server) await new Promise((resolve) => server.close(resolve));
    await removeTemporaryProfile(profileDirectory);
  }
}

function browserArgument() {
  const index = process.argv.indexOf('--browser');
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (!value || !existsSync(value)) throw new Error('A valid --browser executable path is required.');
  return path.resolve(value);
}

function startStaticServer() {
  const contentTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.svg', 'image/svg+xml'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
    ['.ttf', 'font/ttf'],
  ]);
  const rootPrefix = `${repoRoot}${path.sep}`;
  const allowedFiles = new Set([
    'index.html',
    'app.js',
    'styles.css',
    'tests/browser-selftest.html',
    'tests/image-assets-browser-check.html',
    'tests/mermaid-advanced-visual-check.html',
  ]);
  const httpServer = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Method not allowed');
        return;
      }
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '').replaceAll('/', path.sep);
      const filePath = path.resolve(repoRoot, relative);
      const portableRelative = path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
      const allowed = allowedFiles.has(portableRelative)
        || portableRelative.startsWith('modules/')
        || portableRelative.startsWith('vendor/');
      if (!filePath.startsWith(rootPrefix) || !allowed || !(await stat(filePath)).isFile()) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Not found');
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      if (!response.headersSent) response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => resolve(httpServer));
  });
}

function launchBrowser() {
  const child = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-pings',
    '--remote-allow-origins=*',
    '--remote-debugging-port=0',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    child.browserCheckStderr = `${child.browserCheckStderr || ''}${chunk}`.slice(-20000);
  });
  return child;
}

async function waitForDevToolsWebSocket(child) {
  const activePortPath = path.join(profileDirectory, 'DevToolsActivePort');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`browser exited before DevTools startup: ${child.browserCheckStderr || ''}`);
    }
    try {
      const [port, websocketPath] = (await readFile(activePortPath, 'utf8')).trim().split(/\r?\n/);
      if (port && websocketPath) return `ws://127.0.0.1:${port}${websocketPath}`;
    } catch {
    }
    await delay(50);
  }
  throw new Error(`browser DevTools endpoint did not become ready: ${child.browserCheckStderr || ''}`);
}

async function navigate(url, sessionId) {
  const loaded = connection.waitForEvent('Page.loadEventFired', sessionId, 15000);
  const result = await connection.send('Page.navigate', { url }, sessionId);
  if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);
  await loaded;
}

async function evaluate(expression, sessionId) {
  const response = await connection.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'page evaluation failed');
  return response.result?.value;
}

async function poll(expression, predicate, sessionId, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let lastValue;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(expression, sessionId);
      if (predicate(lastValue)) return lastValue;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${label} timed out; last value=${JSON.stringify(lastValue)}${lastError ? `; ${lastError.message}` : ''}`);
}

async function checkVendorSelfTest(baseUrl, sessionId) {
  await navigate(`${baseUrl}/tests/browser-selftest.html`, sessionId);
  const result = await poll(
    `(() => ({ pass: document.querySelectorAll('#results li.pass').length, fail: document.querySelectorAll('#results li.fail').length }))()`,
    (value) => value?.pass + value?.fail >= 5,
    sessionId,
    'vendor browser self-test',
  );
  assert.deepEqual(result, { pass: 5, fail: 0 }, 'vendor browser self-test must pass every row');
}

async function checkImageAssets(baseUrl, sessionId) {
  await navigate(`${baseUrl}/tests/image-assets-browser-check.html`, sessionId);
  const result = await poll(
    `(() => { const result = document.getElementById('testResult'); return result ? { className: result.className, text: result.textContent } : null; })()`,
    (value) => value?.className === 'pass' || value?.className === 'fail',
    sessionId,
    'image assets browser check',
    30000,
  );
  assert.equal(result.className, 'pass', result.text);
  assert.match(result.text, /FSA directory handle restored/, 'image assets check must include reload restoration');
}

async function checkMermaidVisuals(baseUrl, sessionId) {
  await navigate(`${baseUrl}/tests/mermaid-advanced-visual-check.html`, sessionId);
  const result = await poll(
    `(() => ({ expected: typeof samples === 'undefined' ? 0 : samples.length, sections: document.querySelectorAll('section.sample').length, rendered: document.querySelectorAll('section.sample svg.mermaid-svg').length, errors: document.querySelectorAll('section.sample[data-error="true"]').length }))()`,
    (value) => value?.expected > 0 && value.sections === value.expected && value.rendered + value.errors === value.expected,
    sessionId,
    'Mermaid visual browser check',
    30000,
  );
  assert.equal(result.errors, 0, 'Mermaid visual browser check must render every sample');
  assert.equal(result.rendered, result.expected, 'Mermaid SVG count must match the sample count');
}

async function checkAppStartup(baseUrl, sessionId) {
  await navigate(`${baseUrl}/index.html`, sessionId);
  const result = await poll(
    `(() => ({ mode: document.body.dataset.mode || '', title: document.querySelector('h1')?.textContent || '', sourceReady: Boolean(document.querySelector('#sourceEditor + .cm-editor, .source-pane .cm-editor')) }))()`,
    (value) => Boolean(value?.mode && value.sourceReady),
    sessionId,
    'main browser UI startup',
  );
  assert.equal(result.title, 'Portable Markdown Editor');
  assert.match(result.mode, /^(?:rich|split|source|preview|focus)$/);

  const codeMarkdown = '# Code language check\n\n```js\nconst value = 1;\n```\n';
  await evaluate(
    `(() => { const source = document.getElementById('sourceEditor'); source.value = ${JSON.stringify(codeMarkdown)}; source.dispatchEvent(new Event('input', { bubbles: true })); return source.value; })()`,
    sessionId,
  );
  await clickSelector('[data-action="mode"][data-mode="rich"]', sessionId);
  await poll(
    `(() => ({ mode: document.body.dataset.mode || '', codeLanguageReady: Boolean(document.querySelector('.pme-code-language-input')) }))()`,
    (value) => value?.mode === 'rich' && value.codeLanguageReady,
    sessionId,
    'rich code language input startup',
  );
  await clickSelector('.pme-code-language-input', sessionId);
  await delay(50);
  const focusState = await evaluate(
    `(() => { const active = document.activeElement; return { matches: active?.matches('.pme-code-language-input') === true, tagName: active?.tagName || '', className: active?.className || '', id: active?.id || '' }; })()`,
    sessionId,
  );
  assert.equal(focusState.matches, true, `clicking the rich code language input must not move focus elsewhere: ${JSON.stringify(focusState)}`);

  await evaluate(
    `(() => { const input = document.querySelector('.pme-code-language-input'); input.setSelectionRange(0, input.value.length); return input.value; })()`,
    sessionId,
  );
  await connection.send('Input.insertText', { text: 'python' }, sessionId);
  const languageResult = await poll(
    `(() => ({ value: document.querySelector('.pme-code-language-input')?.value || '', markdown: document.getElementById('sourceEditor')?.value || '', listId: document.querySelector('.pme-code-language-input')?.list?.id || '' }))()`,
    (value) => value?.value === 'python' && value.markdown.includes('```python\n'),
    sessionId,
    'rich code language selection',
  );
  assert.equal(languageResult.listId, 'codeLanguageOptions', 'the rich code language input must retain its suggestion list');
}

async function clickSelector(selector, sessionId) {
  const point = await evaluate(
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; element.scrollIntoView({ block: 'center', inline: 'nearest' }); const rect = element.getBoundingClientRect(); const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, visible: rect.width > 0 && rect.height > 0, hitWithinTarget: Boolean(hit && (hit === element || element.contains(hit))), hitTagName: hit?.tagName || '', hitClassName: hit?.className || '' }; })()`,
    sessionId,
  );
  assert.ok(point?.visible, `browser click target is not visible: ${selector}`);
  assert.equal(point.hitWithinTarget, true, `browser click hit the wrong element for ${selector}: ${point.hitTagName}.${point.hitClassName}`);
  await connection.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  }, sessionId);
  await connection.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  }, sessionId);
}

function collectBrowserError(message, sessionId) {
  if (message.sessionId !== sessionId) return;
  if (message.method === 'Runtime.exceptionThrown') {
    browserErrors.push(message.params?.exceptionDetails?.text || 'uncaught browser exception');
  }
  if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
    const entry = message.params.entry;
    const text = entry.text || 'browser log error';
    const expectedHeadlessNavigationBlock = text.startsWith("Blocked attempt to show a 'beforeunload' confirmation panel");
    if (!String(entry.url || '').endsWith('/favicon.ico') && !expectedHeadlessNavigationBlock) browserErrors.push(text);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    browserErrors.push((message.params.args || []).map((item) => item.value || item.description || '').join(' '));
  }
}

async function stopBrowserProcess(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null) child.kill();
  await Promise.race([exited, delay(5000)]);
}

async function removeTemporaryProfile(directory) {
  const temporaryRoot = path.resolve(tmpdir()) + path.sep;
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith('portable-markdown-editor-browser-check-')) {
    throw new Error(`refusing to remove unexpected browser profile: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class CdpConnection {
  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CdpConnection(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Set();
    this.eventListeners = new Set();
    socket.addEventListener('message', (event) => this.handleMessage(JSON.parse(event.data)));
    socket.addEventListener('close', () => this.rejectPending(new Error('browser DevTools connection closed')));
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools command timed out: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify(message));
    });
  }

  waitForEvent(method, sessionId, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, resolve, reject };
      waiter.timer = setTimeout(() => {
        this.eventWaiters.delete(waiter);
        reject(new Error(`DevTools event timed out: ${method}`));
      }, timeout);
      this.eventWaiters.add(waiter);
    });
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
  }

  handleMessage(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.eventListeners) listener(message);
    for (const waiter of this.eventWaiters) {
      if (waiter.method !== message.method || waiter.sessionId !== message.sessionId) continue;
      clearTimeout(waiter.timer);
      this.eventWaiters.delete(waiter);
      waiter.resolve(message.params || {});
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.eventWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.eventWaiters.clear();
  }

  close() {
    this.socket.close();
  }
}

await main();

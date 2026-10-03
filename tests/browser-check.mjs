import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { blockedMarkdownLinks, blockedLinkUrls } from './link-policy-cases.mjs';

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
    await checkRichDropPolicy(sessionId);
    await checkInlineTableRendering(sessionId);
    await checkTableBudgets(sessionId);
    await checkLinkPolicy(sessionId);
    await checkCodeHighlightBudgets(sessionId);
    await checkMathRenderBudgets(sessionId);
    // Use a fresh tab so the dirty-document beforeunload guard remains enabled.
    await connection.send('Target.closeTarget', { targetId });
    ({ targetId } = await connection.send('Target.createTarget', { url: 'about:blank' }));
    const { sessionId: fileSessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
    await connection.send('Page.enable', {}, fileSessionId);
    await connection.send('Runtime.enable', {}, fileSessionId);
    await connection.send('Log.enable', {}, fileSessionId);
    connection.onEvent((message) => collectBrowserError(message, fileSessionId));
    await navigate(pathToFileURL(path.join(repoRoot, 'index.html')).href, fileSessionId);
    await poll(`Boolean(document.querySelector('.source-pane .cm-editor'))`, Boolean, fileSessionId, 'file app startup');
    await checkRichDropPolicy(fileSessionId);
    await checkInlineTableRendering(fileSessionId);
    await checkTableBudgets(fileSessionId);
    await checkLinkPolicy(fileSessionId);
    await checkCodeHighlightBudgets(fileSessionId);
    await checkMathRenderBudgets(fileSessionId);

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
    '--window-size=1440,1000',
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

  const codeMarkdown = '# Code language check\n\n```text\ndef hello(name):\n    return f"Hello {name}"\n```\n';
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
    `(() => { const code = document.querySelector('.pme-code-block code'); const keyword = code?.querySelector('.hljs-keyword'); return { value: document.querySelector('.pme-code-language-input')?.value || '', markdown: document.getElementById('sourceEditor')?.value || '', listId: document.querySelector('.pme-code-language-input')?.list?.id || '', codeClassName: code?.className || '', keywordText: keyword?.textContent || '', keywordColor: keyword ? getComputedStyle(keyword).color : '', codeColor: code ? getComputedStyle(code).color : '' }; })()`,
    (value) => value?.value === 'python' && value.markdown.includes('```python\n') && /(?:def|return)/.test(value.keywordText),
    sessionId,
    'rich code language selection',
  );
  assert.equal(languageResult.listId, 'codeLanguageOptions', 'the rich code language input must retain its suggestion list');
  assert.match(languageResult.codeClassName, /(?:^|\s)hljs(?:\s|$)/, 'the rich code block should use the Highlight.js theme');
  assert.notEqual(languageResult.keywordColor, languageResult.codeColor, 'the selected language should visibly highlight Python keywords');

  await checkReferenceDefinitionProtection(sessionId);
  await checkEmptyLinkProtection(sessionId);
  await checkUneditedRichSourcePreservation(sessionId);
  await checkRichInlineMathEditingAndHeading(sessionId);
  await checkRichInlineMathRoundTrips(sessionId);
  await checkRichTableMathEditing(sessionId);
  await checkRichChecklistEditing(sessionId);
  await checkRichStrikethroughEditing(sessionId);
  await checkSplitScrollSync(sessionId);
}

async function checkRichDropPolicy(sessionId) {
  const original = 'Drop here.\n\nKeep selection.';
  const paragraph = '#richEditor .ProseMirror p';
  const reset = async (markdown = original) => {
    await switchMode('source', sessionId);
    await setAppMarkdown(markdown, sessionId);
    await switchMode('rich', sessionId);
    await poll(`Boolean(document.querySelector('#richEditor .ProseMirror'))`, Boolean, sessionId, 'rich drop editor');
  };
  const assertCaptured = (result, label) => {
    assert.equal(result.capturePrevented, true, `${label}: root capture must cancel the drop before descendants receive it`);
    assert.equal(result.targetDrops, 0, `${label}: the ProseMirror or control drop handler must not receive the event`);
    assert.equal(result.bubbledDrops, 0, `${label}: the drop must not propagate beyond the rich root`);
  };

  for (const native of [false, true]) {
    for (const test of [
      { name: 'HTML plus plain', types: { 'text/html': '<p><strong>HTML PAYLOAD</strong></p>', 'text/plain': 'PLAIN PAYLOAD' }, text: 'PLAIN PAYLOAD' },
      { name: 'HTML only', types: { 'text/html': '<p><strong>HTML PAYLOAD</strong></p>' } },
      { name: 'URI only', types: { 'text/uri-list': 'https://example.com/drag-only' } },
      { name: 'literal HTML', types: { 'text/plain': '<b title="literal">literal</b>' }, text: '<b title="literal">literal</b>' },
      { name: 'multiline', types: { 'text/plain': 'first\r\nsecond\nthird' }, text: 'first\nsecond\nthird' },
    ]) {
      await reset();
      // A stale selection elsewhere must not determine where dropped text goes.
      await evaluate(`(() => {
        const last = document.querySelector('#richEditor .ProseMirror p:nth-child(2)');
        const range = document.createRange(); range.selectNodeContents(last); range.collapse(false);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      })()`, sessionId);
      const label = `${native ? 'native CDP' : 'synthetic'} ${test.name}`;
      const result = await dispatchRichDrop({ selector: paragraph, types: test.types, native }, sessionId);
      assertCaptured(result, label);
      assert.equal(result.trusted, native, `${label}: the native path must exercise a browser-generated drop`);
      assert.equal(result.richMarkup, 0, `${label}: dropped HTML must not create formatting or links`);
      if (test.text) {
        assert.equal(result.paragraphTexts[0], `${test.text}Drop here.`, `${label}: literal text must be inserted at the pointer`);
        assert.equal(result.paragraphTexts[1], 'Keep selection.', `${label}: the previous selection must remain intact`);
        assert.equal(result.breaks, test.name === 'multiline' ? 2 : 0, `${label}: line breaks must use ordinary hard breaks`);
        const afterDrop = result.markdown;
        await switchMode('source', sessionId);
        assert.equal(await evaluate(`document.getElementById('sourceEditor').value`, sessionId), afterDrop,
          `${label}: leaving rich mode must preserve the drop result`);
      } else {
        assert.equal(result.markdown, original, `${label}: unapproved representations must not change Markdown`);
        await switchMode('source', sessionId);
        assert.equal(await evaluate(`document.getElementById('sourceEditor').value`, sessionId), original,
          `${label}: leaving rich mode must preserve the exact original source`);
      }
    }
  }

  await reset();
  const markdownDrop = await dispatchRichDrop({ selector: paragraph, native: true,
    types: { 'text/plain': '**PLAIN MARKDOWN**', 'text/html': '<em>HTML ONLY MARKER</em>' } }, sessionId);
  assertCaptured(markdownDrop, 'plain Markdown normalization');
  assert.equal(markdownDrop.paragraphTexts[0], 'PLAIN MARKDOWNDrop here.',
    'plain text remains subject to the editor existing Markdown autoformatting');
  assert.match(markdownDrop.markdown, /^\*\*PLAIN MARKDOWN\*\*Drop here\./,
    'plain Markdown autoformatting must preserve its source syntax');
  assert.doesNotMatch(markdownDrop.markdown, /HTML ONLY MARKER/, 'HTML flavor must never contribute to plain Markdown normalization');

  for (const plain of ['', 'FILE FALLBACK']) {
    await reset();
    const result = await dispatchRichDrop({
      selector: paragraph,
      types: { 'text/html': '<strong>FILE HTML</strong>', ...(plain ? { 'text/plain': plain } : {}) },
      file: { name: 'unapproved.svg', type: 'image/svg+xml', contents: '<svg xmlns="http://www.w3.org/2000/svg" />' },
    }, sessionId);
    assertCaptured(result, 'disallowed file');
    assert.equal(result.paragraphTexts[0], `${plain}Drop here.`, 'a disallowed file may only fall back to plain text');
    assert.equal(result.richMarkup, 0, 'a disallowed file must not enter the DOM as an image or HTML');
    if (!plain) assert.equal(result.markdown, original, 'a disallowed file without plain text must preserve source');
  }

  await reset('```text\nexisting\n```');
  const code = await dispatchRichDrop({ selector: '#richEditor .ProseMirror pre code', types: { 'text/plain': '<b>code</b>\n**literal**\n' } }, sessionId);
  assertCaptured(code, 'code block');
  assert.equal(code.codeText, '<b>code</b>\n**literal**\nexisting', 'a code drop must retain literal characters and code newlines');
  assert.equal(code.breaks, 0, 'code-block newlines must not become hard-break nodes');

  await reset();
  const undoDrop = await dispatchRichDrop({ selector: paragraph, types: { 'text/plain': 'UNDO DROP' }, native: true }, sessionId);
  assertCaptured(undoDrop, 'undoable native drop');
  await checkRichDropBeforeInput(paragraph, sessionId);
  await pressShortcut({ key: 'z', code: 'KeyZ', modifiers: 2 }, sessionId);
  await poll(`document.getElementById('sourceEditor').value`, value => value === original, sessionId, 'one-step rich drop undo');

  await reset('COPY ME\n\nDrop here.');
  await evaluate(`(() => {
    const source = document.querySelector('#richEditor .ProseMirror p');
    const range = document.createRange(); range.selectNodeContents(source);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    source.closest('.ProseMirror').focus();
  })()`, sessionId);
  // ProseMirror receives selectionchange asynchronously before dragstart.
  await delay(100);
  const internal = await evaluate(`(() => {
    const source = document.querySelector('#richEditor .ProseMirror p');
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    window.__pmeInternalDrag = dataTransfer;
    return { plain: dataTransfer.getData('text/plain'), effectAllowed: dataTransfer.effectAllowed };
  })()`, sessionId);
  assert.equal(internal.plain, 'COPY ME', 'the internal-copy case must start with an actual ProseMirror drag payload');
  const copied = await dispatchRichDrop({ selector: '#richEditor .ProseMirror p:nth-child(2)', internal: true }, sessionId);
  assertCaptured(copied, 'internal drag');
  assert.deepEqual(copied.paragraphTexts.slice(0, 2), ['COPY ME', 'COPY MEDrop here.'],
    'dropping text within the same editor must copy it without removing the original selection');
  await evaluate(`(() => {
    document.querySelector('#richEditor .ProseMirror').dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    delete window.__pmeInternalDrag;
  })()`, sessionId);

  for (const coordinates of [{ x: -100, y: -100 }, { x: 0, y: 0 }]) {
    await reset();
    const result = await dispatchRichDrop({ selector: paragraph, types: { 'text/plain': 'OUTSIDE' }, coordinates }, sessionId);
    assertCaptured(result, 'outside coordinates');
    assert.equal(result.markdown, original, 'coordinates outside the editor must not insert at the previous selection');
  }
  await checkRichDropApiCoordinates(sessionId);
  await checkRichDropControls(sessionId, reset, assertCaptured);
  await reset();
  await checkRichDropBeforeInput('#richEditor .ProseMirror p', sessionId);

  const fallbackMarkdown = '[guide][ref]\n\n[ref]: #target\n';
  await switchMode('source', sessionId);
  await setAppMarkdown(fallbackMarkdown, sessionId);
  await switchMode('rich', sessionId);
  await poll(`document.getElementById('richEditor').getAttribute('aria-readonly')`, value => value === 'true', sessionId, 'drop read-only fallback');
  const fallback = await dispatchRichDrop({ selector: '#richEditor p', types: { 'text/plain': 'READONLY', 'text/html': '<strong>READONLY</strong>' } }, sessionId);
  assertCaptured(fallback, 'read-only fallback');
  assert.equal(fallback.markdown, fallbackMarkdown, 'read-only rich fallback must reject plain text drops too');
  await checkRichDropBeforeInput('#richEditor p', sessionId);
  await switchMode('source', sessionId);
  assert.equal(await evaluate(`document.getElementById('sourceEditor').value`, sessionId), fallbackMarkdown,
    'leaving fallback after blocked drops must preserve reference definitions byte-for-byte');
  console.log(`rich drop browser checks passed (${await evaluate('location.protocol', sessionId)}; synthetic and native CDP)`);
}

async function dispatchRichDrop(options, sessionId) {
  const point = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(options.selector)});
    if (!target) throw new Error('drop target missing');
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    const root = document.getElementById('richEditor');
    const probe = { capturePrevented: false, targetDrops: 0, bubbledDrops: 0, trusted: false };
    const capture = event => { probe.capturePrevented = event.defaultPrevented; probe.trusted = event.isTrusted; };
    const onTarget = () => { probe.targetDrops += 1; };
    const bubble = () => { probe.bubbledDrops += 1; };
    root.addEventListener('drop', capture, true);
    target.addEventListener('drop', onTarget);
    document.addEventListener('drop', bubble);
    window.__pmeDropProbe = { probe, cleanup() {
      root.removeEventListener('drop', capture, true); target.removeEventListener('drop', onTarget); document.removeEventListener('drop', bubble);
    } };
    return { x: rect.left + 1, y: rect.top + Math.min(rect.height / 2, 10) };
  })()`, sessionId);
  const coordinates = options.coordinates || point;
  if (options.native) {
    const data = { items: Object.entries(options.types || {}).map(([mimeType, data]) => ({ mimeType, data })), dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await connection.send('Input.dispatchDragEvent', { type, ...coordinates, data }, sessionId);
    }
  } else {
    await evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(options.selector)});
      const dataTransfer = ${options.internal ? 'window.__pmeInternalDrag' : 'new DataTransfer()'};
      for (const [type, value] of Object.entries(${JSON.stringify(options.types || {})})) dataTransfer.setData(type, value);
      const file = ${JSON.stringify(options.file || null)};
      if (file) dataTransfer.items.add(new File([file.contents], file.name, { type: file.type }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: ${coordinates.x}, clientY: ${coordinates.y} }));
    })()`, sessionId);
  }
  return evaluate(`(() => {
    const saved = window.__pmeDropProbe; saved.cleanup(); delete window.__pmeDropProbe;
    const root = document.getElementById('richEditor');
    const text = node => Array.from(node.childNodes, child => child.nodeName === 'BR' ? '\\n' : child.textContent).join('');
    return {
      ...saved.probe, markdown: document.getElementById('sourceEditor').value,
      paragraphTexts: Array.from(root.querySelectorAll('.ProseMirror > p'), text),
      richMarkup: root.querySelectorAll('strong, em, a, img, b, i').length,
      breaks: root.querySelectorAll('br:not(.ProseMirror-trailingBreak)').length,
      codeText: root.querySelector('pre code')?.textContent || '',
    };
  })()`, sessionId);
}

async function checkRichDropBeforeInput(selector, sessionId) {
  const result = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    const before = document.getElementById('sourceEditor').value;
    const valueBefore = target.value;
    const rootBefore = document.getElementById('richEditor').innerHTML;
    const prevented = [];
    for (const composing of [false, true]) {
      const dataTransfer = new DataTransfer(); dataTransfer.setData('text/plain', 'DUPLICATE'); dataTransfer.setData('text/html', '<strong>DUPLICATE</strong>');
      const event = new InputEvent('beforeinput', {
        inputType: 'insertFromDrop', data: 'DUPLICATE', dataTransfer,
        isComposing: composing, bubbles: true, cancelable: true,
      });
      target.dispatchEvent(event); prevented.push(event.defaultPrevented);
    }
    return { prevented, sourceUnchanged: before === document.getElementById('sourceEditor').value,
      valueUnchanged: target.value === valueBefore, domUnchanged: rootBefore === document.getElementById('richEditor').innerHTML };
  })()`, sessionId);
  assert.deepEqual(result, { prevented: [true, true], sourceUnchanged: true, valueUnchanged: true, domUnchanged: true },
    `insertFromDrop beforeinput must always cancel without applying or duplicating its payload: ${selector}`);
}

async function checkRichDropControls(sessionId, reset, assertCaptured) {
  await reset('```text\ncontent\n```');
  const inputSelector = '#richEditor .pme-code-language-input';
  await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(inputSelector)}); input.focus(); input.setSelectionRange(0, input.value.length); })()`, sessionId);
  const language = await dispatchRichDrop({ selector: inputSelector, types: { 'text/plain': 'javascript', 'text/html': '<strong>HTML LANGUAGE</strong>' } }, sessionId);
  assertCaptured(language, 'code language input');
  assert.match(language.markdown, /^```javascript\n/, 'plain drops into the language input must emit input and update the model');
  await checkRichDropBeforeInput(inputSelector, sessionId);

  // Math and other source popovers are portaled to body. This fixture checks the
  // root's textarea-descendant contract without moving those production controls.
  const textareaSelector = '#richEditor textarea[data-drop-check]';
  await evaluate(`(() => {
    const input = document.createElement('textarea'); input.dataset.dropCheck = 'true'; input.value = 'x+1';
    document.getElementById('richEditor').appendChild(input); input.focus(); input.setSelectionRange(2, 3);
    window.__pmeDropInputEvents = 0; input.addEventListener('input', () => { window.__pmeDropInputEvents += 1; });
  })()`, sessionId);
  const textarea = await dispatchRichDrop({ selector: textareaSelector, types: { 'text/plain': '2', 'text/html': '<strong>99</strong>' } }, sessionId);
  assertCaptured(textarea, 'rich textarea descendant');
  const updated = await evaluate(`({ value: document.querySelector(${JSON.stringify(textareaSelector)})?.value, inputs: window.__pmeDropInputEvents })`, sessionId);
  assert.equal(updated.value, 'x+2', 'the textarea drop must replace the selected range');
  assert.equal(updated.inputs, 1, 'the manual control insertion must emit exactly one input event');
  await checkRichDropBeforeInput(textareaSelector, sessionId);
  await evaluate(`(() => { document.querySelector(${JSON.stringify(textareaSelector)}).remove(); delete window.__pmeDropInputEvents; })()`, sessionId);
}

async function checkRichDropApiCoordinates(sessionId) {
  const result = await evaluate(`(() => {
    const mount = document.createElement('div'); document.body.appendChild(mount);
    const editor = window.PMEProseMirror.createRichMarkdownEditor({ mount, markdown: 'unchanged' });
    try {
      const doc = editor.view.state.doc;
      const results = [undefined, {}, { left: NaN, top: 1 }, { left: 1, top: Infinity }, { left: -100, top: -100 }]
        .map(point => editor.insertDroppedText('rejected', point));
      return { results, sameDocument: editor.view.state.doc === doc, markdown: editor.markdown() };
    } finally { editor.destroy(); mount.remove(); }
  })()`, sessionId);
  assert.deepEqual(result, { results: [false, false, false, false, false], sameDocument: true, markdown: 'unchanged' },
    'invalid and outside drop coordinates must fail closed without a document transaction');
}

async function checkInlineTableRendering(sessionId) {
  assert.equal(
    await evaluate(`typeof (window.markdownit || window.markdownIt)`, sessionId),
    'function',
    'table preview checks must run with the bundled Markdown renderer loaded',
  );
  await switchMode('source', sessionId);
  for (const count of [1000, 4097]) {
    const limited = count > 4096;
    const markdown = [
      '| 検証対象 | 後続セル |',
      '| --- | --- |',
      `| ${Array.from({ length: count }, (_, index) => `\`code-${index}\``).join(' ')} | **描画を継続** |`,
    ].join('\n');
    await setAppMarkdown(markdown, sessionId);
    await switchMode('split', sessionId);
    const result = await poll(
      `(() => {
        const cell = document.querySelector('#preview tbody tr:first-child td:first-child');
        const codes = cell?.querySelectorAll('code') || [];
        return {
          count: codes.length,
          first: codes[0]?.textContent || '',
          last: codes[codes.length - 1]?.textContent || '',
          notices: cell?.querySelectorAll('.inline-render-limit').length || 0,
          notice: cell?.querySelector('.inline-render-limit')?.textContent || '',
          following: document.querySelector('#preview tbody tr:first-child td:nth-child(2) strong')?.textContent || '',
          markdown: document.getElementById('sourceEditor')?.value || '',
        };
      })()`,
      (value) => value?.count === (limited ? 0 : count) && value.notices === (limited ? 1 : 0) && value.following === '描画を継続',
      sessionId,
      limited ? 'over-budget table-cell preview' : 'dense table-cell preview',
    );
    assert.equal(result.markdown, markdown, 'table preview rendering must preserve the complete Markdown source');
    if (limited) {
      assert.match(result.notice, /表示上限を超えたため/, 'an over-budget cell must explain why its preview was omitted');
      assert.match(result.notice, /原文はソース編集で確認できます/, 'the omission notice must identify where the original source is available');
    } else {
      assert.equal(result.first, 'code-0', 'dense table rendering must retain the first code span');
      assert.equal(result.last, 'code-999', 'dense table rendering must retain the last code span');
    }
    await switchMode('source', sessionId);
    assert.equal(
      await evaluate(`document.getElementById('sourceEditor')?.value || ''`, sessionId),
      markdown,
      'returning to source mode must retain every table-cell code span',
    );
  }
}

async function checkLinkPolicy(sessionId) {
  const markdown = [
    ...blockedMarkdownLinks.map((source) => `# ${source}`),
    '[approved](https://example.com/guide)',
    '[relative](guide.md)',
    '[anchor](#section)',
  ].join('\n\n');
  await switchMode('source', sessionId);
  await setAppMarkdown(markdown, sessionId);
  await switchMode('rich', sessionId);
  const inspect = `(() => {
    const base = new URL(document.baseURI);
    const links = [...document.querySelectorAll('#preview a[href], #richEditor a[href]')];
    return {
      unsafe: links.filter(link => {
        const url = new URL(link.href);
        return url.host !== base.host && url.hostname !== 'example.com';
      }).map(link => link.getAttribute('href')),
      approved: Boolean(document.querySelector('#richEditor a[href="https://example.com/guide"]')),
      relative: Boolean(document.querySelector('#richEditor a[href="guide.md"]')),
      anchor: Boolean(document.querySelector('#richEditor a[href="#section"]')),
      blocked: document.querySelectorAll('#richEditor a.blocked-link:not([href])').length
    };
  })()`;
  for (const allowed of [false, true, false]) {
    await clickSelector('[data-action="link-settings"]', sessionId);
    await evaluate(`document.getElementById('allowedDomainsInput').value = ${JSON.stringify(allowed ? 'example.com' : '')}`, sessionId);
    await clickSelector('[data-action="save-link-domains"]', sessionId);
    const result = await poll(inspect, value => value?.approved === allowed, sessionId, 'live link policy refresh');
    assert.deepEqual(result.unsafe, [], 'preview and rich DOM must not expose an unapproved authority');
    assert.equal(result.relative, true, 'relative rich links remain available');
    assert.equal(result.anchor, true, 'rich anchors remain available');
    assert.ok(result.blocked >= blockedMarkdownLinks.length, 'all malicious rich links must have no href');
    const opened = await evaluate(`(() => {
      const opened = [];
      const originalOpen = window.open;
      window.open = href => { opened.push(href); return null; };
      try {
        for (const link of document.querySelectorAll('#richEditor a')) {
          link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
        }
      } finally { window.open = originalOpen; }
      return opened;
    })()`, sessionId);
    assert.deepEqual(opened.sort(), (allowed ? ['#section', 'guide.md', 'https://example.com/guide'] : ['#section', 'guide.md']).sort(), 'Ctrl-click must recheck the current link policy');
  }

  const component = await evaluate(`(() => {
    const errors = [];
    const policy = { allowedLinkDomains: ['example.com'] };
    const renderer = window.PMEMarkdownRenderer.createMarkdownRenderer({ state: policy, els: {} });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const editor = window.PMEProseMirror.createRichMarkdownEditor({
      mount, markdown: '[label](guide.md)', resolveLinkHref: renderer.sanitizeLinkUrl
    });
    const linkType = editor.view.state.schema.marks.link;
    function setHref(href) {
      const tr = editor.view.state.tr.removeMark(1, 6, linkType).addMark(1, 6, linkType.create({ href }));
      editor.view.dispatch(tr);
    }
    function copyHtml() {
      const holder = document.createElement('div');
      const serializer = editor.view.someProp('clipboardSerializer');
      holder.appendChild(serializer.serializeFragment(editor.view.state.doc.content, { document }));
      return holder;
    }
    try {
      for (const href of ${JSON.stringify(blockedLinkUrls)}) {
        setHref(href);
        if (mount.querySelector('a[href]') || copyHtml().querySelector('a[href]')) errors.push('unsafe link: ' + href);
        if (editor.view.state.doc.firstChild.firstChild.marks[0].attrs.href !== href) errors.push('source changed: ' + href);
      }
      setHref('https://example.com/guide');
      if (!mount.querySelector('a[href]') || !copyHtml().querySelector('a[href]')) errors.push('allowed link missing');
      policy.allowedLinkDomains = [];
      editor.refreshLinks();
      if (mount.querySelector('a[href]') || copyHtml().querySelector('a[href]')) errors.push('revoked link retained');
      setHref('guide.md');
      if (copyHtml().querySelector('a')?.getAttribute('href') !== 'guide.md') errors.push('relative copy changed');
    } finally { editor.destroy(); mount.remove(); }
    return { errors, protocol: location.protocol };
  })()`, sessionId);
  assert.deepEqual(component.errors, [], 'rich URL edits and copy/drag serializer must use the canonical policy');
  await checkMermaidLinkPolicy(sessionId);
  console.log(`link policy browser checks passed (${component.protocol})`);
}

async function checkTableBudgets(sessionId) {
  const table = (columns, bodyRows, firstHeader = '<b>raw & source</b>') => [
    `|${[firstHeader, ...Array(columns - 1).fill('h')].join('|')}|`,
    `|${Array(columns).fill('---').join('|')}|`,
    ...Array(bodyRows).fill('|'),
  ].join('\n');
  const wide = table(128, 128);
  const cells = table(64, 64);
  const cases = [
    { name: 'wide sparse table', markdown: wide, raw: wide },
    { name: 'too many rows', markdown: table(2, 256), raw: table(2, 256) },
    { name: 'too many total cells', markdown: cells, raw: cells },
    { name: 'reference-definition vendor path', markdown: `[guide]: #guide\n${cells}`, raw: cells },
    {
      name: 'nested blockquote vendor path',
      markdown: ['> [guide]: #guide', '>', ...cells.split('\n').map(line => `> ${line}`)].join('\n'),
      raw: cells,
    },
    { name: 'math pipes in a wide header', markdown: table(65, 1, '$|x|$'), raw: table(65, 1, '$|x|$') },
  ];
  for (const test of cases) {
    const markdown = `${test.markdown}\n\n**After table budget**`;
    await switchMode('source', sessionId);
    await setAppMarkdown(markdown, sessionId);
    await switchMode('split', sessionId);
    await switchMode('rich', sessionId);
    const result = await poll(`(() => {
      const inspect = id => {
        const root = document.getElementById(id);
        const fallback = root.querySelector('pre.table-render-limit code');
        return {
          cells: root.querySelectorAll('th, td').length,
          nodes: root.querySelectorAll('*').length,
          fallback: fallback?.textContent || '',
          fallbackElements: fallback?.childElementCount ?? -1,
          following: root.querySelector('strong')?.textContent || '',
        };
      };
      const rich = document.getElementById('richEditor');
      return {
        preview: inspect('preview'), rich: inspect('richEditor'),
        reason: rich.dataset.richFallback || '',
        readOnly: rich.getAttribute('aria-readonly') || '',
        editable: Boolean(rich.querySelector('.ProseMirror, [contenteditable="true"]')),
        markdown: document.getElementById('sourceEditor').value,
      };
    })()`, value => value?.reason === 'table-render-limit' && value.preview.fallback && value.rich.fallback,
    sessionId, test.name);
    assert.equal(result.readOnly, 'true', `${test.name}: rich fallback must be read-only`);
    assert.equal(result.editable, false, `${test.name}: oversized tables must not enter an editable rich model`);
    assert.equal(result.markdown, markdown, `${test.name}: rendering must preserve the complete source`);
    for (const [name, root] of [['preview', result.preview], ['rich', result.rich]]) {
      assert.equal(root.cells, 0, `${test.name}: ${name} must not allocate padded table cells`);
      assert.ok(root.nodes < 100, `${test.name}: ${name} fallback DOM must remain bounded (${root.nodes})`);
      assert.equal(root.fallback.trimEnd(), test.raw, `${test.name}: ${name} must retain the complete table as text`);
      assert.equal(root.fallbackElements, 0, `${test.name}: ${name} table source must remain escaped plain text`);
      assert.equal(root.following, 'After table budget', `${test.name}: ${name} must render the following paragraph`);
    }
    for (const mode of ['preview', 'source']) {
      await switchMode(mode, sessionId);
      assert.equal(await evaluate(`document.getElementById('sourceEditor').value`, sessionId), markdown,
        `${test.name}: leaving read-only rich mode for ${mode} must preserve the exact source`);
    }
  }

  const ordinary = [
    '| Left | Center | Right |',
    '| :--- | :---: | ---: |',
    '| short |',
    '| a\\|b | $x+1$ | <b>literal</b> |',
  ].join('\n');
  await setAppMarkdown(ordinary, sessionId);
  await switchMode('rich', sessionId);
  const restored = await poll(`(() => {
    const inspect = id => {
      const root = document.getElementById(id);
      const rows = Array.from(root.querySelectorAll('table tr'));
      return {
        cells: root.querySelectorAll('th, td').length,
        rows: rows.map(row => Array.from(row.children, cell => cell.textContent)),
        alignments: Array.from(rows[0]?.children || [], cell => getComputedStyle(cell).textAlign),
        math: root.querySelectorAll('table .katex').length,
        limited: root.querySelectorAll('.table-render-limit').length,
      };
    };
    return {
      preview: inspect('preview'), rich: inspect('richEditor'),
      editable: Boolean(document.querySelector('#richEditor .ProseMirror')),
      reason: document.getElementById('richEditor').dataset.richFallback || '',
      protocol: location.protocol,
    };
  })()`, value => value?.editable && value.preview.cells === 9 && value.rich.cells === 9,
  sessionId, 'ordinary table after table limits');
  assert.equal(restored.reason, '', 'a normal table must recover editable rich mode after a limited document');
  for (const [name, root] of [['preview', restored.preview], ['rich', restored.rich]]) {
    assert.equal(root.limited, 0, `${name}: ordinary tables must not retain the previous limit notice`);
    assert.deepEqual(root.rows[1], ['short', '', ''], `${name}: ordinary short rows must still be padded`);
    assert.equal(root.rows[2][0], 'a|b', `${name}: escaped cell pipes must not create extra columns`);
    assert.equal(root.rows[2][2], '<b>literal</b>', `${name}: raw HTML in an ordinary table must remain text`);
    assert.deepEqual(root.alignments, ['left', 'center', 'right'], `${name}: cell alignment must remain intact`);
    assert.equal(root.math, 1, `${name}: ordinary table math must still render`);
  }
  await switchMode('source', sessionId);
  assert.equal(await evaluate(`document.getElementById('sourceEditor').value`, sessionId), ordinary,
    'entering and leaving an unedited normal table must preserve its exact source');
  await checkTableInsertionBudgets(wide, sessionId);
  console.log(`table budget browser checks passed (${restored.protocol})`);
}

async function checkTableInsertionBudgets(oversized, sessionId) {
  const original = 'Keep the existing source.';
  const ordinary = '| A | B |\n| --- | --- |\n| C | D |';
  await setAppMarkdown(original, sessionId);
  await switchMode('rich', sessionId);
  await clickSelector('#richEditor .ProseMirror p', sessionId);
  const paste = async markdown => evaluate(`(() => {
    const target = document.querySelector('#richEditor .ProseMirror');
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', ${JSON.stringify(markdown)});
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      markdown: document.getElementById('sourceEditor').value,
      status: document.getElementById('statusMessage').textContent,
      codeBlocks: target.querySelectorAll('pre').length,
      tables: target.querySelectorAll('table').length,
      cells: target.querySelectorAll('th, td').length,
    };
  })()`, sessionId);
  const rejected = await paste(oversized);
  assert.equal(rejected.prevented, true, 'an oversized table paste must prevent the browser default');
  assert.equal(rejected.markdown, original, 'rejecting an oversized table paste must preserve the exact source');
  assert.equal(rejected.codeBlocks, 0, 'a rejected table paste must not become a source-changing code block');
  assert.equal(rejected.tables, 0, 'a rejected table paste must not insert any table');
  assert.equal(rejected.status, '表の表示上限を超えているため挿入できません。ソース編集で貼り付けてください',
    'an oversized table paste must explain how to retain the input in source editing');
  await switchMode('source', sessionId);
  assert.equal(await evaluate(`document.getElementById('sourceEditor').value`, sessionId), original,
    'leaving rich mode after a rejected paste must preserve the original source');
  await switchMode('rich', sessionId);
  await clickSelector('#richEditor .ProseMirror p', sessionId);
  const accepted = await paste(ordinary);
  assert.equal(accepted.prevented, true, 'a normal Markdown table paste must use the editor paste handler');
  assert.equal(accepted.tables, 1, 'a normal table paste must remain supported after a rejected paste');
  assert.equal(accepted.cells, 4, 'a normal pasted table must retain its cells');
  assert.equal(accepted.codeBlocks, 0, 'a normal pasted table must not become a code block');
  assert.notEqual(accepted.markdown, original, 'a normal paste must update the Markdown source');
  assert.match(accepted.markdown, /\| A \| B \|/, 'a normal pasted table must be serialized as a table');

  const api = await evaluate(`(() => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const reasons = [];
    let changes = 0;
    const editor = window.PMEProseMirror.createRichMarkdownEditor({
      mount, markdown: ${JSON.stringify(original)},
      onChange() { changes += 1; },
      onUnsupportedMarkdown(reason) { reasons.push(reason); },
    });
    try {
      const before = editor.markdown();
      const documentBefore = editor.view.state.doc;
      const rejected = editor.insertMarkdown(${JSON.stringify(oversized)});
      const rejectedState = {
        result: rejected, unchanged: editor.markdown() === before && editor.view.state.doc === documentBefore,
        codeBlocks: mount.querySelectorAll('pre').length, tables: mount.querySelectorAll('table').length,
        changes, reasons: [...reasons],
      };
      const accepted = editor.insertMarkdown(${JSON.stringify(ordinary)});
      return {
        rejected: rejectedState, accepted, changes, reasons,
        markdown: editor.markdown(), tables: mount.querySelectorAll('table').length,
        cells: mount.querySelectorAll('th, td').length, codeBlocks: mount.querySelectorAll('pre').length,
      };
    } finally { editor.destroy(); mount.remove(); }
  })()`, sessionId);
  assert.deepEqual(api.rejected, {
    result: false, unchanged: true, codeBlocks: 0, tables: 0, changes: 0, reasons: ['table-render-limit'],
  }, 'insertMarkdown must reject oversized tables without a transaction or source change and notify the caller');
  assert.equal(api.accepted, true, 'insertMarkdown must continue accepting ordinary tables');
  assert.equal(api.tables, 1, 'the accepted API insertion must create one table');
  assert.equal(api.cells, 4, 'the accepted API insertion must retain all cells');
  assert.equal(api.codeBlocks, 0, 'the accepted API insertion must not create a fallback code block');
  assert.equal(api.changes, 1, 'only the accepted API insertion may notify a document change');
  assert.deepEqual(api.reasons, ['table-render-limit'], 'an ordinary insertion must not report a table limit');
  assert.match(api.markdown, /\| A \| B \|/, 'the accepted API insertion must remain table Markdown');
  await switchMode('source', sessionId);
}

async function checkMermaidLinkPolicy(sessionId) {
  const markdown = '```mermaid\nflowchart TD\nA-->B\nclick A href "https://example.com"\n```';
  await switchMode('source', sessionId);
  await setAppMarkdown(markdown, sessionId);
  await switchMode('rich', sessionId);
  for (const allowed of [true, false, true]) {
    await clickSelector('[data-action="link-settings"]', sessionId);
    await evaluate(`document.getElementById('allowedDomainsInput').value = ${JSON.stringify(allowed ? 'example.com' : '')}`, sessionId);
    await clickSelector('[data-action="save-link-domains"]', sessionId);
    await poll(`(() => ({
      ready: Boolean(document.querySelector('#richEditor svg a')),
      href: document.querySelector('#richEditor svg a')?.getAttribute('href') || ''
    }))()`, value => value?.ready && value.href === (allowed ? 'https://example.com/' : ''), sessionId, 'Mermaid link policy refresh');
    assert.equal(await evaluate(`document.getElementById('sourceEditor').value`, sessionId), markdown, 'policy changes must preserve Mermaid source');
  }
}

async function checkReferenceDefinitionProtection(sessionId) {
  const markdown = [
    'See [the guide][guide].',
    '',
    '[guide]: #guide "Guide"',
    '[unused]: #unused',
    '',
  ].join('\n');
  await switchMode('source', sessionId);
  await setAppMarkdown(markdown, sessionId);
  await switchMode('rich', sessionId);
  const fallback = await poll(
    `(() => ({
      reason: document.getElementById('richEditor')?.dataset.richFallback || '',
      readOnly: document.getElementById('richEditor')?.getAttribute('aria-readonly') || '',
      hasEditor: Boolean(document.querySelector('#richEditor .ProseMirror')),
      link: document.querySelector('#richEditor a')?.getAttribute('href') || '',
      status: document.getElementById('statusMessage')?.textContent || '',
      markdown: document.getElementById('sourceEditor')?.value || '',
    }))()`,
    (value) => value?.reason === 'link-reference-definitions' && value.readOnly === 'true',
    sessionId,
    'reference-definition rich fallback',
  );
  assert.equal(fallback.hasEditor, false, 'reference definitions must not enter the lossy ProseMirror editor');
  assert.equal(fallback.markdown, markdown, 'entering rich mode must not rewrite reference definitions');
  assert.equal(fallback.link, '#guide', 'read-only rich mode should still render reference links');
  assert.match(fallback.status, /参照リンク定義を保持するため/, 'the fallback status should explain why source editing is required');

  await switchMode('source', sessionId);
  assert.equal(
    await evaluate(`document.getElementById('sourceEditor')?.value || ''`, sessionId),
    markdown,
    'leaving read-only rich mode must preserve every reference definition',
  );
}

async function checkEmptyLinkProtection(sessionId) {
  const markdown = 'Before [](page.md) after';
  await switchMode('source', sessionId);
  await setAppMarkdown(markdown, sessionId);
  await switchMode('rich', sessionId);
  const fallback = await poll(
    `(() => ({
      reason: document.getElementById('richEditor')?.dataset.richFallback || '',
      hasEditor: Boolean(document.querySelector('#richEditor .ProseMirror')),
      markdown: document.getElementById('sourceEditor')?.value || '',
      status: document.getElementById('statusMessage')?.textContent || '',
    }))()`,
    (value) => value?.reason === 'empty-links',
    sessionId,
    'empty-link rich fallback',
  );
  assert.equal(fallback.hasEditor, false, 'empty links must not enter the lossy mark-only rich editor');
  assert.equal(fallback.markdown, markdown, 'empty-link fallback must preserve the exact Markdown source');
  assert.match(fallback.status, /表示テキストが空のリンクを保持するため/, 'empty-link fallback should explain why source editing is required');
  await switchMode('source', sessionId);
  assert.equal(await evaluate(`document.getElementById('sourceEditor')?.value || ''`, sessionId), markdown, 'leaving empty-link fallback must preserve the link');
}

async function checkUneditedRichSourcePreservation(sessionId) {
  const markdown = [
    'Setext heading',
    '--------------',
    '',
    'Tom &amp; Jerry',
    '',
    '+ one',
    '+ two',
    '',
    '~~~js',
    'const value = 1;',
    '~~~',
    '',
  ].join('\n');
  await switchMode('source', sessionId);
  await setAppMarkdown(markdown, sessionId);
  await switchMode('rich', sessionId);
  await poll(
    `(() => ({
      heading: document.querySelector('.ProseMirror h2')?.textContent || '',
      code: document.querySelector('.ProseMirror pre code')?.textContent || '',
      listItems: document.querySelectorAll('.ProseMirror ul > li').length,
    }))()`,
    (value) => value?.heading === 'Setext heading' && value.code.includes('const value = 1;') && value.listItems === 2,
    sessionId,
    'noncanonical Markdown rich rendering',
  );
  await switchMode('source', sessionId);
  assert.equal(
    await evaluate(`document.getElementById('sourceEditor')?.value || ''`, sessionId),
    markdown,
    'an unedited rich-mode visit must preserve source spelling and blank lines exactly',
  );
}

async function checkCodeHighlightBudgets(sessionId) {
  await switchMode('source', sessionId);
  await evaluate(`(() => {
    const originalHighlight = window.hljs.highlight;
    const originalAuto = window.hljs.highlightAuto;
    const probe = { calls: [], expected: [], markdown: '' };
    window.hljs.highlight = function(code, ...args) {
      probe.calls.push({ method: 'highlight', chars: code.length });
      // A regression must fail by call count without invoking costly vendor work.
      if (code.length > 120000) throw new Error('oversized explicit highlight reached vendor');
      return originalHighlight.call(this, code, ...args);
    };
    window.hljs.highlightAuto = function(code, ...args) {
      probe.calls.push({ method: 'highlightAuto', chars: code.length });
      if (code.length > 16000) throw new Error('oversized automatic highlight reached vendor');
      return originalAuto.call(this, code, ...args);
    };
    probe.restore = () => {
      window.hljs.highlight = originalHighlight;
      window.hljs.highlightAuto = originalAuto;
    };
    probe.inspect = () => {
      const inspectRoot = selector => {
        const codes = Array.from(document.querySelectorAll(selector + ' pre code'));
        return {
          count: codes.length,
          sourceMatches: codes.length === probe.expected.length
            && codes.every((code, index) => code.textContent === probe.expected[index]),
          images: codes.reduce((count, code) => count + code.querySelectorAll('img').length, 0),
          tokens: codes.reduce((count, code) => count + code.querySelectorAll('span').length, 0),
        };
      };
      return {
        preview: inspectRoot('#preview'), rich: inspectRoot('#richEditor'),
        sourceMatches: document.getElementById('sourceEditor').value === probe.markdown,
        fallback: document.getElementById('richEditor').classList.contains('is-prosemirror-fallback'),
        calls: probe.calls.slice(), protocol: location.protocol,
      };
    };
    window.__pmeCodeHighlightProbe = probe;
  })()`, sessionId);
  try {
    const literal = '<img src=x onerror="throw 1"> & literal ';
    const sizedCode = (length, label) => `${label} ${literal}`.padEnd(length, 'x');
    const oversized = [sizedCode(120001, 'explicit'), sizedCode(120001, 'unlabeled')];
    const automatic = [sizedCode(16001, 'unlabeled-auto'), sizedCode(16001, 'unknown-auto')];
    const fence = (language, code) => `\`\`\`${language}\n${code}\n\`\`\``;
    const cases = [
      ['oversized code', [fence('js', oversized[0]), fence('', oversized[1])].join('\n\n'), oversized, false],
      ['automatic detection limit', [fence('', automatic[0]), fence('pme-unknown-language', automatic[1])].join('\n\n'), automatic, false],
      ['read-only rich oversized code', `${fence('', oversized[1])}\n\n[highlight-probe]: #target`, [oversized[1]], true],
    ];
    for (const [label, markdown, expected, fallback] of cases) {
      await evaluate(`(() => {
        const probe = window.__pmeCodeHighlightProbe;
        probe.calls.length = 0;
        probe.expected = ${JSON.stringify(expected)};
        probe.markdown = ${JSON.stringify(markdown)};
      })()`, sessionId);
      await setAppMarkdown(markdown, sessionId);
      const result = await poll('window.__pmeCodeHighlightProbe.inspect()',
        value => value?.preview.sourceMatches && value.rich.sourceMatches && value.fallback === fallback,
        sessionId, label);
      assert.equal(result.sourceMatches, true, `${label} must preserve the complete Markdown source`);
      assert.deepEqual(result.calls, [], `${label} must stop before either Highlight.js entry point`);
      for (const [rootName, root] of [['preview', result.preview], ['rich', result.rich]]) {
        assert.equal(root.images, 0, `${label}: ${rootName} must escape source HTML`);
        assert.equal(root.tokens, 0, `${label}: ${rootName} must display plain code text`);
      }
    }

    const shortCode = 'const pmeSharedHighlightProbe = "<img src=x>";\nconsole.log(pmeSharedHighlightProbe);';
    const shortMarkdown = fence('javascript', shortCode);
    await evaluate(`(() => {
      const probe = window.__pmeCodeHighlightProbe;
      probe.calls.length = 0;
      probe.expected = [${JSON.stringify(shortCode)}];
      probe.markdown = ${JSON.stringify(shortMarkdown)};
    })()`, sessionId);
    await setAppMarkdown(shortMarkdown, sessionId);
    const short = await poll('window.__pmeCodeHighlightProbe.inspect()',
      value => value?.preview.sourceMatches && value.rich.sourceMatches
        && value.preview.tokens > 0 && value.rich.tokens > 0 && !value.fallback,
      sessionId, 'shared preview and rich code highlighting');
    assert.equal(short.sourceMatches, true, 'ordinary highlighted code must preserve its source');
    assert.deepEqual(short.calls, [{ method: 'highlight', chars: shortCode.length }],
      'preview and editable rich rendering must share one explicit Highlight.js result');
    assert.equal(short.preview.images + short.rich.images, 0, 'highlighted source HTML must remain literal');

    await evaluate(`window.__pmeCodeHighlightProbe.previousCode = document.querySelector('#preview pre code')`, sessionId);
    await setAppMarkdown(shortMarkdown, sessionId);
    await poll(`window.__pmeCodeHighlightProbe.previousCode !== document.querySelector('#preview pre code')`,
      Boolean, sessionId, 'repeat code preview rendering');
    await switchMode('rich', sessionId);
    await clickSelector('.pme-code-block code', sessionId);
    await pressKey({ key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 }, sessionId);
    const repeated = await evaluate('window.__pmeCodeHighlightProbe.inspect()', sessionId);
    assert.deepEqual(repeated.calls, short.calls, 'repeat renders and cursor movement must reuse highlighted code');
    assert.equal(repeated.sourceMatches && repeated.preview.sourceMatches && repeated.rich.sourceMatches, true,
      'repeat rendering and cursor movement must preserve all code text');
    console.log(`code highlight budget browser checks passed (${repeated.protocol})`);
  } finally {
    await evaluate(`(() => { window.__pmeCodeHighlightProbe.restore(); delete window.__pmeCodeHighlightProbe; })()`, sessionId);
  }
}

async function checkMathRenderBudgets(sessionId) {
  await switchMode('source', sessionId);
  await evaluate(`(() => {
    const originalString = window.katex.renderToString;
    const originalRender = window.katex.render;
    const probe = { stringCalls: 0, directCalls: 0 };
    window.katex.renderToString = function(...args) {
      probe.stringCalls += 1;
      return originalString.apply(this, args);
    };
    window.katex.render = function(...args) {
      probe.directCalls += 1;
      return originalRender.apply(this, args);
    };
    probe.restore = () => {
      window.katex.renderToString = originalString;
      window.katex.render = originalRender;
    };
    probe.inspect = root => {
      const atoms = Array.from(root.querySelectorAll('.pme-math-node'));
      // Source popovers retain detached KaTeX DOM before they are opened.
      const sourceEditors = atoms.map(atom => atom.pmViewDesc?.spec?.sourceEditor).filter(Boolean);
      const katexRoots = Array.from(root.querySelectorAll('.katex'));
      const hiddenRoots = sourceEditors.flatMap(editor => Array.from(editor.querySelectorAll('.katex')));
      let nodes = 0;
      for (const rendered of [...katexRoots, ...hiddenRoots]) {
        nodes += 1;
        const walker = document.createTreeWalker(rendered, NodeFilter.SHOW_ALL);
        while (walker.nextNode()) nodes += 1;
      }
      return {
        rendered: katexRoots.length, nodes, hiddenRendered: hiddenRoots.length,
        atoms: atoms.length, sourceEditors: sourceEditors.length,
        limited: root.querySelectorAll('.math-source, .pme-math-node.math-render-limit').length,
        sources: atoms.map(atom => atom.getAttribute('data-latex')),
      };
    };
    window.__pmeMathBudgetProbe = probe;
  })()`, sessionId);
  try {
    const markdown = '# 数式の表示上限\n\n' + '$x$'.repeat(600);
    await setAppMarkdown(markdown, sessionId);
    const large = await poll(`(() => {
      const probe = window.__pmeMathBudgetProbe;
      return {
        preview: probe.inspect(document.getElementById('preview')),
        rich: probe.inspect(document.getElementById('richEditor')),
        markdown: document.getElementById('sourceEditor').value,
        calls: probe.stringCalls, directCalls: probe.directCalls,
      };
    })()`, value => value?.rich.atoms === 600 && value.preview.rendered > 0, sessionId, 'bounded adjacent math rendering');
    assert.equal(large.markdown, markdown, 'math limits must retain the complete Markdown source');
    assert.deepEqual(large.rich.sources, Array(600).fill('x'), 'limited rich atoms must retain each original formula');
    assert.ok(large.calls <= 512, `two roots must bound aggregate KaTeX calls: ${large.calls}`);
    assert.equal(large.directCalls, 0, 'rich math must use the bounded string renderer before DOM insertion');
    for (const [name, root] of [['preview', large.preview], ['rich', large.rich]]) {
      assert.ok(root.rendered > 0 && root.rendered <= 256, `${name} must render a bounded number of formulas`);
      assert.ok(root.nodes <= 20000, `${name} KaTeX DOM including edit previews must stay bounded: ${root.nodes}`);
      assert.ok(root.limited > 0, `${name} must leave remaining math as source text`);
    }
    assert.equal(large.rich.sourceEditors, 600, 'node counts must inspect every detached rich source popover');
    assert.equal(large.rich.hiddenRendered, large.rich.rendered, 'both rich display copies must be included in the budget');

    const smallMarkdown = '# 通常の数式\n\n$x+1$ と $y+1$';
    await setAppMarkdown(smallMarkdown, sessionId);
    const small = await poll(`(() => {
      const probe = window.__pmeMathBudgetProbe;
      return {
        preview: probe.inspect(document.getElementById('preview')),
        rich: probe.inspect(document.getElementById('richEditor')),
        markdown: document.getElementById('sourceEditor').value,
      };
    })()`, value => value?.preview.rendered === 2 && value.rich.atoms === 2 && value.rich.rendered === 2, sessionId, 'math rendering after a limited document');
    assert.equal(small.markdown, smallMarkdown, 'returning to ordinary math must preserve its source');
    assert.equal(small.preview.limited + small.rich.limited, 0, 'new documents must receive fresh math budgets');

    const enhanced = await evaluate(`(() => {
      const probe = window.__pmeMathBudgetProbe;
      const renderer = window.PMEMarkdownRenderer.createMarkdownRenderer({
        state: { allowedLinkDomains: [] }, els: {},
        dependencies: { wrapRenderedInlineAtoms() {}, annotateRenderedInlineAtomRanges() {} },
      });
      const root = document.createElement('div');
      root.textContent = '$x$'.repeat(600);
      renderer.enhanceRenderedHtml(root);
      const first = probe.inspect(root);
      const calls = probe.stringCalls;
      const html = root.innerHTML;
      renderer.enhanceRenderedHtml(root);
      const repeat = probe.inspect(root);
      const repeatCalls = probe.stringCalls - calls;
      const unchangedHtml = html === root.innerHTML;
      renderer.safeSetHtml(root, '$y+1$');
      return {
        first, repeat, repeatCalls, unchangedHtml, reset: probe.inspect(root),
      };
    })()`, sessionId);
    assert.ok(enhanced.first.rendered > 0 && enhanced.first.rendered <= 256, 'raw DOM enhancement must bound the expression count');
    assert.ok(enhanced.first.nodes <= 20000, 'raw DOM enhancement must bound generated nodes');
    assert.equal(enhanced.repeat.rendered, enhanced.first.rendered, 'enhancing the same root twice must not render the unprocessed remainder');
    assert.equal(enhanced.repeat.nodes, enhanced.first.nodes, 'enhancing the same root twice must retain the DOM bound');
    assert.equal(enhanced.repeatCalls, 0, 'repeated enhancement must not invoke KaTeX again');
    assert.equal(enhanced.unchangedHtml, true, 'repeated enhancement must leave the escaped remainder unchanged');
    assert.equal(enhanced.reset.rendered, 1, 'replacing a root must reset its math budget');

    const reused = await evaluate(`(() => {
      const probe = window.__pmeMathBudgetProbe;
      const renderer = window.PMEMarkdownRenderer.createMarkdownRenderer({ state: { allowedLinkDomains: [] }, els: {} });
      const mount = document.createElement('div');
      document.body.appendChild(mount);
      const editor = window.PMEProseMirror.createRichMarkdownEditor({
        mount, markdown: '保留 $z$ 終了', createMathRenderSession: renderer.createMathRenderSession,
      });
      try {
        const original = mount.querySelector('.pme-math-node');
        const initialRendered = Boolean(original?.querySelector('.katex'));
        const { model, state } = window.PMEProseMirror.modules;
        const additions = Array.from({ length: 600 }, () => editor.view.state.schema.nodes.math_inline.create({ latex: 'x' }));
        const callsBefore = probe.stringCalls;
        editor.view.dispatch(editor.view.state.tr.insert(1, model.Fragment.fromArray(additions)));
        const limited = probe.inspect(mount);
        const retained = mount.contains(original);
        const oldNodeLimited = original.classList.contains('math-render-limit') && !original.querySelector('.katex');
        const callsAfterInsert = probe.stringCalls;
        const selection = state.TextSelection.create(editor.view.state.doc, 2);
        editor.view.dispatch(editor.view.state.tr.setSelection(selection));
        const selectionCalls = probe.stringCalls - callsAfterInsert;
        editor.view.dispatch(editor.view.state.tr.delete(1, 601));
        return {
          initialRendered, retained, oldNodeLimited, limited, selectionCalls,
          insertCalls: callsAfterInsert - callsBefore,
          restored: mount.contains(original) && Boolean(original.querySelector('.katex')),
          final: probe.inspect(mount), markdown: editor.markdown(), directCalls: probe.directCalls,
          protocol: location.protocol,
        };
      } finally { editor.destroy(); mount.remove(); }
    })()`, sessionId);
    assert.equal(reused.initialRendered, true, 'the retained rich formula must initially render');
    assert.equal(reused.retained, true, 'the budget update case must reuse the existing MathNodeView');
    assert.equal(reused.oldNodeLimited, true, 'an unchanged reused formula moved beyond the limit must drop stale KaTeX DOM');
    assert.ok(reused.limited.nodes <= 20000, 'rich transaction updates must also bound detached edit-preview DOM');
    assert.ok(reused.limited.rendered <= 256 && reused.insertCalls <= 256, 'rich insertion must use a document-wide math budget');
    assert.equal(reused.selectionCalls, 0, 'selection-only transactions must not render math again');
    assert.equal(reused.restored, true, 'removing excess math must restore the reused formula');
    assert.equal(reused.final.rendered, 1, 'the restored document should render its one formula');
    assert.equal(reused.final.limited, 0, 'restored rich views must clear their limit marker');
    assert.equal(reused.markdown, '保留 $z$ 終了', 'budget transitions must not alter the rich document');
    assert.equal(reused.directCalls, 0, 'every tested rich update must avoid unbounded direct rendering');
    console.log(`math budget browser checks passed (${reused.protocol})`);
  } finally {
    await evaluate(`(() => { window.__pmeMathBudgetProbe.restore(); delete window.__pmeMathBudgetProbe; })()`, sessionId);
  }
}

async function checkRichInlineMathEditingAndHeading(sessionId) {
  await setAppMarkdown('# 物理の見出し\n\n編集対象の前に本文があります。\n', sessionId);
  await switchMode('rich', sessionId);
  await poll(
    `(() => Boolean(document.querySelector('.ProseMirror h1')))()`,
    Boolean,
    sessionId,
    'rich heading startup',
  );
  await clickSelector('.ProseMirror h1', sessionId);
  await pressKey({ key: 'End', code: 'End', windowsVirtualKeyCode: 35 }, sessionId);
  await connection.send('Input.insertText', { text: ' ' }, sessionId);
  await pressShortcut({ key: 'm', code: 'KeyM', modifiers: 2 }, sessionId);
  const headingMath = await poll(
    `(() => ({
      markdown: document.getElementById('sourceEditor')?.value || '',
      richMath: Boolean(document.querySelector('.ProseMirror h1 .pme-math-node .katex')),
      previewMath: Boolean(document.querySelector('#preview h1 .math-inline .katex')),
    }))()`,
    (value) => value?.markdown.includes('# 物理の見出し $x$') && value.richMath && value.previewMath,
    sessionId,
    'math inside a heading',
  );
  assert.equal(headingMath.richMath, true, 'inline math inserted in a heading should render in rich mode');
  assert.equal(headingMath.previewMath, true, 'inline math inserted in a heading should render in preview mode');

  await clickSelector('.ProseMirror h1 .pme-math-node', sessionId);
  const editorLayout = await poll(
    `(() => {
      const target = document.querySelector('.ProseMirror h1 .pme-math-node');
      const rendered = target?.querySelector('.pme-node-rendered-preview');
      const editor = document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open');
      const editPreview = editor?.querySelector('.pme-inline-math-edit-preview');
      if (!target || !rendered || !editor || !editPreview) return null;
      const targetRect = target.getBoundingClientRect();
      const renderedRect = rendered.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      const editorStyle = getComputedStyle(editor);
      const renderedStyle = getComputedStyle(rendered);
      const targetStyle = getComputedStyle(target);
      return {
        targetRect: { left: targetRect.left, top: targetRect.top, right: targetRect.right, bottom: targetRect.bottom, width: targetRect.width, height: targetRect.height },
        renderedRect: { width: renderedRect.width, height: renderedRect.height },
        editorRect: { left: editorRect.left, top: editorRect.top, right: editorRect.right, bottom: editorRect.bottom, width: editorRect.width, height: editorRect.height },
        renderedDisplay: renderedStyle.display,
        editorBackground: editorStyle.backgroundColor,
        editorBorderStyle: editorStyle.borderStyle,
        targetOutlineStyle: targetStyle.outlineStyle,
        targetOutlineWidth: targetStyle.outlineWidth,
        inputLabel: editor.querySelector('.pme-node-source-editor-input')?.getAttribute('aria-label') || '',
        previewVisible: getComputedStyle(editPreview).display !== 'none' && editPreview.getBoundingClientRect().height > 0,
      };
    })()`,
    (value) => Boolean(value?.editorRect?.width && value?.previewVisible),
    sessionId,
    'inline math editor layout',
  );
  const verticallySeparated = editorLayout.editorRect.bottom <= editorLayout.targetRect.top - 4
    || editorLayout.editorRect.top >= editorLayout.targetRect.bottom + 4;
  assert.notEqual(editorLayout.renderedDisplay, 'none', 'the original rendered formula should remain visible while its source is edited');
  assert.ok(editorLayout.renderedRect.width > 0 && editorLayout.renderedRect.height > 0, 'the edited formula should remain identifiable in the heading');
  assert.equal(verticallySeparated, true, `the inline math editor must not overlap its rendered formula: ${JSON.stringify(editorLayout)}`);
  assert.doesNotMatch(editorLayout.editorBackground, /rgba?\([^)]*,\s*0(?:\.0+)?\)$/i, 'the inline math editor should have an opaque surface over surrounding body text');
  assert.notEqual(editorLayout.editorBorderStyle, 'none', 'the inline math editor should have a visible boundary');
  assert.notEqual(editorLayout.targetOutlineStyle, 'none', 'the formula being edited should have a visible target indicator');
  assert.notEqual(editorLayout.targetOutlineWidth, '0px', 'the formula target indicator should have a visible width');
  assert.equal(editorLayout.inputLabel, 'インライン数式のソース', 'the inline math source input should identify its purpose');

  await evaluate(
    `(() => {
      const input = document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open .pme-node-source-editor-input');
      input.focus();
      input.setSelectionRange(0, input.value.length);
      return input.value;
    })()`,
    sessionId,
  );
  await connection.send('Input.insertText', { text: 'F=ma' }, sessionId);
  await poll(
    `(() => ({
      markdown: document.getElementById('sourceEditor')?.value || '',
      preview: document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open .pme-inline-math-edit-preview')?.textContent || '',
    }))()`,
    (value) => value?.markdown.includes('# 物理の見出し $F=ma$') && value.preview.includes('F'),
    sessionId,
    'inline math live source editing',
  );
}

async function checkRichInlineMathRoundTrips(sessionId) {
  await setAppMarkdown('価格は $x$ です。', sessionId);
  await switchMode('rich', sessionId);
  await poll(
    `document.querySelector('.ProseMirror .pme-math-node')?.getAttribute('data-latex') || ''`,
    (value) => value === 'x',
    sessionId,
    'inline math round-trip startup',
  );

  await clickSelector('.ProseMirror .pme-math-node', sessionId);
  await evaluate(
    `(() => { const input = document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open .pme-node-source-editor-input'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); return input.value; })()`,
    sessionId,
  );
  await connection.send('Input.insertText', { text: '+1' }, sessionId);
  await poll(
    `document.getElementById('sourceEditor')?.value || ''`,
    (value) => value === '価格は $x+1$ です。',
    sessionId,
    'partial inline math edit',
  );

  await evaluate(
    `(() => { const input = document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open .pme-node-source-editor-input'); input.setSelectionRange(input.value.length, input.value.length); return input.value; })()`,
    sessionId,
  );
  await connection.send('Input.insertText', { text: '$' }, sessionId);
  const escapedDollarMarkdown = String.raw`価格は $x+1\$$ です。`;
  const escapedDollarLatex = String.raw`x+1\$`;
  const escapedDollarState = await poll(
    `(() => ({
      input: document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open .pme-node-source-editor-input')?.value || '',
      latex: document.querySelector('.ProseMirror .pme-math-node')?.getAttribute('data-latex') || '',
      markdown: document.getElementById('sourceEditor')?.value || '',
    }))()`,
    (value) => value?.input === escapedDollarLatex && value.latex === escapedDollarLatex && value.markdown === escapedDollarMarkdown,
    sessionId,
    'literal dollar inside inline math',
  );
  assert.equal(escapedDollarState.input, escapedDollarLatex, 'an unescaped dollar typed in the formula editor should become a single escaped literal');

  await switchMode('source', sessionId);
  assert.equal(await evaluate(`document.getElementById('sourceEditor')?.value || ''`, sessionId), escapedDollarMarkdown, 'switching away from rich mode should preserve escaped-dollar math');
  await switchMode('rich', sessionId);
  await poll(
    `document.querySelector('.ProseMirror .pme-math-node')?.getAttribute('data-latex') || ''`,
    (value) => value === escapedDollarLatex,
    sessionId,
    'escaped-dollar math after mode switch',
  );

  await clickSelector('.ProseMirror .pme-math-node', sessionId);
  await evaluate(
    `(() => { const input = document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open .pme-node-source-editor-input'); input.setSelectionRange(0, 0); return input.value; })()`,
    sessionId,
  );
  await pressKey({ key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, sessionId);
  const boundaryState = await poll(
    `(() => ({
      markdown: document.getElementById('sourceEditor')?.value || '',
      latex: document.querySelector('.ProseMirror .pme-math-node')?.getAttribute('data-latex') || '',
      editorOpen: Boolean(document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open')),
    }))()`,
    (value) => value?.markdown === escapedDollarMarkdown && value.latex === escapedDollarLatex && !value.editorOpen,
    sessionId,
    'inline math Backspace boundary',
  );
  assert.equal(boundaryState.markdown, escapedDollarMarkdown, 'Backspace at the start of formula content should exit without deleting the whole formula');

  await clickSelector('.ProseMirror .pme-math-node', sessionId);
  await evaluate(
    `(() => { const input = document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open .pme-node-source-editor-input'); input.setSelectionRange(0, input.value.length); return input.value; })()`,
    sessionId,
  );
  await pressKey({ key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, sessionId);
  const emptyMathMarkdown = String.raw`価格は \(\) です。`;
  const emptyMathState = await poll(
    `(() => {
      const node = document.querySelector('.ProseMirror .pme-math-node');
      const editor = document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open');
      const before = editor?.querySelector('.pme-inline-source-token--before')?.textContent || '';
      const after = editor?.querySelector('.pme-inline-source-token--after')?.textContent || '';
      const placeholder = node?.querySelector('.pme-node-rendered-preview');
      return {
        markdown: document.getElementById('sourceEditor')?.value || '',
        latex: node?.getAttribute('data-latex') ?? null,
        before,
        after,
        placeholder: placeholder ? getComputedStyle(placeholder, '::before').content : '',
      };
    })()`,
    (value) => value?.markdown === emptyMathMarkdown && value.latex === '' && value.before === '\\(' && value.after === '\\)',
    sessionId,
    'empty inline math normalization',
  );
  assert.match(emptyMathState.placeholder, /空の数式/, 'an empty inline formula should remain visible and selectable in rich mode');
  assert.doesNotMatch(emptyMathState.markdown, /\$\$/, 'empty inline math must not turn into display-math delimiters');

  await switchMode('source', sessionId);
  assert.equal(await evaluate(`document.getElementById('sourceEditor')?.value || ''`, sessionId), emptyMathMarkdown, 'empty inline math should remain stable outside rich mode');
  await switchMode('rich', sessionId);
  await poll(
    `(() => ({ count: document.querySelectorAll('.ProseMirror .pme-math-node').length, latex: document.querySelector('.ProseMirror .pme-math-node')?.getAttribute('data-latex') ?? null }))()`,
    (value) => value?.count === 1 && value.latex === '',
    sessionId,
    'empty inline math after mode switch',
  );

  await clickSelector('.ProseMirror .pme-math-node', sessionId);
  await connection.send('Input.insertText', { text: 'z' }, sessionId);
  await poll(
    `document.getElementById('sourceEditor')?.value || ''`,
    (value) => value === '価格は $z$ です。',
    sessionId,
    'resume editing empty inline math',
  );
  await pressKey({ key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, sessionId);
  await connection.send('Input.insertText', { text: '$' }, sessionId);
  const adjacentDollarMarkdown = String.raw`価格は \(z\)$ です。`;
  await poll(
    `(() => ({ markdown: document.getElementById('sourceEditor')?.value || '', mathCount: document.querySelectorAll('.ProseMirror .pme-math-node').length, latex: document.querySelector('.ProseMirror .pme-math-node')?.getAttribute('data-latex') || '' }))()`,
    (value) => value?.markdown === adjacentDollarMarkdown && value.mathCount === 1 && value.latex === 'z',
    sessionId,
    'literal dollar adjacent to inline math',
  );
  await switchMode('source', sessionId);
  assert.equal(await evaluate(`document.getElementById('sourceEditor')?.value || ''`, sessionId), adjacentDollarMarkdown, 'an adjacent literal dollar should retain a distinct formula during mode switching');
  await switchMode('rich', sessionId);
  await poll(
    `(() => ({ count: document.querySelectorAll('.ProseMirror .pme-math-node').length, latex: document.querySelector('.ProseMirror .pme-math-node')?.getAttribute('data-latex') || '' }))()`,
    (value) => value?.count === 1 && value.latex === 'z',
    sessionId,
    'adjacent literal dollar after mode switch',
  );

  await setAppMarkdown('隣接: $x$$y$', sessionId);
  await switchMode('rich', sessionId);
  await poll(
    `document.querySelectorAll('.ProseMirror .pme-math-node').length`,
    (value) => value === 2,
    sessionId,
    'adjacent inline formulas',
  );
  await switchMode('source', sessionId);
  assert.equal(
    await evaluate(`document.getElementById('sourceEditor')?.value || ''`, sessionId),
    String.raw`隣接: \(x\)\(y\)`,
    'adjacent formulas should keep separate unambiguous delimiters after leaving rich mode',
  );
}

async function checkRichTableMathEditing(sessionId) {
  await setAppMarkdown([
    '| 種別 | 数式 |',
    '| --- | --- |',
    '| エネルギー | $E=mc^2$ |',
    '| 絶対値 | $|x|$ |',
    '| 追加 | 値 |',
  ].join('\n'), sessionId);
  await switchMode('rich', sessionId);
  const loadedMath = await poll(
    `(() => ({
      richCount: document.querySelectorAll('.ProseMirror table .pme-math-node .katex').length,
      previewCount: document.querySelectorAll('#preview table .math-inline .katex').length,
      absoluteSource: document.querySelector('.ProseMirror tbody tr:nth-child(3) td:nth-child(2) .pme-math-node')?.getAttribute('data-latex') || '',
    }))()`,
    (value) => value?.richCount === 2 && value.previewCount === 2 && value.absoluteSource === '|x|',
    sessionId,
    'table-cell math startup',
  );
  assert.equal(loadedMath.absoluteSource, '|x|', 'formula pipes inside a table cell should remain LaTeX content');

  await clickSelector('.ProseMirror tbody tr:nth-child(4) td:nth-child(2)', sessionId);
  await pressKey({ key: 'End', code: 'End', windowsVirtualKeyCode: 35 }, sessionId);
  await connection.send('Input.insertText', { text: ' ' }, sessionId);
  await pressShortcut({ key: 'm', code: 'KeyM', modifiers: 2 }, sessionId);
  await poll(
    `(() => ({
      markdown: document.getElementById('sourceEditor')?.value || '',
      richCount: document.querySelectorAll('.ProseMirror table .pme-math-node .katex').length,
      previewCount: document.querySelectorAll('#preview table .math-inline .katex').length,
    }))()`,
    (value) => value?.richCount === 3 && value.previewCount === 3 && value.markdown.includes('| 追加 | 値 $x$ |'),
    sessionId,
    'table-cell math shortcut insertion',
  );

  await clickSelector('.ProseMirror tbody tr:nth-child(3) td:nth-child(2) .pme-math-node', sessionId);
  const sourceValue = await poll(
    `document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open .pme-node-source-editor-input')?.value || ''`,
    (value) => value === '|x|',
    sessionId,
    'table-cell math source editor',
  );
  assert.equal(sourceValue, '|x|', 'table-cell math editor should show the original LaTeX pipe characters');

  await evaluate(
    `(() => {
      const input = document.querySelector('.pme-node-source-editor--math-inline.is-source-popover-open .pme-node-source-editor-input');
      input.focus();
      input.setSelectionRange(0, input.value.length);
      return input.value;
    })()`,
    sessionId,
  );
  await connection.send('Input.insertText', { text: 'P(A|B)' }, sessionId);
  await poll(
    `(() => ({
      markdown: document.getElementById('sourceEditor')?.value || '',
      previewSource: document.querySelector('#preview tbody tr:nth-child(2) td:nth-child(2) .math-inline')?.getAttribute('data-math-source') || '',
    }))()`,
    (value) => value?.markdown.includes('$P(A\\|B)$') && value.previewSource === 'P(A|B)',
    sessionId,
    'table-cell math source round trip',
  );
}

async function checkRichChecklistEditing(sessionId) {
  await setAppMarkdown('', sessionId);
  await switchMode('rich', sessionId);
  await poll(
    `(() => Boolean(document.querySelector('.ProseMirror p')))()`,
    Boolean,
    sessionId,
    'empty rich paragraph startup',
  );
  await clickSelector('.ProseMirror p', sessionId);
  for (const text of ['-', ' ', '[', ' ', ']', ' ', '入力項目']) {
    await connection.send('Input.insertText', { text }, sessionId);
  }
  const typedChecklist = await poll(
    `(() => ({ markdown: document.getElementById('sourceEditor')?.value || '', checkbox: Boolean(document.querySelector('.ProseMirror .pme-task-checkbox')), text: document.querySelector('.ProseMirror li')?.textContent || '' }))()`,
    (value) => value?.checkbox && value.markdown.includes('- [ ] 入力項目'),
    sessionId,
    'typed rich checklist conversion',
  );
  assert.match(typedChecklist.text, /入力項目/, 'typed checklist content should remain editable');

  await setAppMarkdown('ボタン項目\n', sessionId);
  await switchMode('rich', sessionId);
  await clickSelector('.ProseMirror p', sessionId);
  await clickSelector('[data-action="format"][data-format="checklist"]', sessionId);
  await poll(
    `(() => ({ markdown: document.getElementById('sourceEditor')?.value || '', checkbox: Boolean(document.querySelector('.ProseMirror .pme-task-checkbox')) }))()`,
    (value) => value?.checkbox && value.markdown.includes('- [ ] ボタン項目'),
    sessionId,
    'rich checklist toolbar insertion',
  );

  await setAppMarkdown('ショートカット項目\n', sessionId);
  await switchMode('rich', sessionId);
  await clickSelector('.ProseMirror p', sessionId);
  await pressShortcut({ key: 'c', code: 'KeyC', modifiers: 3 }, sessionId);
  await poll(
    `(() => ({ markdown: document.getElementById('sourceEditor')?.value || '', checkbox: Boolean(document.querySelector('.ProseMirror .pme-task-checkbox')) }))()`,
    (value) => value?.checkbox && value.markdown.includes('- [ ] ショートカット項目'),
    sessionId,
    'rich checklist keyboard insertion',
  );
}

async function checkRichStrikethroughEditing(sessionId) {
  const existingMarkdown = '既存の ~~削除対象~~ です。';
  await switchMode('source', sessionId);
  await setAppMarkdown(existingMarkdown, sessionId);
  await switchMode('rich', sessionId);
  const existing = await poll(
    `(() => ({
      rich: document.querySelector('.ProseMirror del')?.textContent || '',
      preview: document.querySelector('#preview del')?.textContent || '',
      markdown: document.getElementById('sourceEditor')?.value || '',
    }))()`,
    (value) => value?.rich === '削除対象' && value.preview === '削除対象',
    sessionId,
    'existing rich strikethrough',
  );
  assert.equal(existing.markdown, existingMarkdown, 'loading strikethrough in rich mode must not escape away its Markdown meaning');

  await switchMode('source', sessionId);
  assert.equal(
    await evaluate(`document.getElementById('sourceEditor')?.value || ''`, sessionId),
    existingMarkdown,
    'switching away from rich mode should preserve strikethrough delimiters',
  );

  await setAppMarkdown('ボタン対象', sessionId);
  await switchMode('rich', sessionId);
  await clickSelector('.ProseMirror p', sessionId);
  await pressShortcut({ key: 'a', code: 'KeyA', modifiers: 2 }, sessionId);
  await clickSelector('[data-action="format"][data-format="strikethrough"]', sessionId);
  await poll(
    `(() => ({ markdown: document.getElementById('sourceEditor')?.value || '', text: document.querySelector('.ProseMirror del')?.textContent || '' }))()`,
    (value) => value?.markdown === '~~ボタン対象~~' && value.text === 'ボタン対象',
    sessionId,
    'rich strikethrough toolbar action',
  );

  await switchMode('source', sessionId);
  await setAppMarkdown('ショートカット対象', sessionId);
  await switchMode('rich', sessionId);
  await clickSelector('.ProseMirror p', sessionId);
  await pressShortcut({ key: 'a', code: 'KeyA', modifiers: 2 }, sessionId);
  await pressShortcut({ key: 'x', code: 'KeyX', modifiers: 10 }, sessionId);
  await poll(
    `(() => ({ markdown: document.getElementById('sourceEditor')?.value || '', text: document.querySelector('.ProseMirror del')?.textContent || '' }))()`,
    (value) => value?.markdown === '~~ショートカット対象~~' && value.text === 'ショートカット対象',
    sessionId,
    'rich strikethrough keyboard action',
  );
}

async function checkSplitScrollSync(sessionId) {
  const paragraphTail = ' 折り返し位置を検証するための長い本文です。'.repeat(24);
  const markdown = Array.from({ length: 36 }, (_, index) => `section-${String(index + 1).padStart(2, '0')}${paragraphTail}`).join('\n\n');
  await setAppMarkdown(markdown, sessionId);
  await switchMode('rich', sessionId);
  await switchMode('split', sessionId);
  await poll(
    `(() => { const source = document.querySelector('.source-codemirror .cm-scroller'); const preview = document.getElementById('preview'); return { sourceReady: Boolean(source), previewReady: Boolean(preview), sourceHeight: source?.scrollHeight || 0, sourceClient: source?.clientHeight || 0, previewHeight: preview?.scrollHeight || 0, previewClient: preview?.clientHeight || 0, blocks: preview?.querySelectorAll('[data-source-start][data-source-end]').length || 0, markdownLength: document.getElementById('sourceEditor')?.value.length || 0 }; })()`,
    (value) => value?.sourceReady && value.previewReady && value.sourceHeight > value.sourceClient && value.previewHeight > value.previewClient && value.blocks >= 36,
    sessionId,
    'split scroll fixtures',
  );

  await evaluate(
    `(() => { const source = document.querySelector('.source-codemirror .cm-scroller'); source.scrollTop = (source.scrollHeight - source.clientHeight) * 0.48; source.dispatchEvent(new Event('scroll')); return source.scrollTop; })()`,
    sessionId,
  );
  const sourceToPreview = await poll(
    splitScrollMarkerExpression(),
    (value) => value?.sourceMarker > 0 && value.previewMarker > 0 && Math.abs(value.sourceMarker - value.previewMarker) <= 1,
    sessionId,
    'source-to-preview semantic scroll sync',
  );
  assert.ok(Math.abs(sourceToPreview.sourceMarker - sourceToPreview.previewMarker) <= 1, `source-to-preview markers should align: ${JSON.stringify(sourceToPreview)}`);

  await delay(100);
  await evaluate(
    `(() => { const preview = document.getElementById('preview'); preview.scrollTop = (preview.scrollHeight - preview.clientHeight) * 0.72; preview.dispatchEvent(new Event('scroll')); return preview.scrollTop; })()`,
    sessionId,
  );
  const previewToSource = await poll(
    splitScrollMarkerExpression(),
    (value) => value?.sourceMarker > 0 && value.previewMarker > 0 && Math.abs(value.sourceMarker - value.previewMarker) <= 1,
    sessionId,
    'preview-to-source semantic scroll sync',
  );
  assert.ok(Math.abs(previewToSource.sourceMarker - previewToSource.previewMarker) <= 1, `preview-to-source markers should align: ${JSON.stringify(previewToSource)}`);
}

function splitScrollMarkerExpression() {
  return `(() => {
    const marker = (value) => Number(/section-(\\d+)/.exec(value || '')?.[1] || 0);
    const source = document.querySelector('.source-codemirror .cm-scroller');
    const preview = document.getElementById('preview');
    if (!source || !preview) return null;
    const sourceY = source.getBoundingClientRect().top + Math.min(72, Math.max(16, source.clientHeight * 0.12));
    const sourceLines = Array.from(source.querySelectorAll('.cm-line')).filter((line) => marker(line.textContent));
    const sourceLine = sourceLines.reduce((best, line) => {
      const rect = line.getBoundingClientRect();
      const distance = sourceY < rect.top ? rect.top - sourceY : sourceY > rect.bottom ? sourceY - rect.bottom : 0;
      return !best || distance < best.distance ? { line, distance } : best;
    }, null)?.line;
    const previewY = preview.getBoundingClientRect().top + Math.min(72, Math.max(16, preview.clientHeight * 0.12));
    const blocks = Array.from(preview.querySelectorAll('[data-source-start][data-source-end]'));
    let previewBlock = blocks[0] || null;
    for (const block of blocks) {
      previewBlock = block;
      if (block.getBoundingClientRect().bottom >= previewY) break;
    }
    return {
      sourceMarker: marker(sourceLine?.textContent),
      previewMarker: marker(previewBlock?.textContent),
      sourceTop: source.scrollTop,
      previewTop: preview.scrollTop,
    };
  })()`;
}

async function setAppMarkdown(markdown, sessionId) {
  await evaluate(
    `(() => { const source = document.getElementById('sourceEditor'); source.value = ${JSON.stringify(markdown)}; source.dispatchEvent(new Event('input', { bubbles: true })); return source.value; })()`,
    sessionId,
  );
}

async function switchMode(mode, sessionId) {
  await clickSelector(`[data-action="mode"][data-mode="${mode}"]`, sessionId);
  await poll(`document.body.dataset.mode || ''`, (value) => value === mode, sessionId, `${mode} mode startup`);
}

async function pressShortcut({ key, code, modifiers }, sessionId) {
  await pressKey({
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
  }, sessionId);
}

async function pressKey({ key, code, modifiers = 0, windowsVirtualKeyCode = 0 }, sessionId) {
  await connection.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode,
  }, sessionId);
  await connection.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode,
  }, sessionId);
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

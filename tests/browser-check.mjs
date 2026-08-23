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

  await checkRichInlineMathEditingAndHeading(sessionId);
  await checkRichInlineMathRoundTrips(sessionId);
  await checkRichTableMathEditing(sessionId);
  await checkRichChecklistEditing(sessionId);
  await checkSplitScrollSync(sessionId);
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

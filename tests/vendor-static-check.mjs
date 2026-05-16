import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), 'utf8');
}

function exists(relativePath) {
  return existsSync(new URL(relativePath, root));
}

function requireFile(relativePath) {
  assert.ok(exists(relativePath), `${relativePath} must exist`);
  assert.ok(statSync(new URL(relativePath, root)).isFile(), `${relativePath} must be a file`);
}

function requireDirectory(relativePath) {
  assert.ok(exists(relativePath), `${relativePath} must exist`);
  assert.ok(statSync(new URL(relativePath, root)).isDirectory(), `${relativePath} must be a directory`);
}

function collectFiles(relativeDirectory) {
  const directory = new URL(relativeDirectory, root);
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const childPath = `${relativeDirectory.replace(/\/?$/, '/')}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectFiles(childPath));
    } else if (entry.isFile()) {
      files.push(childPath);
    }
  }
  return files;
}

function sha256(relativePath) {
  return createHash('sha256').update(readFileSync(new URL(relativePath, root))).digest('hex');
}

function packageVersion(relativePath) {
  return JSON.parse(read(relativePath)).version;
}

function licenseDocHasVersion(name, version) {
  const licenses = read('docs/third-party-licenses.md');
  assert.match(licenses, new RegExp(`\\|\\s*${name}\\s*\\|\\s*${version.replaceAll('.', '\\.')}\\s*\\|`, 'i'));
}

requireFile('vendor/markdown-it/markdown-it.min.js');
requireFile('vendor/markdown-it/LICENSE');
requireFile('vendor/markdown-it/package.json');
licenseDocHasVersion('markdown-it', packageVersion('vendor/markdown-it/package.json'));

requireFile('vendor/highlight/highlight.min.js');
requireFile('vendor/highlight/styles/github-dark.min.css');
requireFile('vendor/highlight/LICENSE');
requireFile('vendor/highlight/package.json');
licenseDocHasVersion('@highlightjs/cdn-assets', packageVersion('vendor/highlight/package.json'));

requireFile('vendor/mermaid/mermaid.min.js');
requireFile('vendor/mermaid/LICENSE');
requireFile('vendor/mermaid/package.json');
licenseDocHasVersion('mermaid', packageVersion('vendor/mermaid/package.json'));

requireFile('vendor/katex/katex.min.js');
requireFile('vendor/katex/katex.min.css');
requireDirectory('vendor/katex/fonts');
requireFile('vendor/katex/LICENSE');
assert.match(read('docs/third-party-licenses.md'), /\|\s*KaTeX\s*\|\s*0\.16\.46\s*\|/);

const manifest = JSON.parse(read('vendor/manifest.json'));
const manifestFiles = new Map(manifest.files.map((file) => [file.path, file]));
for (const vendorFile of collectFiles('vendor').filter((file) => file !== 'vendor/manifest.json')) {
  const entry = manifestFiles.get(vendorFile);
  assert.ok(entry, `${vendorFile} must be recorded in vendor/manifest.json`);
  assert.equal(entry.bytes, statSync(new URL(vendorFile, root)).size, `${vendorFile} byte size must match manifest`);
  assert.equal(entry.sha256, sha256(vendorFile), `${vendorFile} sha256 must match manifest`);
}

const index = read('index.html');
const app = read('app.js');

assert.doesNotMatch(index, /<(?:script|link)\b[^>]+(?:src|href)=["']https?:\/\//i, 'index.html must not load remote JS/CSS');
assert.match(index, /connect-src 'none'/, 'CSP must keep connect-src none');
assert.match(index, /script-src 'self'/, 'CSP must keep script-src self');
assert.match(index, /style-src 'self' 'unsafe-inline'/, 'CSP must allow Mermaid/KaTeX inline styles only');
assert.doesNotMatch(index, /frame-ancestors/, 'meta CSP must not include ignored frame-ancestors directive');

assert.doesNotMatch(app, /\beval\b/, 'app.js must not contain eval');
assert.doesNotMatch(app, /new\s+Function\b/, 'app.js must not contain new Function');
assert.doesNotMatch(app, /\bfetch\b/, 'app.js must not contain fetch');
assert.doesNotMatch(app, /XMLHttpRequest/, 'app.js must not contain XMLHttpRequest');
assert.doesNotMatch(app, /WebSocket/, 'app.js must not contain WebSocket');
assert.doesNotMatch(app, /\bWorker\b/, 'app.js must not contain Worker');

assert.match(app, /html:\s*false/, 'markdown-it raw HTML must remain disabled');
assert.match(app, /securityLevel:\s*'strict'/, 'Mermaid strict security level must remain enabled');
assert.match(app, /htmlLabels:\s*false/, 'Mermaid HTML labels must remain disabled');
assert.match(app, /showDirectoryPicker/, 'File System Access API folder picker should be supported when available');
assert.match(read('docs/third-party-licenses.md'), /Mermaid package dependency license review/);
assert.match(read('docs/third-party-licenses.md'), /REVIEW REQUIRED/);

console.log('vendor static checks passed');

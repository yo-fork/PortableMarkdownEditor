import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.url);

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

requireDirectory('vendor/codemirror6/node_modules');
requireFile('vendor/codemirror6/import-map.json');
requireFile('vendor/codemirror6/package.json');
requireFile('vendor/codemirror6/package-lock.json');
requireFile('vendor/codemirror6/source-editor.js');
requireFile('vendor/codemirror6/source-editor.bundle.js');
requireFile('vendor/codemirror6/node_modules/@codemirror/state/dist/index.js');
requireFile('vendor/codemirror6/node_modules/@codemirror/view/dist/index.js');
requireFile('vendor/codemirror6/node_modules/@codemirror/lang-markdown/dist/index.js');
assert.match(read('docs/third-party-licenses.md'), /\|\s*`@codemirror\/state`\s*\|\s*6\.6\.0\s*\|\s*MIT\s*\|/);
assert.match(read('docs/third-party-licenses.md'), /\|\s*`@codemirror\/view`\s*\|\s*6\.43\.0\s*\|\s*MIT\s*\|/);
assert.match(read('docs/third-party-licenses.md'), /\|\s*`@codemirror\/lang-markdown`\s*\|\s*6\.5\.0\s*\|\s*MIT\s*\|/);

requireFile('vendor/prosemirror/prosemirror-editor.js');
requireFile('vendor/prosemirror/package.json');
requireFile('vendor/prosemirror/package-lock.json');
requireDirectory('vendor/prosemirror/licenses');
requireFile('vendor/prosemirror/licenses/prosemirror-state/LICENSE');
requireFile('vendor/prosemirror/licenses/prosemirror-view/LICENSE');
requireFile('vendor/prosemirror/licenses/prosemirror-markdown/LICENSE');
requireFile('vendor/prosemirror/licenses/prosemirror-tables/LICENSE');
assert.match(read('docs/third-party-licenses.md'), /\|\s*`prosemirror-state`\s*\|\s*1\.4\.4\s*\|\s*MIT\s*\|/);
assert.match(read('docs/third-party-licenses.md'), /\|\s*`prosemirror-view`\s*\|\s*1\.41\.8\s*\|\s*MIT\s*\|/);
assert.match(read('docs/third-party-licenses.md'), /\|\s*`prosemirror-markdown`\s*\|\s*1\.13\.4\s*\|\s*MIT\s*\|/);
assert.match(read('docs/third-party-licenses.md'), /\|\s*`prosemirror-tables`\s*\|\s*1\.8\.5\s*\|\s*MIT\s*\|/);

const manifest = JSON.parse(read('vendor/manifest.json'));
const manifestFiles = new Map(manifest.files.map((file) => [file.path, file]));
for (const vendorFile of collectFiles('vendor').filter((file) => file !== 'vendor/manifest.json')) {
  const entry = manifestFiles.get(vendorFile);
  assert.ok(entry, `${vendorFile} must be recorded in vendor/manifest.json`);
  assert.equal(entry.bytes, statSync(new URL(vendorFile, root)).size, `${vendorFile} byte size must match manifest`);
  assert.equal(entry.sha256, sha256(vendorFile), `${vendorFile} sha256 must match manifest`);
}

const index = read('index.html');
const app = `${read('app.js')}\n${read('modules/markdown-renderer.js')}`;
const styles = read('styles.css');
const codeMirrorBundle = read('vendor/codemirror6/source-editor.bundle.js');

assert.doesNotMatch(index, /<(?:script|link)\b[^>]+(?:src|href)=["']https?:\/\//i, 'index.html must not load remote JS/CSS');
assert.match(index, /connect-src 'none'/, 'CSP must keep connect-src none');
assert.match(index, /script-src 'self'/, 'CSP must keep script-src self');
assert.doesNotMatch(index, /script-src[^"]*sha256-/, 'CSP should not need an import-map hash for CodeMirror');
assert.doesNotMatch(index, /type="importmap"/, 'CodeMirror should load through a local classic bundle instead of an import map');
assert.match(index, /vendor\/codemirror6\/source-editor\.bundle\.js/, 'CodeMirror should load from the local classic script bundle');
assert.match(index, /vendor\/prosemirror\/prosemirror-editor\.js/, 'ProseMirror should load from the local classic script bundle');
assert.match(index, /modules\/markdown-renderer\.js[\s\S]+app\.js/, 'the Markdown renderer module should load before the app entry point');
assert.match(index, /style-src 'self' 'unsafe-inline'/, 'CSP must allow Mermaid/KaTeX inline styles only');
assert.doesNotMatch(index, /frame-ancestors/, 'meta CSP must not include ignored frame-ancestors directive');
assert.match(index, /data-format="math"[\s\S]+インライン数式/, 'toolbar should expose a KaTeX inline math insertion button');

assert.doesNotMatch(app, /\beval\b/, 'app.js must not contain eval');
assert.doesNotMatch(app, /new\s+Function\b/, 'app.js must not contain new Function');
assert.doesNotMatch(app, /\bfetch\b/, 'app.js must not contain fetch');
assert.doesNotMatch(app, /XMLHttpRequest/, 'app.js must not contain XMLHttpRequest');
assert.doesNotMatch(app, /WebSocket/, 'app.js must not contain WebSocket');
assert.doesNotMatch(app, /\bWorker\b/, 'app.js must not contain Worker');
assert.match(app, /PMECodeMirrorSourceEditor\?\.createPortableMarkdownSourceEditor/, 'app.js should initialize the vendored CodeMirror classic bundle');
assert.match(app, /function\s+syncCodeMirrorSourceFromTextarea/, 'textarea mirror should stay synchronized with CodeMirror source edits');
assert.match(app, /async function\s+openSingleMarkdownFile\(file, options = \{\}\)[\s\S]+els\.source\.value = state\.markdown;[\s\S]+syncCodeMirrorSourceFromTextarea\('open-file'\);[\s\S]+renderAll\('open'\);[\s\S]+attachPreviouslyGrantedDirectoryToOpenedMarkdown/, 'opening a single Markdown file should sync CodeMirror and render the new document before async folder reuse checks');
assert.match(app, /async function\s+openFolderEntries[\s\S]+els\.source\.value = state\.markdown;[\s\S]+syncCodeMirrorSourceFromTextarea\('open-folder'\);[\s\S]+renderAll\('open-folder'\);/, 'opening from a folder should sync CodeMirror before rendering the new document');
assert.match(app, /function\s+renderProseMirrorRich/, 'app.js should integrate the vendored ProseMirror rich editor');
assert.match(app, /resolveImageSrc:\s*sanitizeImageUrl[\s\S]+imageBlockReason/, 'ProseMirror rich editor should use the app image resolver instead of raw relative image URLs');
assert.match(app, /function\s+requestDesktopImageReferenceAliases/, 'desktop mode should request restricted aliases for document-local absolute image references');
assert.match(app, /function\s+installMarkdownItMath/, 'preview rendering should parse inline math before Markdown escaping');
assert.match(app, /function\s+inlineMathTokenAt/, 'preview and fallback rendering should share inline math delimiter checks');
assert.match(app, /state\.proseMirrorRich\.refreshImages\(\)/, 'ProseMirror rich editor should refresh image node views when folder asset mappings change');
assert.match(app, /async function\s+openSingleMarkdownFile\(file, options = \{\}\)[\s\S]+attachPreviouslyGrantedDirectoryToOpenedMarkdown\(file, options\.fileHandle \|\| null, previousDirectoryHandle\)[\s\S]+clearPersistedDirectoryHandle\(\)/, 'opening a file should try an already-granted folder before clearing folder access');
assert.match(app, /async function\s+attachPreviouslyGrantedDirectoryToOpenedMarkdown\(file, fileHandle, directoryHandleOverride = null\)[\s\S]+fileHandle\?\.isSameEntry[\s\S]+queryDirectoryPermission\(directoryHandle, 'readwrite'\)[\s\S]+findOpenedMarkdownEntry\(entries, file, fileHandle\)/, 'file open should reuse an existing folder only when the file handle is verified inside that granted folder');
assert.match(app, /function\s+renderReadOnlyRichFallback/, 'ProseMirror fallback should be read-only');
assert.match(app, /removeAttribute\('contenteditable'\)/, 'rich fallback should remove legacy contenteditable editing');
assert.match(app, /function\s+focusProseMirrorTarget/, 'ProseMirror clicks should explicitly focus the inner editor surface');
assert.match(app, /function\s+focusProseMirrorSelection/, 'ProseMirror selections should keep focus on the inner editor surface');
assert.match(app, /function\s+scheduleProseMirrorFocus/, 'ProseMirror focus should be deferred until the browser has applied the clicked DOM selection');
assert.match(app, /focus\(\{\s*preventScroll:\s*true\s*\}\)/, 'ProseMirror focus restoration should preserve the clicked DOM selection');
assert.match(app, /if \(focusProseMirrorSelection\(\)\) return;/, 'selection changes inside ProseMirror should bypass legacy rich selection handling');
assert.match(app, /function\s+applyProseMirrorFormat[\s\S]+format === 'math'[\s\S]+selectedText\(\)\.trim\(\)[\s\S]+insertProseMirrorMarkdown\(`\$\$\{selected \|\| 'x'\}\$`[\s\S]+inline:\s*true/, 'ProseMirror rich toolbar should preserve selected text when inserting inline math through Markdown parsing');
assert.match(app, /items\.push\(\{ id, text, level, start: block\.start, index: items\.length \}\)/, 'outline headings should keep their document-order index for rich-mode navigation');
assert.match(app, /function\s+navigateToOutlineHeading\(node\)[\s\S]+state\.proseMirrorRich\.revealHeadingByIndex\(node\.index\)/, 'outline clicks in rich mode should navigate through the ProseMirror editor API');
assert.match(app, /case 'math':[\s\S]+replacement = `\$\$\{selected \|\| 'x'\}\$`/, 'source-mode toolbar should insert Markdown inline math');
assert.match(app, /case 'math':[\s\S]+insertRichInlineMarkdownSource\(`\$\$\{richSelectedText\(\) \|\| 'x'\}\$`/, 'legacy rich toolbar should insert inline math through source transactions');
assert.match(app, /addEventListener\('pointerdown', onRichPointerDownCapture, true\)/, 'ProseMirror should receive DOM focus before browser click selection');
assert.match(app, /function\s+prosemirrorAtomSourceElement[\s\S]+pme-image-node[\s\S]+pme-math-node[\s\S]+pme-mermaid-node[\s\S]+pme-toc-node/, 'app.js should find ProseMirror atom source nodes as local interactive targets');
assert.match(app, /function\s+isProseMirrorAtomSourceTarget[\s\S]+pme-node-source-editor, \.pme-link-href-editor[\s\S]+prosemirrorAtomSourceElement/, 'app.js should recognize ProseMirror atom and inline href source editors as local interactive targets');
assert.match(app, /async function\s+onRichPaste\(event\)[\s\S]+const imageFiles = imageFilesFromClipboard\(event\.clipboardData\);[\s\S]+if \(isProseMirrorRichEventContext\(event\)\) \{[\s\S]+insertImageFilesAsAssets\(imageFiles, createImageInsertionContext\(event\), '貼り付け'\)/, 'ProseMirror rich paste should save pasted image files through the assets pipeline before falling through to ProseMirror paste');
assert.match(app, /function\s+onRichPointerDownCapture[\s\S]+__pmeOpenSourceEditor[\s\S]+if\s+\(isProseMirrorAtomSourceTarget\(target\)\) return;[\s\S]+focusProseMirrorElement\(proseMirror\);/, 'pointerdown focus should delegate atom source opening instead of stealing focus from ProseMirror atom source editors');
assert.match(app, /function\s+onRichClick[\s\S]+if\s+\(isProseMirrorAtomSourceTarget\(target\)\) \{[\s\S]+event\.stopPropagation\(\);[\s\S]+return;[\s\S]+focusProseMirrorTarget\(target\);/, 'click focus restoration should not steal focus from ProseMirror atom source editors');
assert.match(app, /function\s+onRichPointerDownCapture[\s\S]*?focusProseMirrorElement\(proseMirror\);/, 'pointerdown focus should use DOM focus without scheduling restoration before the clicked selection exists');
assert.match(app, /if \(isProseMirrorRichTarget\(target\)\) \{\s*focusProseMirrorTarget\(target\);\s*return;\s*\}/, 'legacy rich click handling should not steal ProseMirror clicks');
assert.match(app, /function\s+isProseMirrorRichEventContext[\s\S]+document\.activeElement[\s\S]+selection\?\.anchorNode/, 'legacy rich event guards should recognize ProseMirror paste contexts even when the event target is the outer rich container');
assert.match(app, /function\s+onRichPaste[\s\S]+if \(isProseMirrorRichEventContext\(event\)\) \{[\s\S]+if \(imageFiles\.length\)[\s\S]+return;[\s\S]+const control = eventTargetElement/, 'legacy rich paste handling should not duplicate ProseMirror-managed paste transactions after handling image files');

assert.match(codeMirrorBundle, /Generated by tools\/bundle-codemirror-cjs\.mjs/, 'CodeMirror bundle should be reproducibly generated by the local bundler');
assert.match(codeMirrorBundle, /global\.PMECodeMirrorSourceEditor/, 'CodeMirror bundle should expose one local global');
assert.match(codeMirrorBundle, /createPortableMarkdownSourceEditor/, 'CodeMirror bundle should expose the source editor factory');
assert.doesNotMatch(codeMirrorBundle, /^\s*import\s/m, 'CodeMirror bundle must not rely on ESM import syntax');
assert.doesNotMatch(codeMirrorBundle, /^\s*export\s/m, 'CodeMirror bundle must not rely on ESM export syntax');
assert.doesNotMatch(codeMirrorBundle, /\beval\b/, 'CodeMirror bundle must not contain eval');
assert.doesNotMatch(codeMirrorBundle, /new\s+Function\b/, 'CodeMirror bundle must not contain new Function');
assert.doesNotMatch(codeMirrorBundle, /\bfetch\b/, 'CodeMirror bundle must not contain fetch');
assert.doesNotMatch(codeMirrorBundle, /XMLHttpRequest/, 'CodeMirror bundle must not contain XMLHttpRequest');
assert.doesNotMatch(codeMirrorBundle, /WebSocket/, 'CodeMirror bundle must not contain WebSocket');
assert.doesNotMatch(codeMirrorBundle, /\bWorker\b/, 'CodeMirror bundle must not contain Worker');

const proseMirrorBundle = read('vendor/prosemirror/prosemirror-editor.js');
assert.match(proseMirrorBundle, /global\.PMEProseMirror/, 'ProseMirror bundle should expose one local global');
assert.match(proseMirrorBundle, /function\s+preserveMarkdownLocalPaths/, 'ProseMirror Markdown parsing should preserve readable Windows image paths');
assert.match(proseMirrorBundle, /function\s+inlineMathMatchAt/, 'ProseMirror inline math parsing should use strict shared delimiter checks');
assert.match(proseMirrorBundle, /function\s+addTaskListRule[\s\S]+data-pme-task/, 'ProseMirror parsing should promote Markdown checklist markers into list-item attrs');
assert.match(proseMirrorBundle, /function\s+TaskListItemNodeView[\s\S]+pme-task-checkbox[\s\S]+setNodeMarkup/, 'rich checklist items should expose an interactive checkbox backed by a ProseMirror transaction');
assert.match(proseMirrorBundle, /list_item:\s*function\(state, node\)[\s\S]+\[x\][\s\S]+\[ \]/, 'checklist attrs should serialize back to Markdown markers');
assert.match(proseMirrorBundle, /'Mod-0'[\s\S]+'Mod-1'[\s\S]+'Mod-6'/, 'ProseMirror should bind paragraph and heading shortcuts');
assert.match(proseMirrorBundle, /'Shift-Mod-7'[\s\S]+'Shift-Mod-8'[\s\S]+'Shift-Mod-9'/, 'ProseMirror should bind numbered list, bullet list, and quote shortcuts');
assert.match(proseMirrorBundle, /var delimiter = [^;]+\\\\\[/, 'ProseMirror display math parsing should recognize bracket delimiters');
assert.match(proseMirrorBundle, /function\s+ImageNodeView\(node, editorView, getPos, options\)[\s\S]+data-pme-atom-node', 'image'[\s\S]+this\.render\(\)/, 'ProseMirror rich editor should render images through a node view');
assert.match(proseMirrorBundle, /function\s+resolveImageNodeSrc\(src, options\)[\s\S]+options\.resolveImageSrc\(src\)/, 'ProseMirror image node views should resolve Markdown image src values through the app callback');
assert.match(proseMirrorBundle, /ImageNodeView\.prototype\.render[\s\S]+image\.src = resolved[\s\S]+blocked-image[\s\S]+imageFallbackText/, 'ProseMirror image node views should show resolved images or blocked-image placeholders');
assert.match(proseMirrorBundle, /function\s+parseImageSourceEditorValue\(value\)[\s\S]+source\.match\([\s\S]+src:[\s\S]+alt:[\s\S]+title:/, 'ProseMirror image node views should parse editable Markdown image source');
assert.match(proseMirrorBundle, /function\s+updateImageNodeViewSource\(nodeView, value\)[\s\S]+updateNodeViewAttrs\(nodeView\.editorView, nodeView\.getPos, nodeView\.node, attrs\)/, 'ProseMirror image source editing should update image node attrs through a transaction');
assert.match(proseMirrorBundle, /function\s+ImageNodeView\(node, editorView, getPos, options\)[\s\S]+createNodeSourceEditor\(\{[\s\S]+pme-node-source-editor--image[\s\S]+onConfirm:[\s\S]+setSelectionAfterNodeView/, 'ProseMirror image node views should expose direct Markdown source editing in rich mode');
assert.match(proseMirrorBundle, /function\s+ImageNodeView\(node, editorView, getPos, options\)[\s\S]+this\.dom\.setAttribute\('contenteditable', 'false'\)[\s\S]+this\.sourceEditor = createNodeSourceEditor/, 'rendered images should stay display-only so their source popover is the sole image link editor');
assert.match(proseMirrorBundle, /verticalBoundaryExit:\s*true[\s\S]+pme-node-source-editor--image/, 'image source editors should opt into up/down arrow exit behavior');
assert.match(proseMirrorBundle, /ImageNodeView\.prototype\.stopEvent = stopNodeSourceEditorEvent[\s\S]+ImageNodeView\.prototype\.selectNode = selectAtomSourceNode[\s\S]+ImageNodeView\.prototype\.destroy = function\(\) \{ destroyNodeSourceEditor\(this\.sourceEditor\); \}/, 'ProseMirror image node source editors should own input events and clean up their popover');
assert.match(proseMirrorBundle, /refreshImages:\s*function\(\)[\s\S]+refreshImageNodeViews\(editorView\)/, 'ProseMirror rich editor should expose image refresh for updated folder asset maps');
assert.match(proseMirrorBundle, /function\s+headingPositionByIndex\(doc, index\)[\s\S]+if \(found != null\) return false;[\s\S]+node\.type !== schema\.nodes\.heading[\s\S]+found = pos/, 'ProseMirror rich editor should resolve outline heading indexes once instead of overwriting with later headings');
assert.match(proseMirrorBundle, /function\s+revealHeadingByIndex\(editorView, index\)[\s\S]+TextSelection\.create\(editorView\.state\.doc, selectionPos\)[\s\S]+scrollIntoView\(\)[\s\S]+editorView\.nodeDOM\(pos\)[\s\S]+headingDom\.scrollIntoView/, 'ProseMirror rich editor should move selection and explicitly scroll to an outline heading');
assert.match(proseMirrorBundle, /revealHeadingByIndex:\s*function\(index\)[\s\S]+return revealHeadingByIndex\(editorView, index\)/, 'ProseMirror rich editor should expose outline heading navigation through its public API');
assert.doesNotMatch(proseMirrorBundle, /splitParagraphStartIntoEmptyBefore/, 'paragraph-start Enter should use the ProseMirror standard behavior');
assert.match(proseMirrorBundle, /keys\.Enter = commands\.chainCommands\(\s*tableCellEnterCommand,\s*extendedBlockInputCommand,\s*fencedCodeBlockInputCommand,\s*repairEmptyListItemWithChildList\(listItem\),\s*exitEmptyListItemToParagraph\(listItem\),\s*schemaList\.splitListItem\(listItem\),\s*commands\.baseKeymap\.Enter\s*\)/, 'table cells should handle Enter before rich block Markdown shortcuts and list Enter falls through to the ProseMirror standard splitListItem command');
assert.doesNotMatch(proseMirrorBundle, /exitListItemWithChildListToParagraph|splitListItemAfterChildList/, 'list items with child lists should use the ProseMirror standard split behavior instead of a custom split/exit command');
assert.match(proseMirrorBundle, /function\s+repairEmptyListItemWithChildList[\s\S]+previousItem\.content\.append\(model\.Fragment\.fromArray\(movedChildren\)\)[\s\S]+replaceWith\(previousStart, currentEnd, nextPreviousItem\)/, 'Enter on an empty list item with a child list should delete the empty item and move the child list back to the previous item');
assert.match(proseMirrorBundle, /function\s+exitEmptyListItemToParagraph[\s\S]+tr\.insert\(insertPos, paragraphNode\)/, 'Enter on an empty list item should leave list mode as a paragraph instead of repeatedly lifting empty bullets');
assert.match(proseMirrorBundle, /var tableModule = requireModule\('prosemirror-tables'\)/, 'ProseMirror rich editor should bundle prosemirror-tables');
assert.match(proseMirrorBundle, /tableModule\.tableNodes\(\{[\s\S]+cellContent:\s*'inline\*'/m, 'table schema should come from prosemirror-tables with inline cell content');
assert.match(proseMirrorBundle, /tableModule\.tableEditing\(\)/, 'ProseMirror table editing plugin should be installed');
assert.match(proseMirrorBundle, /function\s+tableCommandWithMarkdownNormalization[\s\S]+normalizeMarkdownTableTransaction/, 'table editing toolbar commands should run through Markdown table normalization');
assert.match(proseMirrorBundle, /function\s+normalizeMarkdownTableTransaction[\s\S]+schema\.nodes\.table_header[\s\S]+schema\.nodes\.table_cell/, 'table normalization should keep the first row as header cells and body rows as normal cells');
assert.match(proseMirrorBundle, /function\s+tableToolbarCommand[\s\S]+tableModule\.addRowBefore[\s\S]+tableModule\.addRowAfter[\s\S]+tableModule\.addColumnBefore[\s\S]+tableModule\.addColumnAfter[\s\S]+deleteSelectedTableRowsCommand[\s\S]+deleteSelectedTableColumnsCommand[\s\S]+tableModule\.deleteTable/, 'table toolbar should expose row, column, and table commands through prosemirror-tables');
assert.match(proseMirrorBundle, /function\s+setSelectedTableColumnsAlignCommand[\s\S]+align:\s*align \|\| null[\s\S]+normalizeMarkdownTableTransaction/, 'table toolbar should apply column alignment through cell attrs so the serializer can emit Markdown delimiters');
assert.match(proseMirrorBundle, /function\s+tableToolbarPlugin\(\)[\s\S]+new state\.Plugin[\s\S]+view:\s*function\(editorView\)[\s\S]+TableToolbarView/, 'table toolbar should be a ProseMirror plugin view');
assert.match(proseMirrorBundle, /tableToolbarPlugin\(\)/, 'table toolbar plugin should be installed in the rich editor state');
assert.match(proseMirrorBundle, /math_inline:\s*\{[\s\S]+atom:\s*true/m, 'ProseMirror schema should define atom inline math nodes');
assert.match(proseMirrorBundle, /math_display:\s*\{[\s\S]+atom:\s*true/m, 'ProseMirror schema should define atom display math nodes');
assert.match(proseMirrorBundle, /mermaid_block:\s*\{[\s\S]+atom:\s*true/m, 'ProseMirror schema should define atom Mermaid nodes');
assert.match(proseMirrorBundle, /toc_block:\s*\{[\s\S]+atom:\s*true/m, 'ProseMirror schema should define atom TOC nodes');
assert.doesNotMatch(proseMirrorBundle, /pme-table(?!-toolbar)|pme-math-display/, 'table and display math should not depend on protected fence fallback markers');
assert.match(proseMirrorBundle, /function\s+updateNodeViewAttrs[\s\S]+setNodeMarkup\(pos, null, extendObject\(node\.attrs \|\| \{\}, nextAttrs\)\)/, 'atom node source editors should update ProseMirror node attrs through transactions');
assert.match(proseMirrorBundle, /function\s+deleteSelectedOrAdjacentAtomCommand\(dir\)[\s\S]+atomDeletionRangeNearSelection\(editorState, dir\)[\s\S]+deleteAtomRange\(editorState, dispatch, range\.from, range\.to, dir\)/, 'Backspace/Delete should delete selected or adjacent rich atom nodes through ProseMirror transactions');
assert.match(proseMirrorBundle, /function\s+deleteNodeView\(editorView, getPos, node, dir\)[\s\S]+tr\.delete\(pos, pos \+ node\.nodeSize\)[\s\S]+setSelectionNearDeletedRange/, 'atom source editors should be able to delete their owning node at source boundaries');
assert.match(proseMirrorBundle, /options && options\.selectAfterNode[\s\S]+TextSelection\.create\(tr\.doc, after\)/, 'inline KaTeX source updates should move stale ProseMirror selections away from previously selected atom nodes');
assert.match(proseMirrorBundle, /function\s+setSelectionAfterNodeView[\s\S]+TextSelection\.create\(tr\.doc, after\)[\s\S]+tr\.insert\(after, schema\.nodes\.paragraph\.create\(\)\)[\s\S]+editorView\.dispatch\(tr\.setSelection\(selection\)\.scrollIntoView\(\)\)/, 'confirming an atom source editor should return the ProseMirror caret after the inline node or to the next editable line');
assert.match(proseMirrorBundle, /function\s+setSelectionBeforeNodeView[\s\S]+tr\.insert\(before, schema\.nodes\.paragraph\.create\(\)\)[\s\S]+TextSelection\.create\(tr\.doc, before \+ 1\)[\s\S]+editorView\.dispatch\(tr\.setSelection\(selection\)\.scrollIntoView\(\)\)/, 'block atom source editors should be able to return the caret before the node by creating an editable line when needed');
assert.match(proseMirrorBundle, /function\s+createNodeSourceEditor[\s\S]+pme-node-source-editor[\s\S]+addEventListener\('input'/, 'atom node views should create local source editor controls');
assert.match(proseMirrorBundle, /options\.multiline \|\| options\.wrapLongValue \? 'textarea' : 'input'/, 'long image Markdown sources should use a wrapping textarea');
assert.match(proseMirrorBundle, /shouldConfirm[\s\S]+options\.onConfirm\(control\.value, event\)[\s\S]+sourceEditorInput\(control\)\.blur\(\)/, 'Enter/Ctrl+Enter confirmation should run atom source editor confirm handling before closing the popover');
assert.match(proseMirrorBundle, /options\.inlineTokens[\s\S]+pme-node-source-delimiter[\s\S]+pme-node-source-editor-input/, 'inline KaTeX source editing should render Markdown delimiters separately from the editable latex text');
assert.match(proseMirrorBundle, /function\s+ensureLinkHrefPopover\(\)[\s\S]+pme-link-href-input[\s\S]+updateLinkHref\(activeLinkHrefPopover\.editorView, activeLinkHrefPopover\.getPos/, 'link visual source affordance should expose an editable href input for Markdown parentheses');
assert.match(proseMirrorBundle, /function\s+ensureLinkHrefPopover\(\)[\s\S]+document\.createElement\('textarea'\)[\s\S]+input\.rows = 3[\s\S]+input\.wrap = 'soft'/, 'long link URLs should use a wrapping multiline editing control');
assert.match(proseMirrorBundle, /function\s+linkHrefEditorWidget\(mark, range\)[\s\S]+pme-link-href-value[\s\S]+showLinkHrefPopover\(editorView, getPos, range, mark, wrapper\)/, 'clicking a link href affordance should open the editable href popover');
assert.match(proseMirrorBundle, /function\s+linkHrefEditorWidget\(mark, range\)[\s\S]+wrapper\.setAttribute\('contenteditable', 'false'\)/, 'the inline href affordance should be display-only so the popover is the sole link URL editor');
assert.match(proseMirrorBundle, /function\s+enterLinkHrefEditorAtBoundaryCommand[\s\S]+linkMarkRangeAtPosition\(editorState\.doc, selection\.from\)[\s\S]+showLinkHrefPopover/, 'ArrowRight at a link boundary should open the href editor without requiring a click');
assert.match(proseMirrorBundle, /function\s+enterLinkHrefEditorAtBoundaryCommand[\s\S]+selection\.from < range\.to[\s\S]+TextSelection\.create\(editorState\.doc, selection\.from \+ 1\)/, 'ArrowRight should move the ProseMirror selection through all link text before entering the href editor');
assert.match(proseMirrorBundle, /function\s+hideLinkHrefPopover[\s\S]+TextSelection\.create\(active\.editorView\.state\.doc, exitPos\)[\s\S]+linkHrefArrowExit = \{ editorView: active\.editorView, pos: active\.range\.to \}/, 'leaving the href editor should place the caret after the link and allow the next ArrowRight press to continue');
assert.match(proseMirrorBundle, /function\s+updateLinkHref\(editorView, getPos, fallbackRange, nextHref\)[\s\S]+removeMark\(range\.from, range\.to, schema\.marks\.link\)[\s\S]+addMark\(range\.from, range\.to, schema\.marks\.link\.create\(attrs\)\)/, 'editing a link href should update the link mark through a ProseMirror transaction');
assert.match(proseMirrorBundle, /view\.Decoration\.widget\(range\.to, sourceMarkerWidget\(mark, 'after', range\)[\s\S]+stopEvent:\s*stopLinkHrefEditorEvent/, 'link href editor widget should own its input events instead of letting ProseMirror steal focus');
assert.doesNotMatch(proseMirrorBundle, /raw:\s*mark\.type === schema\.marks\.link|ignoreSelection:\s*mark\.type === schema\.marks\.link/, 'link href affordances should use ProseMirror standard non-editable widget selection handling');
assert.match(proseMirrorBundle, /event\.key === 'ArrowLeft'[\s\S]+options\.onExitBoundary\('before'[\s\S]+event\.key === 'ArrowRight'[\s\S]+options\.onExitBoundary\('after'/, 'inline source editors should leave editing with left/right arrows at text boundaries');
assert.match(proseMirrorBundle, /event\.key === 'ArrowUp'[\s\S]+cursorIsOnFirstSourceLine\(input\)[\s\S]+options\.onExitBoundary\('before'[\s\S]+event\.key === 'ArrowDown'[\s\S]+cursorIsOnLastSourceLine\(input\)[\s\S]+options\.onExitBoundary\('after'/, 'multiline atom source editors should leave editing with up/down arrows at source boundaries');
assert.match(proseMirrorBundle, /!options\.multiline && options\.verticalBoundaryExit && event\.key === 'ArrowUp'[\s\S]+options\.onExitBoundary\('before'[\s\S]+!options\.multiline && options\.verticalBoundaryExit && event\.key === 'ArrowDown'[\s\S]+options\.onExitBoundary\('after'/, 'single-line image source editors should leave editing with up/down arrows');
assert.match(proseMirrorBundle, /event\.key === 'Backspace'[\s\S]+input\.selectionStart === 0[\s\S]+options\.onDeleteBoundary\('before'[\s\S]+event\.key === 'Delete'[\s\S]+options\.onDeleteBoundary\('after'/, 'atom source editors should delete their owning node with Backspace/Delete at source boundaries');
assert.match(proseMirrorBundle, /event\.key === 'ArrowLeft'[\s\S]+input\.setSelectionRange\(cursorPos - 1, cursorPos - 1\)[\s\S]+event\.key === 'ArrowRight'[\s\S]+input\.setSelectionRange\(cursorPos \+ 1, cursorPos \+ 1\)/, 'inline source editors should handle left/right movement inside the source input consistently');
assert.match(proseMirrorBundle, /addEventListener\('input'[\s\S]+scheduleNodeSourceEditorPopoverPosition\(\)/, 'inline source editor popovers should reposition after source text changes');
assert.match(proseMirrorBundle, /function\s+activateNodeSourceEditorFromEvent[\s\S]+showNodeSourceEditorPopover\(event\.currentTarget, control\)[\s\S]+addEventListener\('pointerdown'/, 'clicking atom node rendered content should open its source editor before ProseMirror takes focus back');
assert.match(proseMirrorBundle, /dom\.__pmeOpenSourceEditor = function\(\)[\s\S]+showNodeSourceEditorPopover\(dom, control\)/, 'app-level ProseMirror focus handling should be able to delegate atom source editing back to the node view');
assert.match(proseMirrorBundle, /function\s+selectAtomSourceNode[\s\S]+showNodeSourceEditorPopover\(dom, control\)/, 'selecting rendered atom node views should open their local source editor');
assert.match(proseMirrorBundle, /function\s+deselectAtomSourceNode[\s\S]+sourceEditorHasFocus\(this\.sourceEditor\)[\s\S]+is-editing-source/, 'deselecting atom node views should keep inline source replacement visible while its inner input has focus');
assert.match(proseMirrorBundle, /function\s+isInlineMathSourceEditor[\s\S]+pme-node-source-editor--math-inline/, 'inline KaTeX source editing should be detected separately from block atom popovers');
assert.match(proseMirrorBundle, /if\s+\(isInlineMathSourceEditor\(control\)\)[\s\S]+rect\.top \+ \(rect\.height - inlineRect\.height\) \/ 2/, 'inline KaTeX source editor should be positioned over the hidden rendered math so it visually replaces the node');
assert.match(proseMirrorBundle, /function\s+scheduleNodeSourceEditorPopoverPosition[\s\S]+requestAnimationFrame[\s\S]+positionNodeSourceEditorPopover/, 'atom source editor popovers should reposition through animation-frame scheduling');
assert.match(proseMirrorBundle, /function\s+ensureNodeSourceEditorPopoverEvents[\s\S]+addEventListener\('resize'[\s\S]+addEventListener\('scroll'/, 'atom source editor popovers should track viewport resize and scrolling while open');
assert.match(proseMirrorBundle, /function\s+mathSourceEditorValue[\s\S]+return displayMode \? latex : '\$' \+ latex \+ '\$';/, 'inline KaTeX source editors should show Markdown math delimiters while editing');
assert.match(proseMirrorBundle, /function\s+latexFromMathSourceEditorValue[\s\S]+dollarMatch[\s\S]+parenMatch/, 'KaTeX source editors should strip inline math delimiters before updating node attrs');
assert.match(proseMirrorBundle, /inlineTokens:\s*this\.displayMode \? null : \['\$', '\$'\]/, 'inline KaTeX source editors should show faint delimiter tokens around editable latex');
assert.match(proseMirrorBundle, /pme-inline-math-edit-preview[\s\S]+bindNodeSourceEditorActivation\(this\.dom, this\.sourceEditor\)/, 'inline KaTeX source editing should visually replace the rendered node and keep a rendered edit preview nearby');
assert.match(proseMirrorBundle, /function\s+MathNodeView\(node, editorView, getPos\)[\s\S]+createNodeSourceEditor[\s\S]+latex:\s*latexFromMathSourceEditorValue\(value, self\.displayMode\)[\s\S]+selectAfterNode:\s*!self\.displayMode/, 'KaTeX node views should be directly editable in rich mode');
assert.match(proseMirrorBundle, /function\s+MermaidNodeView\(node, editorView, getPos\)[\s\S]+createNodeSourceEditor[\s\S]+source:\s*normalizeNewlines\(value\)/, 'Mermaid node views should be directly editable in rich mode');
assert.match(proseMirrorBundle, /function\s+MathNodeView\(node, editorView, getPos\)[\s\S]+onDeleteBoundary:\s*function\(side\)[\s\S]+deleteNodeView\(self\.editorView, self\.getPos, self\.node/, 'KaTeX source editors should support deleting the owning atom node from source boundaries');
assert.match(proseMirrorBundle, /function\s+MermaidNodeView\(node, editorView, getPos\)[\s\S]+onExitBoundary:\s*function\(side\)[\s\S]+setSelectionBeforeNodeView\(self\.editorView, self\.getPos, self\.node\)[\s\S]+setSelectionAfterNodeView\(self\.editorView, self\.getPos, self\.node\)/, 'Mermaid source editors should support arrow-key exit to adjacent editable lines');
assert.match(proseMirrorBundle, /function\s+MathNodeView\(node, editorView, getPos\)[\s\S]+onConfirm:\s*function\(\)[\s\S]+setSelectionAfterNodeView\(self\.editorView, self\.getPos, self\.node\)/, 'confirming KaTeX source edits should put the caret after the math node');
assert.match(proseMirrorBundle, /function\s+MermaidNodeView\(node, editorView, getPos\)[\s\S]+onConfirm:\s*function\(\)[\s\S]+setSelectionAfterNodeView\(self\.editorView, self\.getPos, self\.node\)/, 'confirming Mermaid source edits should put the caret on the next editable line');
assert.match(proseMirrorBundle, /function\s+TocNodeView\(node, editorView, getPos\)[\s\S]+createNodeSourceEditor[\s\S]+onConfirm:[\s\S]+setSelectionAfterNodeView[\s\S]+replaceNodeViewWithMarkdown/, 'TOC node views should expose their marker as an editable rich source island');
assert.match(proseMirrorBundle, /MathNodeView\.prototype\.stopEvent = stopNodeSourceEditorEvent[\s\S]+MathNodeView\.prototype\.selectNode = selectAtomSourceNode[\s\S]+MermaidNodeView\.prototype\.stopEvent = stopNodeSourceEditorEvent[\s\S]+MermaidNodeView\.prototype\.selectNode = selectAtomSourceNode[\s\S]+TocNodeView\.prototype\.stopEvent = stopNodeSourceEditorEvent[\s\S]+TocNodeView\.prototype\.selectNode = selectAtomSourceNode/, 'interactive atom node views should let ProseMirror select rendered nodes and let source editors own their input events');
assert.match(proseMirrorBundle, /'Shift-Enter': commands\.chainCommands\(commands\.newlineInCode, insertHardBreakCommand\)/, 'Shift+Enter should insert a ProseMirror hard_break node');
assert.match(proseMirrorBundle, /replaceSelectionWith\(hardBreak\.create\(\)\)/, 'hard break insertion should use a ProseMirror transaction');
assert.match(proseMirrorBundle, /'Backspace': commands\.chainCommands\(deleteSelectedOrAdjacentAtomCommand\(-1\), joinParagraphAfterListIntoPreviousItem, inputRulesModule\.undoInputRule, commands\.baseKeymap\.Backspace\)/, 'Backspace should delete adjacent atom nodes before list-specific fallback handling');
assert.match(proseMirrorBundle, /'Delete': commands\.chainCommands\(deleteSelectedOrAdjacentAtomCommand\(1\), commands\.baseKeymap\.Delete\)/, 'Delete should delete selected or adjacent atom nodes before falling through');
assert.match(proseMirrorBundle, /\.delete\(selection\.\$from\.before\(paragraphDepth\), selection\.\$from\.after\(paragraphDepth\)\)\s*\.insert\(insertPos, paragraph\.content\)/, 'paragraph-after-list Backspace should move paragraph content into the previous list item');
assert.match(proseMirrorBundle, /var inputRulesModule = requireModule\('prosemirror-inputrules'\)/, 'ProseMirror rich editor should use vendored Markdown input rules');
assert.match(proseMirrorBundle, /wrappingInputRule\(\/\^\\s\*\(\[-\+\*\]\)\\s\$\/, schema\.nodes\.bullet_list\)/, 'typing a Markdown bullet marker should create a bullet list');
assert.ok(proseMirrorBundle.includes('wrappingInputRule(/^\\s*>\\s$/, schema.nodes.blockquote)'), 'typing a Markdown quote marker should create a blockquote');
assert.match(proseMirrorBundle, /textblockTypeInputRule\(\s*\/\^\(#\{1,6\}\)\\s\$\/,\s*schema\.nodes\.heading/, 'typing a Markdown heading marker should create a heading');
assert.match(proseMirrorBundle, /function\s+fencedCodeBlockInputCommand[\s\S]+schema\.nodes\.code_block\.create/, 'typing a Markdown code fence and pressing Enter should create a code block');
assert.match(proseMirrorBundle, /function\s+CodeBlockNodeView\(node, editorView, getPos\)[\s\S]+code-language-input pme-code-language-input[\s\S]+updateNodeViewAttrs\(self\.editorView, self\.getPos, self\.node, \{ params: normalized \}\)/, 'rich code blocks should expose a language input backed by node attrs');
assert.match(proseMirrorBundle, /code_block:\s*function\(node, editorView, getPos\) \{ return new CodeBlockNodeView/, 'the rich editor should register the code block node view');
assert.doesNotMatch(proseMirrorBundle, /function\s+horizontalRuleInputRule/, 'horizontal rule markers should not convert while the caret is still on the marker line');
assert.match(proseMirrorBundle, /function\s+selectionInsideRange[\s\S]+selection\.from >= from && selection\.from <= to/, 'horizontal rule normalization should know whether the caret is still on the marker line');
assert.match(proseMirrorBundle, /function\s+inlineMathInputRule[\s\S]+schema\.nodes\.math_inline\.create/, 'typing Markdown inline math should create an inline math atom node');
assert.match(proseMirrorBundle, /function\s+parenMathInputRule[\s\S]+schema\.nodes\.math_inline\.create/, 'typing paren Markdown inline math should create an inline math atom node');
assert.match(proseMirrorBundle, /function\s+mathDisplayInputRule[\s\S]+schema\.nodes\.math_display\.create/, 'typing one-line display math should create a display math atom node');
assert.match(proseMirrorBundle, /function\s+tocInputRule[\s\S]+schema\.nodes\.toc_block\.create/, 'typing a TOC marker should create a TOC atom node');
assert.match(proseMirrorBundle, /function\s+markdownShapeNormalizationPlugin[\s\S]+appendTransaction/, 'Markdown-looking rich content should be normalized after document-changing transactions');
assert.match(proseMirrorBundle, /var\s+markdownShapeNormalizationKey\s*=\s*new state\.PluginKey\('pmeMarkdownShapeNormalization'\)/, 'Markdown shape normalization should mark its own transactions to avoid loops');
assert.match(proseMirrorBundle, /markdownShapeNormalizationPlugin\(\)/, 'Markdown shape normalization plugin should be installed');
assert.match(proseMirrorBundle, /function\s+markdownClipboardTextParser[\s\S]+sliceFromMarkdown\(normalized,\s*inline\)/, 'plain text paste should parse Markdown through the same ProseMirror Markdown parser');
assert.match(proseMirrorBundle, /clipboardTextParser:\s*markdownClipboardTextParser/, 'ProseMirror editor should install the Markdown clipboard text parser');
assert.match(proseMirrorBundle, /function\s+handleMarkdownPlainTextPaste[\s\S]+event\.stopPropagation[\s\S]+replaceSelection\(slice\)/, 'Markdown-looking plain text paste should be handled inside ProseMirror and stopped before legacy rich paste handlers can duplicate it');
assert.match(proseMirrorBundle, /handlePaste:\s*handleMarkdownPlainTextPaste/, 'ProseMirror editor should install a Markdown paste handler that owns Markdown-looking plain text paste');
assert.match(proseMirrorBundle, /function\s+parseMarkdown\(markdownText\)\s*\{\s*return parser\.parse\(markdownText \|\| ''\);/, 'plain Markdown parsing should stay source-faithful for slices and paste parsing');
assert.match(proseMirrorBundle, /function\s+ensureEditableTrailingParagraph[\s\S]+doc\.copy\(doc\.content\.append\(model\.Fragment\.from\(schema\.nodes\.paragraph\.create\(\)\)\)\)/, 'rich editor state should append an editable trailing paragraph when the parsed document ends in a non-editable block');
assert.match(proseMirrorBundle, /function\s+documentWithoutEditableTrailingParagraphs[\s\S]+while \(nodes\.length > 1 && isEmptyParagraphNode\(nodes\[nodes\.length - 1\]\)\) nodes\.pop\(\)/, 'Markdown serialization should remove editor-only trailing empty paragraphs');
assert.match(proseMirrorBundle, /function\s+serializeMarkdown\(doc\) \{\s*return restoreMarkdownSyntaxEscapes\(serializer\.serialize\(documentWithoutEditableTrailingParagraphs\(doc\)\)\);/, 'source Markdown should not persist the editor-only trailing paragraph');
assert.match(proseMirrorBundle, /var editableTrailingParagraphKey = new state\.PluginKey\('pmeEditableTrailingParagraph'\)/, 'editable trailing paragraph plugin should guard its own transactions');
assert.match(proseMirrorBundle, /function\s+editableTrailingParagraphPlugin[\s\S]+newState\.tr\.insert\(newState\.doc\.content\.size, schema\.nodes\.paragraph\.create\(\)\)/, 'document-changing transactions should restore an editable trailing paragraph at the document end');
assert.match(proseMirrorBundle, /var doc = ensureEditableTrailingParagraph\(parseMarkdown\(markdownText \|\| ''\)\);/, 'initial rich editor state should include the editor-only trailing paragraph');
assert.match(proseMirrorBundle, /editableTrailingParagraphPlugin\(\)/, 'editable trailing paragraph plugin should be installed');
assert.match(proseMirrorBundle, /function\s+mermaidBlockCandidate[\s\S]+schema\.nodes\.mermaid_block\.create/, 'typing a Mermaid fence and pressing Enter should create a Mermaid atom node');
assert.match(proseMirrorBundle, /function\s+tableInputRuleOrCommandCandidate[\s\S]+pipeTableNodeFromLines/, 'typing a complete pipe table and pressing Enter should create a table node');
assert.match(proseMirrorBundle, /function\s+listShapeCandidate[\s\S]+bullet_list/, 'Markdown-looking list paragraphs should normalize into list nodes after paste or bulk insertion');
assert.match(proseMirrorBundle, /function\s+blockquoteShapeCandidate[\s\S]+blockquote/, 'Markdown-looking quote paragraphs should normalize into blockquote nodes after paste or bulk insertion');
assert.match(proseMirrorBundle, /function\s+singleLineBlockShapeCandidate[\s\S]+selectionInsideRange\(selection, from, to\)[\s\S]+horizontal_rule/, 'Markdown-looking heading paragraphs should normalize immediately, while horizontal rules wait until the caret leaves the marker line');
assert.match(proseMirrorBundle, /function\s+extendedBlockInputCommand[\s\S]+replaceTopLevelBlocksWithBlockAndTrailingParagraph/, 'rich block Markdown shortcuts should update the ProseMirror document through transactions');
assert.match(proseMirrorBundle, /function\s+inlineCodeInputRule[\s\S]+inlineMarkInputRule\(\/`\(\[\^`\\n\]\+\)`\$\/, schema\.marks\.code\)/, 'typing Markdown inline code should create a code mark');
assert.match(proseMirrorBundle, /function\s+applyInlineCodeFormatCommand[\s\S]+schema\.text\('code', \[codeMark\]\)[\s\S]+replaceSelectionWith\(placeholder, false\)[\s\S]+TextSelection\.create\(tr\.doc, from, from \+ placeholder\.nodeSize\)/, 'toolbar inline code insertion should create and select a visible placeholder');
assert.match(proseMirrorBundle, /function\s+preserveInlineCodeSelectionTextInput[\s\S]+codeMarkAcrossSelection[\s\S]+schema\.text\(text, \[codeMark\]\)[\s\S]+setStoredMarks\(\[codeMark\]\)/, 'typing over a selected inline-code placeholder should keep the code mark');
assert.match(proseMirrorBundle, /function\s+preserveInlineCodeSelectionBeforeInput[\s\S]+inputType !== 'insertText'[\s\S]+event\.preventDefault\(\)[\s\S]+preserveInlineCodeSelectionTextInput/, 'beforeinput should preserve the inline-code mark before the browser replaces the selected placeholder DOM');
assert.match(proseMirrorBundle, /function\s+preserveInlineCodeSelectionKeyDown[\s\S]+String\(event\.key \|\| ''\)\.length !== 1[\s\S]+preserveInlineCodeSelectionTextInput/, 'printable key input should preserve the inline-code mark while replacing the selected placeholder');
assert.match(proseMirrorBundle, /handleDOMEvents:\s*\{ beforeinput: preserveInlineCodeSelectionBeforeInput \}/, 'the rich editor should intercept the first character typed over an inline-code placeholder');
assert.match(proseMirrorBundle, /handleKeyDown:\s*preserveInlineCodeSelectionKeyDown/, 'the rich editor should intercept printable keys over an inline-code placeholder');
assert.match(proseMirrorBundle, /handleTextInput:\s*preserveInlineCodeSelectionTextInput/, 'the rich editor should preserve code marks during placeholder replacement');
assert.match(proseMirrorBundle, /case 'code': return run\(applyInlineCodeFormatCommand\)/, 'the rich inline-code action should use visible placeholder insertion');
assert.match(proseMirrorBundle, /function\s+inlineMarkInputRule[\s\S]+clearStoredMarks\(tr\)/, 'inline mark input rules should stop marks from leaking into following text');
assert.match(proseMirrorBundle, /function\s+emptyTextblockStoredMarksCleanupPlugin[\s\S]+transaction\.docChanged[\s\S]+selectionIsEmptyInlineTextblock\(newState\.selection\)[\s\S]+clearStoredMarks\(newState\.tr\)/, 'deleting all text from a marked textblock should clear stored marks before the next typed character');
assert.match(proseMirrorBundle, /emptyTextblockStoredMarksCleanupPlugin\(\)/, 'empty textblock stored mark cleanup plugin should be installed');
assert.match(proseMirrorBundle, /inlineMarkInputRule\(\/\\\*\\\*\(\[\^\*\\n\]\+\)\\\*\\\*\$\/, schema\.marks\.strong\)/, 'typing Markdown bold should create a strong mark');
assert.match(proseMirrorBundle, /inlineMarkInputRule\(\/\(\^\|\[\^\*\]\)\\\*\(\[\^\*\\n\]\+\)\\\*\$\/, schema\.marks\.em, null, \{ contentIndex: 2, preservePrefixIndex: 1 \}\)/, 'typing Markdown italic should create an em mark without stealing bold markers');
assert.match(proseMirrorBundle, /function\s+linkInputRule[\s\S]+schema\.marks\.link/, 'typing Markdown links should create link marks');
assert.match(proseMirrorBundle, /function\s+imageInputRule[\s\S]+schema\.nodes\.image\.create/, 'typing Markdown images should create image nodes');
assert.match(proseMirrorBundle, /inputRulesModule\.undoInputRule/, 'Backspace should be able to undo a just-applied Markdown input rule');
assert.match(proseMirrorBundle, /'ArrowLeft': enterStoredMarksAtInlineBoundaryCommand/, 'ArrowLeft at the outside end of a marked span should switch the caret back inside the mark');
assert.match(proseMirrorBundle, /'ArrowRight': commands\.chainCommands\(enterLinkHrefEditorAtBoundaryCommand, clearStoredMarksAtInlineBoundaryCommand\)/, 'ArrowRight should open link href editing before falling back to leaving other inline marks');
assert.match(proseMirrorBundle, /handleClick:\s*setSelectionFromSingleClick/, 'single clicks should update the ProseMirror selection through the editor model');
assert.match(proseMirrorBundle, /state\.TextSelection\.create\(doc, bounded\)/, 'click selection should be represented as a ProseMirror TextSelection');
assert.match(proseMirrorBundle, /function\s+shouldClearStoredMarksAtInlineBoundary[\s\S]+model\.Mark\.sameSet\(before\.marks, after\.marks\)/, 'marked span boundaries should be detected without treating the middle of a mark as outside');
assert.match(proseMirrorBundle, /function\s+enterStoredMarksAtInlineBoundaryCommand[\s\S]+selection\.from - 1[\s\S]+TextSelection\.create\(editorState\.doc, previousPos\)[\s\S]+setStoredMarks\(marks\)/, 'ArrowLeft should visibly move the caret one position back into the marked text');
assert.match(proseMirrorBundle, /function\s+clearStoredMarksAtInlineBoundaryCommand[\s\S]+clearStoredMarks\(editorState\.tr\)/, 'ArrowRight should clear stored marks at inline mark boundaries through a ProseMirror transaction');
assert.match(proseMirrorBundle, /clearStoredMarksForInlineBoundaryClick\(transaction, selection\)/, 'single-click selection should clear stored marks at inline mark boundaries');
assert.match(proseMirrorBundle, /inlineVisualAffordancePlugin\(\)/, 'inline mark visual affordances should be installed as a ProseMirror decoration plugin');
assert.match(proseMirrorBundle, /pme-inline-code-boundary-spacer/, 'inline code outside-boundary affordance should be a spacer, not a caret replacement');
assert.match(proseMirrorBundle, /pme-inline-code-outside-boundary/, 'inline code outside-boundary should add a scoped class for caret presentation');
assert.match(proseMirrorBundle, /function\s+isCodeOutsideInlineBoundary[\s\S]+schema\.marks\.code/, 'inline code outside-boundary detection should be isolated to code marks');
assert.match(proseMirrorBundle, /pme-inline-source-token/, 'non-code inline marks should show faint Markdown source tokens while the caret is inside');
assert.doesNotMatch(proseMirrorBundle, /inlineMarkBoundaryPlugin|pme-inline-mark-caret|pme-inline-mark-boundary|pme-inline-mark-range/, 'inline mark boundary behavior should not replace or decorate the browser caret');
assert.match(styles, /pme-inline-code-boundary-spacer/, 'inline code boundary spacer should have explicit styling');
assert.match(styles, /pme-inline-code-outside-boundary[\s\S]+caret-color:\s*transparent/, 'native caret hiding should be scoped to inline code outside-boundary only');
assert.match(styles, /pme-inline-code-outside-boundary \.pme-inline-code-boundary-spacer::before/, 'inline code outside-boundary should draw a scoped overlay caret on the spacer');
assert.match(styles, /pme-inline-source-token/, 'inline source token affordances should have explicit styling');
assert.match(styles, /\.pme-table-toolbar[\s\S]+position:\s*fixed/, 'table editing toolbar should be a floating viewport-positioned control');
assert.match(styles, /\.pme-table-toolbar button[\s\S]+border-radius:\s*0\.35rem/, 'table editing toolbar buttons should stay compact and below 8px radius');
assert.match(styles, /pme-link-href-editor[\s\S]+display:\s*inline-flex/, 'link href editor should render inline with the link source affordance');
assert.match(styles, /pme-link-href-popover[\s\S]+display:\s*none[\s\S]+pme-link-href-popover\.is-open[\s\S]+display:\s*inline-flex/, 'link href editor popover should stay hidden until activated');
assert.match(styles, /pme-link-href-input[\s\S]+font-family:\s*var\(--mono\)/, 'link href editor input should use compact source-style monospace styling');
assert.match(styles, /pme-link-href-popover[\s\S]+width:\s*min\(56rem, calc\(100vw - 1\.5rem\)\)/, 'link href editing should use the available viewport width');
assert.match(styles, /pme-link-href-input[\s\S]+overflow-wrap:\s*anywhere;[\s\S]+white-space:\s*pre-wrap;/, 'long link URLs should wrap without clipping');
assert.match(index, /<textarea id="inlineInsertTarget"[^>]+rows="3"[^>]+wrap="soft"/, 'link and image insertion should provide a wrapping target editor');
assert.doesNotMatch(styles, /pme-inline-mark-caret|pme-inline-mark-boundary|pme-inline-mark-range/, 'rich editor CSS should not restore the old inline mark caret replacement classes');
assert.match(styles, /pme-node-source-editor/, 'rich atom source editors should have explicit styling');
assert.match(styles, /pme-math-node,\s*\n\.rich-editor \.pme-mermaid-node,\s*\n\.rich-editor \.pme-toc-node \{\s*\n\s*cursor:\s*text;/, 'rich atom nodes should indicate that clicking focuses their source editor');
assert.match(styles, /pme-mermaid-node\.is-editing-source/, 'focused Mermaid source editing should have a visible node outline');
assert.match(styles, /pme-node-source-editor\.pme-node-source-popover/, 'atom source editors should be styled as popovers outside the ProseMirror editable DOM');
assert.match(styles, /pme-node-source-editor--math-inline[\s\S]+line-height:\s*1\.35/, 'inline KaTeX source overlay should be compact like other inline editing affordances');
assert.match(styles, /pme-node-source-editor\.pme-node-source-popover\.pme-node-source-editor--math-inline[\s\S]+background:\s*transparent;[\s\S]+box-shadow:\s*none;/, 'inline KaTeX source editor should render like replacement inline source text instead of a bordered popover');
assert.match(styles, /pme-node-source-editor--math-inline \.pme-node-source-delimiter[\s\S]+color:\s*color-mix\(in srgb, var\(--muted\) 76%, transparent\)/, 'inline KaTeX Markdown delimiters should be visually muted while editing');
assert.match(styles, /pme-node-source-editor--math-inline \.pme-node-source-editor-input[\s\S]+background:\s*transparent;[\s\S]+border:\s*0;/, 'inline KaTeX editable latex text should not draw a nested input frame');
assert.match(styles, /math-inline\.pme-math-node\.is-editing-source\s*\{[\s\S]+outline:\s*none;/, 'inline KaTeX source editing should not draw a block atom outline');
assert.match(styles, /math-inline\.pme-math-node\.is-editing-source \.pme-node-rendered-preview[\s\S]+display:\s*none;/, 'inline KaTeX rendered node should be replaced by source while editing');
assert.match(styles, /pme-inline-math-edit-preview[\s\S]+position:\s*absolute;[\s\S]+top:\s*calc\(100% \+ 0\.65rem\)/, 'inline KaTeX editing should show a rendered preview below the inline source without overlap');
assert.match(styles, /box-sizing:\s*border-box/, 'atom source editor popovers should include padding and border inside their constrained viewport width');
assert.match(styles, /textarea\.pme-node-source-editor\.pme-node-source-popover[\s\S]+overflow:\s*auto/, 'textarea atom source editor popovers should scroll internally instead of overflowing the viewport');
assert.match(styles, /pme-node-source-popover:not\(\.is-source-popover-open\)[\s\S]+display:\s*none/, 'atom source editor popovers should stay hidden until the node is activated');
assert.doesNotMatch(proseMirrorBundle, /__MODULES__/, 'ProseMirror bundle placeholder must not leak into serializer replacement strings');
assert.doesNotMatch(proseMirrorBundle, /\beval\b/, 'ProseMirror bundle must not contain eval');
assert.doesNotMatch(proseMirrorBundle, /new\s+Function\b/, 'ProseMirror bundle must not contain new Function');
assert.doesNotMatch(proseMirrorBundle, /\bfetch\b/, 'ProseMirror bundle must not contain fetch');
assert.doesNotMatch(proseMirrorBundle, /XMLHttpRequest/, 'ProseMirror bundle must not contain XMLHttpRequest');
assert.doesNotMatch(proseMirrorBundle, /WebSocket/, 'ProseMirror bundle must not contain WebSocket');
assert.doesNotMatch(proseMirrorBundle, /\bWorker\b/, 'ProseMirror bundle must not contain Worker');
assert.match(proseMirrorBundle, /normalizeMarkdown/, 'ProseMirror bundle should expose a Markdown round-trip diagnostic');
assert.match(proseMirrorBundle, /image\.addEventListener\('error',[\s\S]+renderBlocked/, 'ProseMirror images should replace failed loads with a reasoned placeholder');
assert.match(proseMirrorBundle, /pme_math_display[\s\S]+alt:\s*\['paragraph'/, 'display math should interrupt an immediately preceding paragraph');

const MarkdownIt = require('../vendor/markdown-it/markdown-it.min.js');
const proseMirrorContext = {
  window: { markdownit: MarkdownIt },
  navigator: { userAgent: 'node' },
  document: {
    documentElement: { style: {} },
    createElement() {
      return { style: {}, setAttribute() {}, appendChild() {} };
    },
  },
  console,
};
proseMirrorContext.window.window = proseMirrorContext.window;
proseMirrorContext.window.navigator = proseMirrorContext.navigator;
proseMirrorContext.window.document = proseMirrorContext.document;
vm.runInNewContext(proseMirrorBundle, proseMirrorContext);
assert.equal(
  proseMirrorContext.window.PMEProseMirror.normalizeMarkdown('\\- a'),
  '\\- a',
  'literal paragraph text beginning with "- " should escape to \\- without leaking bundle placeholders',
);
assert.equal(
  proseMirrorContext.window.PMEProseMirror.normalizeMarkdown('[x](a(b)c)'),
  '[x](a\\(b\\)c)',
  'link targets should escape parentheses without leaking bundle placeholders',
);
assert.equal(
  proseMirrorContext.window.PMEProseMirror.normalizeMarkdown(String.raw`![img](<C:\Users\rokuh\Documents\sample image.png>)`),
  String.raw`![img](<C:\Users\rokuh\Documents\sample image.png>)`,
  'Windows image paths should not turn backslashes into percent encoding during rich-mode round trips',
);
assert.equal(
  proseMirrorContext.window.PMEProseMirror.normalizeMarkdown(String.raw`Inline \(x^2+y^2\) and $z=1$`),
  'Inline $x^2+y^2$ and $z=1$',
  'both inline math delimiter styles should survive rich-mode normalization',
);
assert.equal(
  proseMirrorContext.window.PMEProseMirror.normalizeMarkdown(String.raw`\[x^2+y^2\]`),
  '$$\nx^2+y^2\n$$',
  'bracket display math should survive rich-mode normalization',
);
assert.equal(
  proseMirrorContext.window.PMEProseMirror.normalizeMarkdown([
    '$$',
    String.raw`\begin{aligned}`,
    String.raw`x &= y \\`,
    '+ z &= 1',
    String.raw`\end{aligned}`,
    '$$',
  ].join('\n')),
  [
    '$$',
    String.raw`\begin{aligned}`,
    String.raw`x &= y \\`,
    '+ z &= 1',
    String.raw`\end{aligned}`,
    '$$',
  ].join('\n'),
  'multiline display math must keep a leading + line inside the formula',
);
assert.equal(
  proseMirrorContext.window.PMEProseMirror.normalizeMarkdown([
    '各回帰式は次の形である。',
    '$$',
    String.raw`\log D_{a,h,d}`,
    String.raw`=\beta_{0,a,h}`,
    String.raw`+ \sum_{j=1}^{p}\beta_{j,a,h}X_{j,a,h,d}`,
    '$$',
    'ここで、各記号を定義する。',
  ].join('\n')),
  [
    '各回帰式は次の形である。',
    '',
    '$$',
    String.raw`\log D_{a,h,d}`,
    String.raw`=\beta_{0,a,h}`,
    String.raw`+ \sum_{j=1}^{p}\beta_{j,a,h}X_{j,a,h,d}`,
    '$$',
    '',
    'ここで、各記号を定義する。',
  ].join('\n'),
  'display math should interrupt a preceding paragraph without requiring a blank source line',
);
assert.equal(
  proseMirrorContext.window.PMEProseMirror.normalizeMarkdown([
    '$$ x = y',
    '+ z = 1',
    '$$',
  ].join('\n')),
  '$$\nx = y\n+ z = 1\n$$',
  'display math beginning on the opening delimiter line must keep a leading + line out of Markdown lists',
);
assert.equal(
  proseMirrorContext.window.PMEProseMirror.normalizeMarkdown([
    String.raw`\[ x = y`,
    String.raw`+ z = 1 \]`,
  ].join('\n')),
  '$$\nx = y\n+ z = 1\n$$',
  'bracket display math spanning delimiter lines must keep a leading + line inside the formula',
);
const extendedRoundTrip = proseMirrorContext.window.PMEProseMirror.normalizeMarkdown([
  '# Extended PM',
  '',
  '[toc]',
  '',
  '- [ ] todo',
  '- [x] done',
  '',
  '| A | B |',
  '| --- | --- |',
  '| C | D |',
  '',
  '$$',
  'x = y + z',
  '$$',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Start] --> B[End]',
  '```',
].join('\n'));
assert.match(extendedRoundTrip, /^\[toc\]$/m, 'TOC marker should survive ProseMirror normalization');
assert.match(extendedRoundTrip, /- \[ \] todo\n- \[x\] done/, 'task list markers should survive ProseMirror normalization');
assert.match(extendedRoundTrip, /\| A \| B \|\n\| --- \| --- \|\n\| C \| D \|/, 'tables should survive ProseMirror normalization');
assert.match(extendedRoundTrip, /\$\$\nx = y \+ z\n\$\$/, 'display math should survive ProseMirror normalization');
assert.match(extendedRoundTrip, /```mermaid\nflowchart TD\n  A\[Start\] --> B\[End\]\n```/, 'Mermaid fences should survive ProseMirror normalization');
assert.doesNotMatch(extendedRoundTrip, /pme-table(?!-toolbar)|pme-math-display|\\\[(?:toc| |x)/, 'ProseMirror protection markers and syntax escapes must not leak into Markdown source');

assert.match(app, /html:\s*false/, 'markdown-it raw HTML must remain disabled');
assert.match(app, /securityLevel:\s*'strict'/, 'Mermaid strict security level must remain enabled');
assert.match(app, /htmlLabels:\s*false/, 'Mermaid HTML labels must remain disabled');
assert.match(app, /showDirectoryPicker/, 'File System Access API folder picker should be supported when available');
assert.match(read('docs/third-party-licenses.md'), /Mermaid package dependency license review/);
assert.match(read('docs/third-party-licenses.md'), /REVIEW REQUIRED/);

console.log('vendor static checks passed');

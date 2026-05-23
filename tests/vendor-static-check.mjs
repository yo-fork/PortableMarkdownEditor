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
const app = read('app.js');
const styles = read('styles.css');

assert.doesNotMatch(index, /<(?:script|link)\b[^>]+(?:src|href)=["']https?:\/\//i, 'index.html must not load remote JS/CSS');
assert.match(index, /connect-src 'none'/, 'CSP must keep connect-src none');
assert.match(index, /script-src 'self'/, 'CSP must keep script-src self');
assert.match(index, /type="importmap"/, 'CodeMirror import map should be embedded for file:// support');
assert.match(index, /vendor\/codemirror6\/node_modules\/@codemirror\/view\/dist\/index\.js/, 'CodeMirror imports should resolve to vendored local files');
assert.match(index, /vendor\/prosemirror\/prosemirror-editor\.js/, 'ProseMirror should load from the local classic script bundle');
assert.match(index, /style-src 'self' 'unsafe-inline'/, 'CSP must allow Mermaid/KaTeX inline styles only');
assert.doesNotMatch(index, /frame-ancestors/, 'meta CSP must not include ignored frame-ancestors directive');

assert.doesNotMatch(app, /\beval\b/, 'app.js must not contain eval');
assert.doesNotMatch(app, /new\s+Function\b/, 'app.js must not contain new Function');
assert.doesNotMatch(app, /\bfetch\b/, 'app.js must not contain fetch');
assert.doesNotMatch(app, /XMLHttpRequest/, 'app.js must not contain XMLHttpRequest');
assert.doesNotMatch(app, /WebSocket/, 'app.js must not contain WebSocket');
assert.doesNotMatch(app, /\bWorker\b/, 'app.js must not contain Worker');
assert.match(app, /import\('\.\/vendor\/codemirror6\/source-editor\.js'\)/, 'app.js should load the vendored source editor wrapper only');
assert.match(app, /function\s+syncCodeMirrorSourceFromTextarea/, 'textarea mirror should stay synchronized with CodeMirror source edits');
assert.match(app, /function\s+renderProseMirrorRich/, 'app.js should integrate the vendored ProseMirror rich editor');
assert.match(app, /function\s+renderReadOnlyRichFallback/, 'ProseMirror fallback should be read-only');
assert.match(app, /removeAttribute\('contenteditable'\)/, 'rich fallback should remove legacy contenteditable editing');
assert.match(app, /function\s+focusProseMirrorTarget/, 'ProseMirror clicks should explicitly focus the inner editor surface');
assert.match(app, /function\s+focusProseMirrorSelection/, 'ProseMirror selections should keep focus on the inner editor surface');
assert.match(app, /function\s+scheduleProseMirrorFocus/, 'ProseMirror focus should be deferred until the browser has applied the clicked DOM selection');
assert.match(app, /focus\(\{\s*preventScroll:\s*true\s*\}\)/, 'ProseMirror focus restoration should preserve the clicked DOM selection');
assert.match(app, /if \(focusProseMirrorSelection\(\)\) return;/, 'selection changes inside ProseMirror should bypass legacy rich selection handling');
assert.match(app, /addEventListener\('pointerdown', onRichPointerDownCapture, true\)/, 'ProseMirror should receive DOM focus before browser click selection');
assert.match(app, /function\s+onRichPointerDownCapture[\s\S]*?focusProseMirrorElement\(proseMirror\);/, 'pointerdown focus should use DOM focus without scheduling restoration before the clicked selection exists');
assert.match(app, /if \(isProseMirrorRichTarget\(target\)\) \{\s*focusProseMirrorTarget\(target\);\s*return;\s*\}/, 'legacy rich click handling should not steal ProseMirror clicks');
assert.match(app, /function\s+isProseMirrorRichEventContext[\s\S]+document\.activeElement[\s\S]+selection\?\.anchorNode/, 'legacy rich event guards should recognize ProseMirror paste contexts even when the event target is the outer rich container');
assert.match(app, /function\s+onRichPaste[\s\S]+if \(isProseMirrorRichEventContext\(event\)\) return;/, 'legacy rich paste handling should not duplicate ProseMirror-managed paste transactions');
const proseMirrorBundle = read('vendor/prosemirror/prosemirror-editor.js');
assert.match(proseMirrorBundle, /global\.PMEProseMirror/, 'ProseMirror bundle should expose one local global');
assert.doesNotMatch(proseMirrorBundle, /splitParagraphStartIntoEmptyBefore/, 'paragraph-start Enter should use the ProseMirror standard behavior');
assert.match(proseMirrorBundle, /keys\.Enter = commands\.chainCommands\(\s*tableCellEnterCommand,\s*extendedBlockInputCommand,\s*fencedCodeBlockInputCommand,\s*repairEmptyListItemWithChildList\(listItem\),\s*exitEmptyListItemToParagraph\(listItem\),\s*schemaList\.splitListItem\(listItem\),\s*commands\.baseKeymap\.Enter\s*\)/, 'table cells should handle Enter before rich block Markdown shortcuts and list Enter falls through to the ProseMirror standard splitListItem command');
assert.doesNotMatch(proseMirrorBundle, /exitListItemWithChildListToParagraph|splitListItemAfterChildList/, 'list items with child lists should use the ProseMirror standard split behavior instead of a custom split/exit command');
assert.match(proseMirrorBundle, /function\s+repairEmptyListItemWithChildList[\s\S]+previousItem\.content\.append\(model\.Fragment\.fromArray\(movedChildren\)\)[\s\S]+replaceWith\(previousStart, currentEnd, nextPreviousItem\)/, 'Enter on an empty list item with a child list should delete the empty item and move the child list back to the previous item');
assert.match(proseMirrorBundle, /function\s+exitEmptyListItemToParagraph[\s\S]+tr\.insert\(insertPos, paragraphNode\)/, 'Enter on an empty list item should leave list mode as a paragraph instead of repeatedly lifting empty bullets');
assert.match(proseMirrorBundle, /var tableModule = requireModule\('prosemirror-tables'\)/, 'ProseMirror rich editor should bundle prosemirror-tables');
assert.match(proseMirrorBundle, /tableModule\.tableNodes\(\{[\s\S]+cellContent:\s*'inline\*'/m, 'table schema should come from prosemirror-tables with inline cell content');
assert.match(proseMirrorBundle, /tableModule\.tableEditing\(\)/, 'ProseMirror table editing plugin should be installed');
assert.match(proseMirrorBundle, /math_inline:\s*\{[\s\S]+atom:\s*true/m, 'ProseMirror schema should define atom inline math nodes');
assert.match(proseMirrorBundle, /math_display:\s*\{[\s\S]+atom:\s*true/m, 'ProseMirror schema should define atom display math nodes');
assert.match(proseMirrorBundle, /mermaid_block:\s*\{[\s\S]+atom:\s*true/m, 'ProseMirror schema should define atom Mermaid nodes');
assert.match(proseMirrorBundle, /toc_block:\s*\{[\s\S]+atom:\s*true/m, 'ProseMirror schema should define atom TOC nodes');
assert.doesNotMatch(proseMirrorBundle, /pme-(?:table|math-display)/, 'table and display math should not depend on protected fence fallback markers');
assert.match(proseMirrorBundle, /'Shift-Enter': commands\.chainCommands\(commands\.newlineInCode, insertHardBreakCommand\)/, 'Shift+Enter should insert a ProseMirror hard_break node');
assert.match(proseMirrorBundle, /replaceSelectionWith\(hardBreak\.create\(\)\)/, 'hard break insertion should use a ProseMirror transaction');
assert.match(proseMirrorBundle, /'Backspace': commands\.chainCommands\(joinParagraphAfterListIntoPreviousItem, inputRulesModule\.undoInputRule, commands\.baseKeymap\.Backspace\)/, 'Backspace after a list should merge into the previous list item before falling through');
assert.match(proseMirrorBundle, /\.delete\(selection\.\$from\.before\(paragraphDepth\), selection\.\$from\.after\(paragraphDepth\)\)\s*\.insert\(insertPos, paragraph\.content\)/, 'paragraph-after-list Backspace should move paragraph content into the previous list item');
assert.match(proseMirrorBundle, /var inputRulesModule = requireModule\('prosemirror-inputrules'\)/, 'ProseMirror rich editor should use vendored Markdown input rules');
assert.match(proseMirrorBundle, /wrappingInputRule\(\/\^\\s\*\(\[-\+\*\]\)\\s\$\/, schema\.nodes\.bullet_list\)/, 'typing a Markdown bullet marker should create a bullet list');
assert.ok(proseMirrorBundle.includes('wrappingInputRule(/^\\s*>\\s$/, schema.nodes.blockquote)'), 'typing a Markdown quote marker should create a blockquote');
assert.match(proseMirrorBundle, /textblockTypeInputRule\(\s*\/\^\(#\{1,6\}\)\\s\$\/,\s*schema\.nodes\.heading/, 'typing a Markdown heading marker should create a heading');
assert.match(proseMirrorBundle, /function\s+fencedCodeBlockInputCommand[\s\S]+schema\.nodes\.code_block\.create/, 'typing a Markdown code fence and pressing Enter should create a code block');
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
assert.match(proseMirrorBundle, /function\s+inlineMarkInputRule[\s\S]+clearStoredMarks\(tr\)/, 'inline mark input rules should stop marks from leaking into following text');
assert.match(proseMirrorBundle, /function\s+emptyTextblockStoredMarksCleanupPlugin[\s\S]+transaction\.docChanged[\s\S]+selectionIsEmptyInlineTextblock\(newState\.selection\)[\s\S]+clearStoredMarks\(newState\.tr\)/, 'deleting all text from a marked textblock should clear stored marks before the next typed character');
assert.match(proseMirrorBundle, /emptyTextblockStoredMarksCleanupPlugin\(\)/, 'empty textblock stored mark cleanup plugin should be installed');
assert.match(proseMirrorBundle, /inlineMarkInputRule\(\/\\\*\\\*\(\[\^\*\\n\]\+\)\\\*\\\*\$\/, schema\.marks\.strong\)/, 'typing Markdown bold should create a strong mark');
assert.match(proseMirrorBundle, /inlineMarkInputRule\(\/\(\^\|\[\^\*\]\)\\\*\(\[\^\*\\n\]\+\)\\\*\$\/, schema\.marks\.em, null, \{ contentIndex: 2, preservePrefixIndex: 1 \}\)/, 'typing Markdown italic should create an em mark without stealing bold markers');
assert.match(proseMirrorBundle, /function\s+linkInputRule[\s\S]+schema\.marks\.link/, 'typing Markdown links should create link marks');
assert.match(proseMirrorBundle, /function\s+imageInputRule[\s\S]+schema\.nodes\.image\.create/, 'typing Markdown images should create image nodes');
assert.match(proseMirrorBundle, /inputRulesModule\.undoInputRule/, 'Backspace should be able to undo a just-applied Markdown input rule');
assert.match(proseMirrorBundle, /'ArrowLeft': enterStoredMarksAtInlineBoundaryCommand/, 'ArrowLeft at the outside end of a marked span should switch the caret back inside the mark');
assert.match(proseMirrorBundle, /'ArrowRight': clearStoredMarksAtInlineBoundaryCommand/, 'ArrowRight at the end of a marked span should switch the caret to the outside of the mark');
assert.match(proseMirrorBundle, /handleClick:\s*setSelectionFromSingleClick/, 'single clicks should update the ProseMirror selection through the editor model');
assert.match(proseMirrorBundle, /state\.TextSelection\.create\(doc, bounded\)/, 'click selection should be represented as a ProseMirror TextSelection');
assert.match(proseMirrorBundle, /function\s+shouldClearStoredMarksAtInlineBoundary[\s\S]+model\.Mark\.sameSet\(before\.marks, after\.marks\)/, 'marked span boundaries should be detected without treating the middle of a mark as outside');
assert.match(proseMirrorBundle, /function\s+enterStoredMarksAtInlineBoundaryCommand[\s\S]+setStoredMarks\(marks\)/, 'ArrowLeft should re-enter inline marks without moving to the start of the marked text');
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
assert.doesNotMatch(styles, /pme-inline-mark-caret|pme-inline-mark-boundary|pme-inline-mark-range/, 'rich editor CSS should not restore the old inline mark caret replacement classes');
assert.doesNotMatch(proseMirrorBundle, /__MODULES__/, 'ProseMirror bundle placeholder must not leak into serializer replacement strings');
assert.doesNotMatch(proseMirrorBundle, /\beval\b/, 'ProseMirror bundle must not contain eval');
assert.doesNotMatch(proseMirrorBundle, /new\s+Function\b/, 'ProseMirror bundle must not contain new Function');
assert.doesNotMatch(proseMirrorBundle, /\bfetch\b/, 'ProseMirror bundle must not contain fetch');
assert.doesNotMatch(proseMirrorBundle, /XMLHttpRequest/, 'ProseMirror bundle must not contain XMLHttpRequest');
assert.doesNotMatch(proseMirrorBundle, /WebSocket/, 'ProseMirror bundle must not contain WebSocket');
assert.doesNotMatch(proseMirrorBundle, /\bWorker\b/, 'ProseMirror bundle must not contain Worker');
assert.match(proseMirrorBundle, /normalizeMarkdown/, 'ProseMirror bundle should expose a Markdown round-trip diagnostic');

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
assert.doesNotMatch(extendedRoundTrip, /pme-(?:table|math-display)|\\\[(?:toc| |x)/, 'ProseMirror protection markers and syntax escapes must not leak into Markdown source');

assert.match(app, /html:\s*false/, 'markdown-it raw HTML must remain disabled');
assert.match(app, /securityLevel:\s*'strict'/, 'Mermaid strict security level must remain enabled');
assert.match(app, /htmlLabels:\s*false/, 'Mermaid HTML labels must remain disabled');
assert.match(app, /showDirectoryPicker/, 'File System Access API folder picker should be supported when available');
assert.match(read('docs/third-party-licenses.md'), /Mermaid package dependency license review/);
assert.match(read('docs/third-party-licenses.md'), /REVIEW REQUIRED/);

console.log('vendor static checks passed');

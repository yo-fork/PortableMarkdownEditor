import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const securitySample = readFileSync(new URL('../samples/security-check.md', import.meta.url), 'utf8');

assert.match(index, /Content-Security-Policy/);
assert.match(index, /default-src 'none'/);
assert.match(index, /connect-src 'none'/);
assert.match(index, /script-src 'self'/);
assert.match(index, /style-src 'self' 'unsafe-inline'/);
assert.doesNotMatch(index, /frame-ancestors/, 'frame-ancestors is ignored in meta CSP and should not be present');
assert.match(index, /img-src 'self' data: blob:/);
assert.doesNotMatch(index, /img-src[^"]*file:/, 'file: images should not be allowed by CSP');
assert.doesNotMatch(index, /https?:\/\/.*\.(js|css)/i, 'no external JS/CSS');

assert.match(app, /function\s+sanitizeLinkUrl/);
assert.match(app, /function\s+sanitizeImageUrl/);
assert.match(app, /function\s+normalizeLocalImageUrl/);
assert.match(app, /function\s+renderMermaidBlock/);
assert.match(app, /function\s+highlightCode/);
assert.match(app, /javascript:alert\(1\)/, 'sample malicious link should exist in default markdown');
assert.match(app, /data:image\\\/\(png\|jpeg\|jpg\|gif\|webp\)/, 'only raster data images should be allowed');
assert.match(securitySample, /https:\/\/example\.com\/tracker\.png/, 'sample remote image should be tested');
assert.match(securitySample, /\\\\server\\share\\local sample\.webp/, 'UNC image sample should exist');
assert.match(app, /pme_task_lists/, 'markdown-it task list extension should be enabled');
assert.match(app, /html:\s*false/, 'markdown-it raw HTML must remain disabled');
assert.match(app, /securityLevel:\s*'strict'/, 'Mermaid strict mode should remain enabled');
assert.match(app, /htmlLabels:\s*false/, 'Mermaid HTML labels should remain disabled');
assert.match(app, /mermaidRenderQueue/, 'Mermaid renders should be serialized to avoid shared scratch DOM races');
assert.match(app, /async function\s+renderMermaidTargets/, 'Mermaid render queue should process targets sequentially');
assert.doesNotMatch(app, /isSimpleLocalFlowchart\(source\)\)\s*return/, 'runtime flowcharts should not skip Mermaid.js rendering');
assert.match(index, /id="codeLanguageOptions"/, 'code language suggestion list should exist');
assert.match(index, /id="markdownEntryDialog"/, 'folder Markdown selection should use an app dialog');
assert.match(index, /data-action="grant-folder"/, 'current document should support granting folder access without reopening Markdown');
assert.match(index, /id="settingsInput"/, 'settings import should use a user-selected local JSON file');
assert.match(index, /data-action="import-settings"/, 'link allowlist settings should be importable from a local file');
assert.match(index, /data-action="export-settings"/, 'link allowlist settings should be exportable to a local file');
assert.match(index, /data-action="grant-settings-folder"/, 'settings folder should be grantable for persisted config loading');
assert.match(index, /data-action="save-settings-file"/, 'settings folder config should be overwritable after permission');
assert.match(index, /data-action="clear-draft"/, 'draft deletion button should exist');
assert.match(index, /data-action="reset-settings"/, 'settings reset button should exist');
assert.match(index, /data-action="clear-allowed-domains"/, 'allowed domain deletion button should exist');
assert.match(index, /data-action="clear-folder-permissions"/, 'folder permission record deletion button should exist');
assert.match(index, /data-action="clear-all-local-data"/, 'all local data deletion button should exist');
assert.match(app, /code-language-input/, 'rendered code blocks should expose a language input');
assert.match(app, /showOpenFilePicker/, 'Open should use File System Access API when available');
assert.match(app, /function\s+requestDirectoryForOpenedMarkdown/, 'opened Markdown files should be able to request containing folder access');
assert.match(app, /async function\s+grantFolderForCurrentDocument/, 'folder permission should be attachable to the current document without reloading contents');
assert.match(app, /async function\s+grantFolderEntriesForCurrentDocument/, 'folder permission attachment should reuse current Markdown state');
assert.match(app, /captureCurrentMarkdownFromEditor\(\)/, 'granting folder access should capture current edits before attaching folder access');
assert.match(app, /isSameEntry\(fileHandle\)/, 'selected directory should be matched to the opened file handle when possible');
assert.match(app, /showDirectoryPickerFromRecentDirectory/, 'folder picker should use recent Markdown directories when available');
assert.match(app, /mode:\s*'readwrite'/, 'folder picker should request write access for assets image insertion');
assert.match(app, /startIn/, 'file and folder pickers should support starting in the Markdown or previous directory');
assert.match(app, /FSA_PICKER_START_HANDLE_KEY/, 'previous picker directory handle should be remembered locally');
assert.match(app, /MAX_FOLDER_SCAN_FILES\s*=\s*5000/, 'folder scans should cap the number of files inspected');
assert.match(app, /MAX_FOLDER_SCAN_DEPTH\s*=\s*8/, 'folder scans should cap recursive depth');
assert.match(app, /folderScanLimitMessage/, 'folder scan limits should be reported to the user');
assert.match(index, /id="folderScanWarningDialog"/, 'large folder scan warnings should have a visible dialog');
assert.match(app, /function\s+warnFolderScanLimitIfNeeded/, 'large folder scan warnings should be shown to the user');
assert.match(app, /async function\s+insertImageFilesAsAssets/, 'pasted and dropped images should be routed through assets insertion');
assert.match(app, /async function\s+insertImageFilesAsAssets[\s\S]+guardUnsupportedImageInsertionContext\(insertionContext,\s*actionLabel\)[\s\S]+ensureImageAssetWriteAccess/, 'image asset insertion should reject unsupported rich source selections before saving files');
assert.match(app, /function\s+guardUnsupportedImageInsertionContext[\s\S]+richSourceBlocksIntersectingRange\(range\)[\s\S]+richRangeExtendsOutsideSourceBlock\(range,\s*sourceBlock\)[\s\S]+この選択では画像を挿入できません/, 'image asset insertion should not save files for cross-block source-backed selections');
assert.match(app, /function\s+beginImageInsertion[\s\S]+guardUnsupportedImageInsertionContext\(state\.pendingImageInsertionContext,\s*'画像挿入'\)[\s\S]+state\.pendingImageInsertionContext = null/, 'image picker should block unsupported rich source selections before opening a file chooser');
assert.match(app, /function\s+createImageInsertionContext[\s\S]+richInlineInsertRangeFromSelection\(selection\)[\s\S]+sourceRange/, 'rich image asset insertion should capture a source range before async file saving');
assert.match(app, /function\s+insertMarkdownAtImageContext[\s\S]+insertRichImageMarkdownAtSourceContext\(markdown,\s*context\)[\s\S]+restoreImageInsertionRange\(context\)/, 'rich image asset insertion should prefer source transactions before restoring a DOM range');
assert.match(app, /function\s+insertRichImageMarkdownAtSourceContext[\s\S]+insertInlineMarkdownAtCapturedContext\(\{ mode:\s*'rich',\s*range:\s*\{ from,\s*to \} \}/, 'rich image asset insertion should write captured source ranges through the inline transaction path');
assert.match(app, /async function\s+onImageChosen[\s\S]+insertImageFilesAsAssets/, 'image picker should also use assets insertion instead of Data URLs');
assert.doesNotMatch(app, /readAsDataURL/, 'image picker must not embed selected images as large Data URLs');
assert.match(app, /createWritable\(\)/, 'assets image insertion should write through File System Access API');
assert.match(app, /async function\s+saveMarkdownToOpenedFile/, 'save should overwrite the opened Markdown file when File System Access folder permission exists');
assert.match(app, /function\s+renderBlockedImage/, 'blocked or unresolved images should show an explanatory placeholder');
assert.match(app, /RICH_INLINE_SOURCE_SELECTOR[\s\S]+\.blocked-image/, 'unresolved image placeholders should participate in inline source editing');
assert.match(app, /classList\?\.contains\('blocked-image'\)[\s\S]+serializeBlockedImageElement/, 'unresolved image placeholders should restore Markdown image source while editing');
assert.match(app, /function\s+hasNonCollapsedRichSelection/, 'rich editor should preserve normal text range selection');
assert.match(app, /function\s+decodeLocalImagePath/, 'percent-encoded local image paths should be normalized before validation');
assert.match(app, /function\s+snapshotRichDeleteFromKeydown/, 'rich delete operations should be undoable even when beforeinput is skipped');
assert.match(app, /フォルダが許可されていない/, 'missing folder permission should be explained to the user');
assert.match(app, /addEventListener\('drop', onEditorDrop\)/, 'editors should accept dropped image files');
assert.match(app, /addEventListener\('paste', onMarkdownPaste\)/, 'source editor should handle pasted image files');
assert.match(app, /dataset\.folderAccess = state\.directoryHandle \? 'fsa'/, 'UI should expose when the current folder came from File System Access API');
assert.match(app, /function\s+restorePersistedDirectoryHandle/, 'File System Access directory handles should be restorable after reopening');
assert.match(app, /window\.indexedDB\.open\(FSA_DB_NAME,\s*1\)/, 'persisted File System Access handles should use local IndexedDB only');
assert.match(app, /persistDirectoryHandle\(directoryHandle\)/, 'opened File System Access directory handle should be persisted for reopen');
assert.match(app, /function\s+parseAllowedDomainsSettings/, 'settings file import should parse allowedLinkDomains explicitly');
assert.match(app, /function\s+exportSettingsFile/, 'settings file export should be available without network access');
assert.match(app, /allowedLinkDomains:\s*normalizeDomainList\(state\.allowedLinkDomains\)/, 'settings export should write normalized link allowlist domains');
assert.match(app, /CONFIG_SETTINGS_FILE_NAME\s*=\s*'portable-markdown-editor-settings\.json'/, 'settings folder should use a stable local config filename');
assert.match(app, /function\s+restorePersistedSettingsDirectoryHandle/, 'persisted settings directory should be loaded on startup when permission remains granted');
assert.match(app, /function\s+saveSettingsToConfigDirectory/, 'settings config file should be overwritable through File System Access API');
assert.match(app, /getFileHandle\(CONFIG_SETTINGS_FILE_NAME,\s*\{\s*create:\s*true\s*\}\)/, 'settings config save should write the local config JSON file');
assert.match(app, /localStorage\.removeItem\(STORAGE_KEY\)/, 'draft deletion should remove the localStorage draft key');
assert.match(app, /localStorage\.removeItem\(SETTINGS_KEY\)/, 'settings reset should remove the localStorage settings key');
assert.match(app, /window\.indexedDB\.deleteDatabase\(FSA_DB_NAME\)/, 'folder permission record deletion should remove the FSA IndexedDB database');
assert.match(app, /function\s+clearAllLocalData/, 'all local data deletion should be implemented behind confirmation');
assert.match(app, /function\s+richInlineSourceShouldStayLiteral/, 'incomplete non-emphasis rich inline Markdown sources should stay literal');
assert.match(app, /function\s+isCompleteSingleRichInlineMarkdownSource/, 'completed rich inline Markdown sources should still reparse when delimiters are balanced');
assert.match(app, /function\s+mergeAdjacentTextNodesForMarkdownTrigger/, 'rich Markdown triggers should see adjacent text nodes as one editing run');
assert.match(app, /function\s+applyRichInlineMarkdownRunTrigger/, 'typing a delimiter near rendered inline Markdown should reparse the local inline run');
assert.match(app, /function\s+applyRichInlineMarkdownTrigger[\s\S]+richSelectionRange\(selection\)[\s\S]+textCaretForMarkdownTrigger\(range\)/, 'completed rich inline Markdown triggers should derive caret ranges from validated rich selections');
assert.match(app, /function\s+applyRichInlineMarkdownRunTrigger[\s\S]+richSelectionRange\(selection\)[\s\S]+reparseRichInlineEditBlockContent/, 'rich inline run reparsing should derive caret ranges from validated rich selections');
assert.match(app, /function\s+richInlineEditBlockFromSelection[\s\S]+richSelectionRange\(selection\)[\s\S]+richInlineEditBlockForRange\(range\)/, 'rich inline edit block detection should use validated rich selections');
assert.match(app, /function\s+parsePendingRichInlineMarkdownBeforePointer[\s\S]+richSelectionRange\(selection\)[\s\S]+richInlineEditBlockForRange\(range\)/, 'pending rich inline Markdown parsing should use validated rich selections before reparsing a block');
assert.match(app, /function\s+richInlineMarkdownBeforeCaretEndsWithCompletedToken/, 'rich inline reparsing should only run when the text immediately before the caret completed a Markdown token');
assert.match(app, /function\s+reparseRichInlineEditBlockContent/, 'inline source commits should reparse adjacent delimiters in the same editing block');
assert.match(app, /function\s+canOpenSingleDelimiterAt[\s\S]+text\[index - 2\] === delimiter/, 'dangling strong input such as **a* should stay literal until it can become **a**');
assert.match(app, /function\s+handleRichInlineBoundaryTextInput/, 'typing at a rendered inline boundary should insert outside the inline element');
assert.match(app, /function\s+wrapRenderedInlineAtoms/, 'rendered rich inline Markdown should be wrapped as atomic editing runs');
assert.match(app, /className\s*=\s*'rich-inline-atom'/, 'atomic inline runs should use a stable wrapper class');
assert.match(app, /contentEditable\s*=\s*'false'/, 'inactive inline runs should not accept browser DOM edits directly');
assert.match(app, /dataset\.inlineSource\s*=\s*source/, 'atomic inline runs should keep their Markdown source for source-island editing');
assert.doesNotMatch(app, /ownerDocument\s*!==\s*document/, 'detached local render fragments should still be eligible for inline atom wrapping');
assert.match(app, /RICH_CARET_TOKEN_PATTERN/, 'internal caret tokens should have one cleanup pattern');
assert.match(app, /function\s+stripRichCaretTokens/, 'internal caret tokens should be stripped before rendering or saving');
assert.match(app, /function\s+sanitizeRichCaretTokensInDom/, 'internal caret tokens should be removed from rich DOM text and data attributes');
assert.match(app, /function\s+buildBlockModel/, 'Markdown should be promoted to a block range model before rendering');
assert.match(app, /data-block-id/, 'rendered blocks should expose stable block ids');
assert.match(app, /data-block-type/, 'rendered blocks should expose block types');
assert.match(app, /function\s+annotateRenderedInlineAtomRanges/, 'atomic inline runs should receive source range metadata');
assert.match(app, /function\s+inlineRunsForBlockSource/, 'inline run source ranges should come from a scanner over block source');
assert.match(app, /function\s+domSelectionToSourceSelection/, 'rich selections should be convertible to source offsets');
assert.match(app, /function\s+domPointToSourceOffset[\s\S]+sourceBoundaryForAtomicBlockDomPoint/, 'selection endpoints inside atomic blocks should map to whole Markdown source block boundaries');
assert.match(app, /function\s+sourceBoundaryForAtomicBlockDomPoint[\s\S]+sourceStart[\s\S]+sourceEnd/, 'atomic block source boundary mapping should use rendered block source ranges');
assert.match(app, /function\s+domSelectionToSourceSelection[\s\S]+atomicSourceRangeForDomPoint[\s\S]+sourceBoundaryForAtomicSelectionEndpoint/, 'non-collapsed selections ending inside atomic blocks should include the whole atomic Markdown block');
assert.match(app, /function\s+sourceBoundaryForAtomicSelectionEndpoint[\s\S]+otherOffset[\s\S]+range\.end/, 'atomic selection endpoints should expand away from the opposite selection side');
assert.match(app, /function\s+domPointToSourceOffset[\s\S]+richListSourcePointFromRange/, 'rich list caret bookmarks should include Markdown list marker offsets');
assert.match(app, /function\s+sourceSelectionToDomRange/, 'source offsets should be restorable to DOM ranges');
assert.match(app, /affinity:\s*'before'|affinity:\s*'after'/, 'collapsed source selections should keep boundary affinity');
assert.match(app, /function\s+sourceOffsetToInlineDomRange/, 'source offsets after atomic inline runs should restore using Markdown source lengths');
assert.match(app, /function\s+sourceOffsetToListDomRange/, 'source selection restoration should understand list markers');
assert.match(app, /function\s+listItemSourceContentOffsetRange/, 'list source selection restoration should count atomic inline Markdown source lengths');
assert.match(app, /function\s+richListCaretSourceContentOffset/, 'rich list caret mapping should serialize Markdown sources before applying transactions');
assert.match(app, /function\s+isSourceTransactionTextRange[\s\S]+editBlock\.querySelector\('\.rich-inline-source, ul, ol'\)/, 'list items containing atomic inline runs should stay eligible for source transactions');
assert.match(app, /function\s+applySourceTransaction/, 'rich edits should be able to update Markdown through source transactions');
assert.match(app, /function\s+richInlineBoundaryInsertTransaction/, 'typing at an atomic inline boundary should use a source transaction');
assert.match(app, /function\s+handleRichInlineBoundaryTextInput[\s\S]+richSelectionRange\(selection\)[\s\S]+richInlineBoundaryInsertTransaction\(inlineElement,\s*event\.data/, 'atomic inline boundary typing should derive source transactions from validated rich selections');
assert.match(app, /function\s+richInlineSourceCommitTransaction/, 'committing a source island from an atomic inline should replace its Markdown source range');
assert.match(app, /function\s+isRichInlineSourceAlreadySynced/, 'inline source commit should not apply an already-synced source island twice');
assert.match(app, /function\s+patchRichBlockAfterTransaction/, 'source transactions should be able to re-render only the affected rich block');
assert.match(app, /oldRichBlock\.replaceWith\([\s\S]+catch \(_\)/, 'local rich block patches should fall back safely if the target was already replaced');
assert.match(app, /function\s+refreshRichSourceRangesFromMarkdown/, 'rich DOM block source ranges should be refreshed after local inline edits');
assert.match(app, /patchRichBlockAfterTransaction\(oldRichBlock[\s\S]+refreshRichSourceRangesFromMarkdown\(\)/, 'local rich block patches should refresh following block source ranges after Markdown length changes');
assert.match(app, /function\s+stabilizePatchedRichInlineBlocks/, 'locally patched rich blocks should keep completed inline runs atomic while nearby Markdown is incomplete');
assert.match(app, /function\s+stabilizeReparsedRichInlineBlock/, 'inline reparse should keep completed inline runs atomic while nearby Markdown is incomplete');
assert.match(app, /sourceSelection:\s*domSelectionToSourceSelection\(selection\)/, 'inline reparse should keep a source-offset caret fallback');
assert.match(app, /restoreRichCaretFromSourceSelection\(tokenSelection\)[\s\S]+restoreRichCaretFromSourceSelection\(options\.sourceSelection\)[\s\S]+restoreCaretFromTextToken/, 'inline reparse caret restore should prefer marker-derived source offsets, then selection source offsets, before marker text fallback');
assert.match(app, /function\s+commitRichInlineSourceAtBoundary[\s\S]+offsetAfterCommit[\s\S]+restoreRichCaretFromSourceSelection/, 'leaving an inline source island with arrow keys should restore the caret to the Markdown source boundary');
assert.match(app, /function\s+sourceSelectionFromRichInlineContentIndex/, 'inline reparse should derive caret source offsets from marker token positions');
assert.match(app, /function\s+serializeRichInlineEditBlockContentPreservingCaret/, 'inline reparse should preserve marker tokens only for caret offset calculation');
assert.match(app, /function\s+renderInlineMarkdown[\s\S]+stripRichCaretTokens/, 'inline Markdown rendering should never expose internal caret tokens');
assert.match(app, /function\s+hasAmbiguousStrongDelimiterNeighborhood[\s\S]+hasAmbiguousStrongDelimiter/, 'ambiguous strong delimiter neighborhoods should be detected before rich inline rendering');
assert.match(app, /function\s+renderInlineMarkdown[\s\S]+hasAmbiguousStrongDelimiterNeighborhood[\s\S]+renderInline/, 'ambiguous strong delimiter neighborhoods should stay editable source text instead of becoming partial emphasis');
assert.match(app, /function\s+renderBlockWithVendor[\s\S]+hasAmbiguousStrongDelimiterNeighborhood[\s\S]+return ''/, 'paragraph block rendering should not let markdown-it partially emphasize ambiguous strong delimiters');
assert.match(app, /function\s+renderRichInlineSourceFragment[\s\S]+stripRichCaretTokens/, 'rich inline source fragments should strip internal caret tokens before rendering');
const inlineCandidateFunction = app.match(/function\s+findRichInlineSourceCandidate[\s\S]+?\n  function\s+isRichCaretBoundaryMarker/);
assert.ok(inlineCandidateFunction, 'inline source candidate detection should exist');
assert.match(inlineCandidateFunction[0], /richSelectionRange\(selection\)/, 'inline source candidate detection should use validated rich selections');
assert.doesNotMatch(inlineCandidateFunction[0], /adjacentCaretNode/, 'caret placement next to an atomic inline should not auto-enter source mode');
assert.match(app, /function\s+preserveRichInlineTrailingWhitespace/, 'locally patched rich blocks should preserve editable trailing whitespace');
assert.match(app, /function\s+removeRichTrailingEditableParagraphs/, 'rich trailing editable paragraphs should not accumulate after block patches');
assert.match(app, /function\s+handleRichInlineBoundaryDelete/, 'deleting at an atomic inline boundary should remove the Markdown source range through a transaction');
assert.match(app, /function\s+handleRichInlineBoundaryDelete[\s\S]+richSelectionRange\(selection\)[\s\S]+richInlineBoundaryDeleteCandidate\(range,\s*direction\)/, 'atomic inline boundary deletion should derive source transactions from validated rich selections');
assert.match(app, /function\s+handleRichTextBlockEnterTransaction/, 'plain rich paragraph Enter should split Markdown through a source transaction');
assert.match(app, /function\s+handleRichSelectionEnterTransaction[\s\S]+sourceParagraphBreakReplacement[\s\S]+applySourceTransaction/, 'Enter with a rich selection should replace the Markdown source range through a transaction');
assert.match(app, /function\s+richInputRangeFromEvent[\s\S]+els\.rich\.contains\(inputRange\.startContainer\)[\s\S]+els\.rich\.contains\(inputRange\.endContainer\)[\s\S]+catch \(_\)[\s\S]+return null/, 'rich beforeinput target ranges should be limited to valid ranges fully contained in the rich editor');
assert.match(app, /function\s+richSelectionRange[\s\S]+try\s*\{[\s\S]+selection\.getRangeAt\(0\)[\s\S]+catch \(_\)[\s\S]+return null/, 'rich selection range helper should fail closed when the browser selection range cannot be read');
assert.match(app, /function\s+richSelectionRange[\s\S]+els\.rich\.contains\(selection\.anchorNode\)[\s\S]+els\.rich\.contains\(selection\.focusNode\)[\s\S]+els\.rich\.contains\(range\.endContainer\)/, 'rich Enter fallback should only use selections fully contained in the rich editor');
assert.match(app, /function\s+getRichSelectionRange[\s\S]+richSelectionRange\(selection\)[\s\S]+fallbackRange\.selectNodeContents\(els\.rich\)/, 'toolbar rich fallbacks should reuse the validated rich selection helper before touching DOM ranges');
assert.match(app, /function\s+handleRichEnter[\s\S]+handleRichSelectionEnterTransaction\(selection\)[\s\S]+guardUnsupportedRichSelectionEnterFallback\(range\)[\s\S]+range\.deleteContents\(\)/, 'unsupported rich source selections should be blocked before DOM deletion on Enter');
assert.match(app, /function\s+guardUnsupportedRichSelectionEnterFallback[\s\S]+richRangeTouchesSourceBlock\(range\)[\s\S]+この選択では段落を分割できません/, 'unsupported rich source selection Enter fallback should preserve Markdown source as authoritative');
assert.match(app, /function\s+sourceParagraphBreakReplacement[\s\S]+beforeHasBlockBreak[\s\S]+afterBreak/, 'selection Enter replacement should avoid duplicating adjacent Markdown block breaks');
assert.match(app, /function\s+handleRichListEnterTransaction/, 'flat rich list Enter should split Markdown list items through a source transaction');
assert.match(app, /function\s+handleRichListEnter[\s\S]+handleRichListEnterTransaction\(item,\s*range,\s*list\)[\s\S]+guardFailedRichSourceControlTransaction\(list,\s*'rich-list-enter'/, 'unsupported rich source-backed list Enter should not fall back to whole-DOM sync');
assert.match(app, /function\s+handleRichPlainTextInput/, 'plain rich text insertion should be routed through source transactions');
assert.match(app, /function\s+handleRichInlineSourceBeforeInput[\s\S]+captureRichInlineSourceUndoSnapshot/, 'inline source island edits should capture undo before DOM mutation');
assert.match(app, /function\s+onRichInput[\s\S]+richInlineSourceFromEventContext\(event\)[\s\S]+return/, 'inline source island input should not sync the whole rich DOM before commit');
assert.match(app, /function\s+onRichPaste[\s\S]+richInlineSourceFromEventContext\(event\)[\s\S]+return/, 'inline source island paste should use native editing without rich DOM synchronization');
assert.match(app, /function\s+pushRichUndoSnapshot[\s\S]+state\.markdown[\s\S]+serializeRichMarkdown/, 'rich undo snapshots should prefer Markdown source over DOM serialization');
assert.match(app, /function\s+onRichInput[\s\S]+applyRichSourceBackedDomTransaction\(event,\s*'rich-input-source-fallback'\)[\s\S]+guardUnsupportedRichSourceBackedDomSync\(event,\s*'rich-input-source-fallback'\)[\s\S]+syncRichMarkdownFromDom\('rich-input'\)/, 'rich input should not fall back to whole-DOM sync when a source-backed DOM transaction cannot be derived');
assert.match(app, /function\s+onRichCompositionEnd[\s\S]+applyRichSourceBackedDomTransaction\(event,\s*'rich-composition'\)[\s\S]+guardUnsupportedRichSourceBackedDomSync\(event,\s*'rich-composition'\)[\s\S]+syncRichMarkdownFromDom\('rich-input'\)/, 'rich composition should revert source-backed fallback failures instead of whole-DOM sync');
assert.match(app, /function\s+guardUnsupportedRichSourceBackedDomSync[\s\S]+RICH_SOURCE_BLOCK_SELECTOR[\s\S]+richSelectionTouchesSourceBlock\(selection\)[\s\S]+renderAll\(`\$\{reason\}-revert`\)/, 'failed source-backed rich input fallback should revert the DOM from Markdown source');
assert.match(app, /function\s+handleRichBlockMarkdownShortcutInput[\s\S]+applyRichBlockMarkdownTriggerTransaction/, 'completed rich Markdown shortcuts should be handled during beforeinput as source transactions');
assert.match(app, /function\s+handleRichBlockMarkdownShortcutSourceInput[\s\S]+richBlockMarkdownTriggerReplacement[\s\S]+applyRichBlockMarkdownTriggerTransaction/, 'normal rich text source insertion should still detect completed Markdown shortcuts');
assert.match(app, /function\s+richMarkdownShortcutTransactionRewrite[\s\S]+richBlockMarkdownTriggerReplacement/, 'rich text source transactions should rewrite completed Markdown shortcuts before rendering');
assert.match(app, /function\s+richParagraphBlockForShortcutRange[\s\S]+renderedBlockForSourceOffset/, 'shortcut handling should recover the paragraph from source offsets at block boundaries');
assert.match(app, /function\s+applySyncedRichBlockMarkdownShortcutAfterInput[\s\S]+applyRichBlockMarkdownTriggerTransaction/, 'rich Markdown shortcuts should have a post-input source transaction fallback when browser selection is unstable');
assert.match(app, /function\s+applySyncedMarkdownShortcutFromSource[\s\S]+buildBlockModel[\s\S]+applySourceTransaction/, 'rich Markdown shortcuts should fall back to source model scanning after DOM sync');
assert.match(app, /function\s+normalizeSyncedMarkdownShortcuts[\s\S]+buildBlockModel[\s\S]+richBlockMarkdownTriggerReplacement/, 'rich DOM serialization should normalize completed Markdown shortcuts through the source model');
assert.match(app, /function\s+applyRichQuoteShortcutAfterSpaceKey[\s\S]+applyRichBlockMarkdownTriggerTransaction/, 'rich quote shortcut should have a keyup fallback for browser selection timing');
assert.match(app, /function\s+handleRichPlainTextDelete/, 'plain rich text deletion should be routed through source transactions');
assert.match(app, /function\s+handleRichTextBlockBoundaryDelete[\s\S]+richTextBlockBoundaryDeleteTransaction[\s\S]+applySourceTransaction/, 'plain rich paragraph boundary deletion should remove Markdown block separators through source transactions');
assert.match(app, /function\s+handleRichTextBlockBoundaryDelete[\s\S]+richSelectionRange\(selection\)[\s\S]+richTextBlockBoundaryDeleteTransaction\(range,\s*backward\)/, 'plain rich paragraph boundary deletion should derive transactions from validated rich selections');
assert.match(app, /function\s+handleRichTableBlockBoundaryDelete[\s\S]+richTableBlockBoundaryDeleteTransaction[\s\S]+applySourceTransaction/, 'rich table block boundary deletion should merge adjacent paragraphs through source transactions');
assert.match(app, /function\s+handleRichTableBlockBoundaryDelete[\s\S]+richSelectionRange\(selection\)[\s\S]+richTableBlockBoundaryDeleteTransaction\(range,\s*backward\)/, 'rich table block boundary deletion should derive transactions from validated rich selections');
assert.match(app, /handleRichTableBlockBoundaryDelete\(event\)[\s\S]+handleRichTextBlockBoundaryDelete\(event\)/, 'rich table block boundary deletion should run before generic paragraph boundary deletion');
assert.match(app, /function\s+richParagraphBeforeTableMergeTransaction[\s\S]+markdownTableCellTextFromPlainText/, 'paragraph text before a table should be escaped before moving into the first table cell');
assert.match(app, /function\s+richTableBeforeParagraphMergeTransaction[\s\S]+markdown\.slice\(cellRange\.contentEnd,\s*cellRange\.blockEnd\)/, 'paragraph text after a table should preserve the trailing table row source when merged into the last cell');
assert.match(app, /event\.key === 'Backspace' \|\| event\.key === 'Delete'\)[\s\S]+handleRichTextBlockBoundaryDelete/, 'rich block boundary deletion should run at keydown before the browser merges heading and paragraph DOM');
assert.match(app, /const\s+backward\s*=\s*event\.inputType === 'deleteContentBackward' \|\| event\.key === 'Backspace'/, 'rich block boundary deletion should interpret Backspace correctly when handled from keydown');
assert.match(app, /function\s+richTextBlockBoundaryDeleteTransaction[\s\S]+p, h1, h2, h3, h4, h5, h6, blockquote/, 'rich block boundary deletion should cover heading and quote source blocks as well as paragraphs');
assert.match(app, /const\s+isQuoteBlock[\s\S]+backward \|\| point\.offset !== blockEnd/, 'quote boundary deletion should only run at the end of the whole quote block');
assert.match(app, /function\s+handleRichListBlockBoundaryDelete[\s\S]+richListBlockBoundaryDeleteTransaction[\s\S]+applySourceTransaction/, 'rich list block boundary deletion should remove Markdown block separators through source transactions');
assert.match(app, /function\s+handleRichListBlockBoundaryDelete[\s\S]+richSelectionRange\(selection\)[\s\S]+richListBlockBoundaryDeleteTransaction\(range,\s*backward\)/, 'rich list block boundary deletion should derive transactions from validated rich selections');
assert.match(app, /function\s+richListBlockBoundaryDeleteTransaction[\s\S]+itemIndex !== 0[\s\S]+itemIndex !== sourceItems\.length - 1/, 'rich list block boundary deletion should only run at first-item Backspace or last-item Delete');
assert.match(app, /function\s+handleRichListItemBoundaryDelete[\s\S]+richListItemBoundaryDeleteTransaction[\s\S]+applySourceTransaction/, 'rich list item boundary deletion should remove the next item marker through source transactions');
assert.match(app, /function\s+handleRichListItemBoundaryDelete[\s\S]+richSelectionRange\(selection\)[\s\S]+richListItemBoundaryDeleteTransaction\(range,\s*backward\)/, 'rich list item boundary deletion should derive transactions from validated rich selections');
assert.match(app, /function\s+richListItemBoundaryDeleteTransaction[\s\S]+listSourceItemTextEnd\(neighbor\)[\s\S]+neighbor\.parsed\.prefix\.length/, 'rich list item boundary deletion should remove only the newline and adjacent item prefix');
assert.match(app, /function\s+handleRichAtomicBlockBoundaryDelete[\s\S]+applySourceTransaction/, 'deleting next to an atomic rich block should remove its Markdown source through a transaction');
assert.match(app, /function\s+handleRichAtomicBlockBoundaryDelete[\s\S]+richSelectionRange\(selection\)[\s\S]+richAtomicBlockDeleteCandidate\(range,\s*direction\)/, 'atomic rich block deletion should derive transactions from validated rich selections');
assert.match(app, /const\s+RICH_ATOMIC_SOURCE_BLOCK_SELECTOR/, 'atomic rich source blocks should have a shared selector');
assert.match(app, /function\s+sourceBlockDeletionRange[\s\S]+\\n\{1,2\}/, 'atomic block deletion should absorb one adjacent Markdown block separator');
assert.match(app, /function\s+handleRichPlainTextSelectionReplacement/, 'plain rich range selection replacement should be routed through source transactions');
assert.match(app, /function\s+handleRichPlainTextInput[\s\S]+handleRichPlainTextSelectionReplacement\(event,\s*event\.data,\s*'rich-selection-insert'\)[\s\S]+guardUnsupportedRichSelectionMutationFallback\(event\)[\s\S]+currentCollapsedRichRange\(\)/, 'unsupported source-backed text insertion selections should be blocked before browser DOM mutation');
assert.match(app, /function\s+onRichBeforeInput[\s\S]+handleRichPlainTextSelectionReplacement\(event,\s*'',\s*'rich-selection-cut'\)[\s\S]+guardUnsupportedRichSelectionMutationFallback\(event\)/, 'unsupported source-backed cut/delete selections should be blocked before browser DOM mutation');
assert.match(app, /function\s+handleRichPlainTextDelete[\s\S]+handleRichPlainTextSelectionReplacement\(event,\s*'',\s*'rich-selection-delete'\)[\s\S]+guardUnsupportedRichSelectionMutationFallback\(event\)/, 'unsupported source-backed Backspace/Delete selections should not fall back to DOM deletion');
assert.match(app, /function\s+onRichCut[\s\S]+handleRichPlainTextSelectionReplacement\(event,\s*'',\s*'rich-selection-cut'\)[\s\S]+guardUnsupportedRichSelectionMutationFallback\(event\)/, 'unsupported rich cut selections should preserve Markdown source when no source range can be mapped');
assert.match(app, /function\s+onRichCut[\s\S]+richSelectionRange\(selection\)[\s\S]+handleRichPlainTextSelectionReplacement\(event,\s*'',\s*'rich-selection-cut'\)/, 'rich cut should validate rich selections before attempting source-backed replacement');
assert.match(app, /function\s+richSourceBlocksIntersectingRange[\s\S]+RICH_SOURCE_BLOCK_SELECTOR[\s\S]+intersectsNode/, 'unsupported selection mutation guard should detect source-backed blocks intersected by the selection range');
assert.match(app, /function\s+richSelectionTouchesSourceBlock[\s\S]+richSelectionRange\(selection\)[\s\S]+richRangeTouchesSourceBlock\(range\)/, 'source-backed selection intersection checks should use validated rich ranges');
assert.match(app, /function\s+guardUnsupportedRichSelectionMutationFallback[\s\S]+richSelectionRange\(selection\)[\s\S]+richSelectionTouchesSourceBlock\(selection\)/, 'unsupported selection mutation fallback should derive blocked ranges from validated rich selections');
assert.match(app, /function\s+guardUnsupportedRichSelectionMutationFallback[\s\S]+preventDefault[\s\S]+この選択はMarkdownソースへ変換できません/, 'unsupported selection mutation fallback should prevent browser DOM mutation and show status');
assert.match(app, /function\s+applyRichBlockFormatTransaction[\s\S]+richRangeExtendsOutsideSourceBlock\(range,\s*sourceBlock\)[\s\S]+この選択はMarkdownソースへ変換できません[\s\S]+applySourceTransaction/, 'block formatting should not rewrite only the starting source block for a cross-block selection');
assert.match(app, /function\s+guardUnsupportedRichInlineInsertContext[\s\S]+richRangeTouchesSourceBlock\(range\)[\s\S]+この選択はMarkdownソースへ変換できません/, 'inline insert DOM fallback should block source-backed selections using intersecting source ranges');
assert.match(app, /function\s+handleRichPlainTextPaste[\s\S]+applySourceTransaction/, 'plain rich paste should be routed through source transactions');
assert.match(app, /function\s+guardUnsupportedRichPlainTextPasteFallback[\s\S]+richSelectionTouchesSourceBlock\(selection\)[\s\S]+この位置では貼り付けできません/, 'unsupported rich paste fallback should block selections intersecting source-backed blocks');
assert.match(app, /function\s+richPlainTextTransactionRangeFromSelection/, 'plain rich replacements should share one source range mapping path');
assert.match(app, /function\s+richPlainTextTransactionRangeFromSelection[\s\S]+richSelectionRange\(selection\)[\s\S]+isSourceTransactionTextRange\(range\)/, 'plain rich replacement source ranges should start from validated rich selections');
assert.match(app, /function\s+richTableTextReplacementRangeFromSelection[\s\S]+richSelectionRange\(selection\)[\s\S]+richTableSourcePointFromRange\(anchorCell,\s*range\)/, 'rich table replacement ranges should validate rich selections before mapping source offsets');
assert.match(app, /function\s+richQuoteTextReplacementRangeFromSelection[\s\S]+richSelectionRange\(selection\)[\s\S]+richQuoteSourcePointFromRange\(anchorQuote,\s*range\)/, 'rich quote replacement ranges should validate rich selections before mapping source offsets');
assert.match(app, /function\s+isRichSourceTransactionSelectionEndpointBlocked[\s\S]+rich-inline-source[\s\S]+td, th/, 'selection transactions should block active editors and tables but not inactive atomic inline runs');
assert.doesNotMatch(app.match(/function\s+isRichSourceTransactionSelectionEndpointBlocked[\s\S]+?\n  function\s+currentCollapsedRichRange/)?.[0] || '', /rich-inline-atom/, 'inactive atomic inline runs should remain selectable for source transactions');
assert.match(app, /function\s+currentCollapsedRichRange[\s\S]+richSelectionRange\(selection\)[\s\S]+return range/, 'collapsed rich range fallback should use validated rich selections');
assert.match(app, /function\s+handleRichLineBreakTransaction[\s\S]+richLineBreakInsertForSelection[\s\S]+applySourceTransaction/, 'plain rich Shift+Enter line breaks should be Markdown hard-break source transactions');
assert.match(app, /function\s+activeRichLineBreakCaretRange[\s\S]+richSelectionRange\(selection\)[\s\S]+richLineBreakCaretAnchorForOffset/, 'rich line break caret source ranges should use validated rich selections');
assert.match(app, /function\s+insertRichLineBreak[\s\S]+richSelectionRange\(selection\)[\s\S]+insertRichLineBreakAtRange\(range\)/, 'rich line break DOM fallback should only use validated rich editor selections');
assert.match(app, /function\s+insertRichLineBreakAtRange[\s\S]+els\.rich\.contains\(range\.startContainer\)[\s\S]+els\.rich\.contains\(range\.endContainer\)[\s\S]+range\.deleteContents\(\)/, 'rich line break DOM fallback should only mutate ranges fully contained in the rich editor');
assert.match(app, /function\s+guardUnsupportedRichLineBreakFallback[\s\S]+richRangeTouchesSourceBlock\(range\)[\s\S]+この位置では改行できません/, 'unsupported rich Shift+Enter fallback should block selections intersecting source-backed blocks');
assert.match(app, /function\s+handleRichTableLineBreakDelete[\s\S]+richTableLineBreakDeletionTransaction[\s\S]+applySourceTransaction/, 'rich table cell line break deletion should use source transactions');
assert.match(app, /function\s+handleRichTableLineBreakDelete[\s\S]+richSelectionRange\(selection\)[\s\S]+richTableLineBreakDeletionTransaction\(cell,\s*target\.br/, 'rich table cell line break deletion should derive transactions from validated rich selections');
assert.match(app, /function\s+handleRichTableLineBreakDelete[\s\S]+guardFailedRichSourceControlTransaction\(cell,\s*'rich-table-line-break-delete'/, 'rich table cell line break deletion should not fall back to whole-DOM sync for source-backed tables');
assert.match(app, /function\s+applyRichBlockMarkdownTriggerTransaction[\s\S]+applySourceTransaction/, 'rich line-start Markdown shortcuts should update source through transactions');
assert.match(app, /function\s+richBlockMarkdownTriggerReplacement/, 'rich line-start Markdown shortcut replacements should be computed as Markdown source');
assert.match(app, /allowBareMath:\s*false/, 'bare $$ input should wait for focus movement so $$$$ can still become display math');
assert.match(app, /text === '---'/, 'rich horizontal rule shortcut should be routed through the Markdown trigger path');
assert.match(app, /function\s+openInsertedDisplayMathSourceEditor/, 'display math shortcuts should reopen the source editor after a source transaction');
assert.match(app, /replacement\.kind === 'math-inline'[\s\S]+replaceParagraphWithMathInlineSource/, 'empty inline math shortcuts should fall back to a source island when no rendered atom exists');
assert.match(app, /function\s+parsePendingRichMathShortcutInBlock[\s\S]+allowBareMath:\s*true/, 'bare $$ and $$$$ should be finalized when the rich caret leaves the source block');
assert.match(app, /function\s+handleRichEnter[\s\S]+activatePendingMathShortcutFromSelection/, 'bare math shortcuts should finalize before Enter inserts a new paragraph');
assert.match(app, /function\s+parsePendingRichMathShortcutAwayFromTarget[\s\S]+parsePendingRichMathShortcutInBlock/, 'bare math shortcuts should finalize when another rich location is clicked');
assert.match(app, /function\s+richPendingMathShortcutBlockFromRange/, 'bare math shortcuts should recover the pending paragraph from Enter target ranges');
assert.match(app, /function\s+flatListSourceItems/, 'list source mapping should group continuation lines with their list item');
assert.match(app, /function\s+textOffsetFromListItemSourceOffset/, 'list source selection restoration should understand continuation lines');
assert.match(app, /function\s+findListItemVisibleTextPosition/, 'list caret restoration should count br elements and hide hard-break marker spaces');
assert.match(app, /function\s+listFragmentVisibleText/, 'list caret source offsets should count br elements and hide hard-break marker spaces');
assert.match(app, /function\s+normalizeListItemSourceLine[\s\S]+return value\.replace\([\s\S]+?,\s*'  '\)/, 'list serialization should preserve Markdown hard-break marker spaces');
assert.match(app, /function\s+taskCheckboxToggleTransaction/, 'rich checklist toggles should compute source transactions');
assert.match(app, /applySourceTransaction\(sourceTransaction,\s*'task-toggle'\)/, 'rich checklist toggles should update Markdown source through source transactions');
assert.match(app, /function\s+updateTaskCheckbox[\s\S]+guardFailedRichSourceControlTransaction\(input,\s*'task-toggle'/, 'rich checklist toggles should not fall back to whole-DOM sync for source-backed lists');
assert.match(app, /function\s+handleRichEmptyListBackspace[\s\S]+richSelectionRange\(selection\)[\s\S]+applySourceTransaction\(sourceTransaction,\s*'rich-empty-list-backspace'\)/, 'empty rich list item deletion should derive source transactions from validated rich selections');
assert.match(app, /function\s+removeRichTaskCheckboxTransaction/, 'rich checklist marker deletion should compute source transactions');
assert.match(app, /applySourceTransaction\(sourceTransaction,\s*'rich-task-checkbox-delete'\)/, 'rich checklist marker deletion should update Markdown source through source transactions');
assert.match(app, /function\s+handleRichTaskCheckboxDelete[\s\S]+richSelectionRange\(selection\)[\s\S]+removeRichTaskCheckboxTransaction\(checkbox,\s*item\)/, 'rich checklist marker deletion should derive transactions from validated rich selections');
assert.match(app, /function\s+handleRichDeleteToEmptyBlock[\s\S]+applySourceTransaction\(sourceTransaction,\s*'rich-delete-to-empty-block'\)/, 'deleting the final character in a rich source block should use a source transaction');
assert.match(app, /function\s+handleRichDeleteToEmptyBlock[\s\S]+richSelectionRange\(selection\)[\s\S]+richDeleteToEmptyBlockTransaction\(block,\s*range,\s*event\.key\)/, 'deleting the final character in a rich source block should derive transactions from validated rich selections');
assert.match(app, /function\s+handleRichDeleteToEmptyBlock[\s\S]+guardFailedRichSourceControlTransaction\(block,\s*'rich-delete-to-empty-block'/, 'deleting the final character in a rich source block should not fall back to whole-DOM sync');
assert.match(app, /function\s+richPlainTextSourcePointFromRange/, 'plain rich text transactions should derive offsets from source ranges');
assert.match(app, /function\s+shouldLetDomHandleMarkdownShortcutInput/, 'Markdown shortcut prefixes should remain on the DOM trigger path');
assert.match(app, /function\s+renderEmptyRichSourceParagraph/, 'empty rich documents should still expose source ranges for first-character transactions');
assert.match(app, /function\s+parseFlatListSourceLine/, 'list source transactions should parse source list markers explicitly');
assert.match(app, /rich-list-caret-anchor/, 'empty rich list items should keep a stable caret anchor');
assert.match(app, /function\s+ensureRichBlankParagraphAtSourceGap/, 'exiting a rich list through source transactions should keep a visible blank paragraph');
assert.match(app, /function\s+ensureRichBlankParagraphAtSourceGap[\s\S]+richEmptySourceParagraphAtGap/, 'source transaction blank paragraphs should reuse an existing empty source-backed paragraph at the same gap');
assert.match(app, /function\s+richEmptySourceParagraphAtGap[\s\S]+sourceStart[\s\S]+sourceEnd[\s\S]+isEmptyRichParagraph/, 'empty source-backed paragraphs should be detected by source gap');
assert.match(app, /function\s+codeBlockLanguageTransaction/, 'rich code block language edits should compute source transactions');
assert.match(app, /applySourceTransaction\(sourceTransaction,\s*'code-language'\)/, 'rich code block language edits should update Markdown source through transactions');
assert.match(app, /function\s+updateCodeBlockLanguage[\s\S]+guardFailedRichSourceControlTransaction\(input,\s*'code-language'/, 'rich code language edits should not fall back to whole-DOM sync for source-backed code blocks');
assert.match(app, /function\s+refocusCodeLanguageInput/, 'rich code block language edits should keep the language field usable after a local block patch');
assert.match(app, /function\s+guardFailedRichSourceControlTransaction[\s\S]+renderAll\(`\$\{reason\}-revert`\)/, 'failed source-backed rich controls should revert instead of serializing the rich DOM');
assert.match(app, /function\s+richSourceBlockTransaction/, 'rich source-backed blocks should compute block source transactions');
assert.match(app, /applySourceTransaction\(sourceTransaction,\s*`\$\{kind\}-source`\)/, 'rich source-backed block commits should update Markdown source through transactions');
assert.match(app, /function\s+applyRichInlineFormatTransaction/, 'rich inline toolbar formats should compute source transactions');
assert.match(app, /function\s+activateInsertedInlineSource/, 'toolbar-inserted inline Markdown should reopen as an editable source island');
assert.match(app, /function\s+selectInlineSourceRange/, 'toolbar-inserted inline source islands should be selectable without DOM serialization');
assert.match(app, /function\s+handleRichHomeEndNavigation/, 'rich Home and End navigation should restore caret positions through source offsets');
assert.match(app, /function\s+handleRichHomeEndNavigation[\s\S]+richSelectionRange\(selection\)[\s\S]+richEditBlockBoundarySourceOffset\(editBlock,\s*boundary\)/, 'rich Home and End navigation should derive source offsets from validated rich selections');
assert.match(app, /function\s+richEditBlockBoundarySourceOffset/, 'rich block boundary navigation should compute source offsets explicitly');
assert.match(app, /function\s+commitActiveRichInlineSourceForTarget/, 'clicking outside an active inline source should commit it before toolbar actions run');
assert.match(app, /activateRichInlineSource\(inlineRendered,\s*'end'\)[\s\S]+event\.stopPropagation\(\)/, 'clicking an atomic inline should not be immediately closed by the document click handler');
assert.match(app, /function\s+applyRichBlockFormatTransaction[\s\S]+richSelectionRange\(selection\)[\s\S]+richTextSourceBlockForFormat/, 'rich block toolbar formats should compute source transactions from validated rich selections');
assert.match(app, /function\s+richBlockFormatReplacement/, 'rich block toolbar formats should build Markdown replacements directly');
assert.match(app, /function\s+guardUnsupportedRichBlockFormatContext[\s\S]+els\.rich\.contains\(range\.startContainer\)[\s\S]+els\.rich\.contains\(range\.endContainer\)/, 'rich block format DOM fallback guards should only inspect ranges fully contained in the rich editor');
assert.match(app, /`rich-block-format-\$\{format\}`/, 'rich block toolbar formats should update Markdown through source transaction reasons');
assert.match(app, /function\s+richMarkdownBlockInsertionTransaction/, 'rich source-backed block insertion should compute source transactions');
assert.match(app, /function\s+richMarkdownBlockInsertionOffset/, 'rich block insertion should derive insertion offsets from rendered source ranges');
assert.match(app, /function\s+insertRichMarkdownBlock[\s\S]+guardUnsupportedRichBlockInsertionSelection\(\)[\s\S]+richMarkdownBlockInsertionTransaction/, 'rich block insertion should guard unsupported source-backed selections before computing insertion transactions');
assert.match(app, /function\s+guardUnsupportedRichBlockInsertionSelection[\s\S]+richSelectionRange\(selection\)[\s\S]+richSourceBlocksIntersectingRange\(range\)[\s\S]+richRangeExtendsOutsideSourceBlock\(range,\s*sourceBlock\)[\s\S]+この選択ではブロックを挿入できません/, 'rich block insertion should not treat cross-block source selections as a plain insertion point');
assert.match(app, /function\s+richMarkdownBlockInsertionOffset[\s\S]+richSelectionRange\(selection\)[\s\S]+richTopLevelBlock/, 'rich block insertion offsets should only use validated rich editor selections');
assert.match(app, /applySourceTransaction\(sourceTransaction,\s*'rich-block-insert'\)/, 'rich block insertion should update Markdown through source transactions');
assert.match(app, /function\s+insertRichInlineMarkdownSource/, 'rich inline insertions should compute source transactions');
assert.match(index, /id="inlineInsertDialog"/, 'link and image reference insertion should use an app dialog instead of native prompts');
assert.match(app, /function\s+insertInlineMarkdownAtCapturedContext/, 'inline dialog insertions should write to the captured source range');
assert.match(app, /function\s+richInlineInsertRangeFromSelection/, 'rich inline dialog insertions should preserve the source insertion range before the dialog takes focus');
assert.match(app, /function\s+isAllowedMarkdownImageReference[\s\S]+isRelativeImageReference[\s\S]+hasRasterImageExtension/, 'image reference insertion should allow safe relative image Markdown even before folder permission resolves it');
assert.match(app, /case 'confirm-inline-insert'/, 'inline insertion dialog should have an explicit confirm action');
assert.match(app, /applySourceTransaction\(\{[\s\S]+from:\s*replacementRange\.from[\s\S]+to:\s*replacementRange\.to[\s\S]+\},\s*'rich-inline-insert'\)/, 'rich inline link and image insertions should replace Markdown source ranges directly');
assert.match(app, /activateInsertedInlineSource\([\s\S]+replacementRange\.from[\s\S]+replacementRange\.from \+ insert\.length/, 'collapsed rich inline insertions should reopen as source islands for label editing');
assert.doesNotMatch(app.match(/function\s+insertLink[\s\S]+?function\s+insertCodeBlock/)?.[0] || '', /prompt\(/, 'link and image reference insertion should not use native prompt dialogs');

class TestURL extends URL {}
let objectUrlIndex = 0;
TestURL.createObjectURL = () => `blob:test-${objectUrlIndex += 1}`;
TestURL.revokeObjectURL = () => {};

const instrumented = app.replace(/\}\)\(\);\s*$/, 'return { renderMarkdownHtml, sanitizeImageUrl, sanitizeLinkUrl, saveImageFileToAssets, ensureImageAssetWriteAccess, buildFolderAssetUrls, state };\n})();');
const renderer = vm.runInNewContext(instrumented, {
  document: { addEventListener() {} },
  window: { isSecureContext: true },
  localStorage: {},
  URL: TestURL,
  Blob,
  navigator: {},
  confirm() { return true; },
  prompt() { return ''; },
  alert() {},
  console,
});

const caretTokenRendered = renderer.renderMarkdownHtml('**a@PME_CARET_test_123@**');
assert.doesNotMatch(caretTokenRendered, /PME_CARET/, 'internal rich caret tokens must not render into preview HTML');
assert.match(caretTokenRendered, />a</, 'caret token cleanup should preserve surrounding Markdown content');

const rangedBlockRendered = renderer.renderMarkdownHtml('# Heading\n\nParagraph with **bold** and *em*.');
assert.match(rangedBlockRendered, /data-block-id="b0-[a-z0-9]+"/, 'rendered heading should have a block id');
assert.match(rangedBlockRendered, /data-block-type="heading"/, 'rendered heading should have a block type');
assert.match(rangedBlockRendered, /data-source-start="0"/, 'rendered blocks should keep source start offsets');

const slash = String.fromCharCode(92);
const drivePath = `Z:${slash}share${slash}local sample.webp`;
const uncPath = `${slash}${slash}server${slash}share${slash}local sample.webp`;
const rendered = renderer.renderMarkdownHtml([
  '```js',
  'const message = "ok";',
  '```',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Start] -->|go| B[End]',
  '```',
  '',
  `![local](<${drivePath}>)`,
  '![remote](https://example.com/tracker.png)',
].join('\n'));

assert.match(rendered, /tok-keyword/, 'code blocks should be highlighted');
assert.match(rendered, /mermaid-diagram/, 'mermaid blocks should render locally');
assert.match(rendered, /<svg class="mermaid-svg"[^>]+width="\d+"[^>]+height="\d+"/, 'mermaid SVG should have explicit dimensions');
assert.match(rendered, /mermaid-flow-node-label/, 'local flowchart labels should use readable flowchart text styling');
assert.doesNotMatch(rendered, /file:\/\/\/Z:\/share\/local%20sample\.webp/, 'Windows drive images should not render as file URLs');
assert.match(rendered, /ローカル絶対パスは直接読み込みません/, 'Windows drive images should explain that absolute paths are not loaded directly');
assert.match(rendered, /blocked-image/, 'remote images should remain blocked');
assert.equal(renderer.sanitizeLinkUrl('javascript:alert(1)'), '');
assert.equal(renderer.sanitizeImageUrl('https://example.com/a.png'), '');
assert.equal(renderer.sanitizeImageUrl(uncPath), '');
assert.equal(renderer.sanitizeImageUrl('C:%5CUsers%5Crokuh%5CDocuments%5Cimage-3.png'), '');

const branchRendered = renderer.renderMarkdownHtml([
  '```mermaid',
  'flowchart TD',
  '  A[Markdownを書く] --> B{安全にプレビュー}',
  '  B -->|OK| C[保存]',
  '  B -->|確認| D[修正]',
  '```',
].join('\n'));
const okLabel = branchRendered.match(/<text class="mermaid-edge-label" x="([^"]+)"[^>]*>OK<\/text>/);
const reviewLabel = branchRendered.match(/<text class="mermaid-edge-label" x="([^"]+)"[^>]*>確認<\/text>/);
assert.ok(okLabel, 'branch flowchart should render the OK edge label');
assert.ok(reviewLabel, 'branch flowchart should render the review edge label');
assert.notEqual(okLabel[1], reviewLabel[1], 'branch edge labels should not overlap at the same x position');

const loopRendered = renderer.renderMarkdownHtml([
  '```mermaid',
  'flowchart TD',
  '  A[Markdownを書く] --> B{プレビュー}',
  '  B -->|OK| C[保存]',
  '  B -->|修正| A',
  '```',
].join('\n'));
assert.match(loopRendered, /viewBox="0 0 760 /, 'single-column flowcharts should keep a wide enough viewBox');
const loopLabel = loopRendered.match(/<text class="mermaid-edge-label" x="([^"]+)"[^>]*text-anchor="([^"]+)"[^>]*>修正<\/text>/);
assert.ok(loopLabel, 'backward edge label should be rendered');
assert.ok(Number(loopLabel[1]) > 80, 'backward edge label should stay inside the SVG viewBox');

const sequenceRendered = renderer.renderMarkdownHtml([
  '```mermaid',
  'sequenceDiagram',
  '  participant U as User',
  '  participant E as Editor',
  '  U->>E: Markdownを書く',
  '  E-->>U: Preview',
  '```',
].join('\n'));
assert.match(sequenceRendered, /mermaid-sequence/, 'sequence diagrams should render locally');
assert.match(sequenceRendered, />User</, 'declared sequence participant labels should render');
assert.match(sequenceRendered, />Editor</, 'declared sequence participant aliases should render');
assert.doesNotMatch(sequenceRendered, />E-</, 'return arrows must not be parsed as a bogus E- participant');

const fallback = renderer.renderMarkdownHtml([
  '```mermaid',
  'mindmap',
  '  root((Markdown))',
  '```',
].join('\n'));
assert.match(fallback, /mermaid-fallback/, 'unsupported mermaid should fall back visibly');
assert.match(fallback, /mindmap/, 'unsupported mermaid source should remain visible');

renderer.state.allowedLinkDomains = ['example.com'];
assert.equal(renderer.sanitizeLinkUrl('https://example.com/docs'), 'https://example.com/docs');
assert.equal(renderer.sanitizeLinkUrl('https://docs.example.com/a'), 'https://docs.example.com/a');
assert.equal(renderer.sanitizeLinkUrl('https://evil.example.net/a'), '');

renderer.state.assetUrls.set('images/a.png', 'blob:local-image');
assert.match(renderer.renderMarkdownHtml('![a](images/a.png)'), /src="blob:local-image"/);
renderer.state.assetUrls.clear();
const missingRelativeImage = renderer.renderMarkdownHtml('![image-3](sample.assets/image-3.png)');
assert.match(missingRelativeImage, /画像未表示/, 'relative image without folder access should render an explanation');
assert.match(missingRelativeImage, /フォルダが許可されていない/, 'relative image explanation should mention missing folder permission');
assert.doesNotMatch(missingRelativeImage, /<img\b/, 'relative image without folder access should not load as an app-relative URL');

function memoryDirectoryHandle(name = 'root') {
  const directories = new Map();
  const files = new Map();
  return {
    kind: 'directory',
    name,
    directories,
    files,
    async queryPermission({ mode }) {
      return mode === 'readwrite' ? 'granted' : 'prompt';
    },
    async requestPermission() {
      return 'granted';
    },
    async getDirectoryHandle(childName, options = {}) {
      if (!directories.has(childName)) {
        if (!options.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
        directories.set(childName, memoryDirectoryHandle(childName));
      }
      return directories.get(childName);
    },
    async getFileHandle(childName, options = {}) {
      if (!files.has(childName)) {
        if (!options.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
        files.set(childName, memoryFileHandle(childName));
      }
      return files.get(childName);
    },
  };
}

function memoryFileHandle(name) {
  return {
    kind: 'file',
    name,
    written: null,
    async createWritable() {
      const handle = this;
      return {
        async write(file) {
          handle.written = file;
        },
        async close() {},
      };
    },
  };
}

const rootHandle = memoryDirectoryHandle();
const docsHandle = await rootHandle.getDirectoryHandle('docs', { create: true });
renderer.state.directoryHandle = rootHandle;
renderer.state.markdownRelativePath = 'docs/sample.md';
renderer.state.fileName = 'sample.md';
assert.equal(await renderer.ensureImageAssetWriteAccess(), true, 'opened folder handle should grant read/write image insertion');
const pastedImage = new Blob(['image-bytes'], { type: 'image/png' });
Object.defineProperty(pastedImage, 'name', { value: 'clipboard image.png' });
const savedImage = await renderer.saveImageFileToAssets(pastedImage);
assert.equal(savedImage.markdownPath, 'sample.assets/clipboard image.png', 'images should be saved beside the Markdown file in a file-name assets directory');
assert.ok(docsHandle.directories.get('sample.assets').files.has('clipboard image.png'), 'asset image should be written through the selected directory handle');
assert.equal(docsHandle.directories.get('sample.assets').files.get('clipboard image.png').written, pastedImage, 'image bytes should be written to the allocated asset file');
assert.match(renderer.renderMarkdownHtml(`![clipboard](<${savedImage.markdownPath}>)`), /src="blob:test-/, 'saved asset should render through the refreshed folder asset map');
renderer.state.assetUrls.clear();
renderer.buildFolderAssetUrls([
  { file: pastedImage, relativePath: 'docs/sample.assets/clipboard image.png' },
], 'docs');
assert.match(renderer.renderMarkdownHtml(`![clipboard](<${savedImage.markdownPath}>)`), /src="blob:test-/, 'reopened folder entries should map assets relative to the Markdown file');

const toc = renderer.renderMarkdownHtml([
  '[toc]',
  '',
  '# A',
  '## B',
  '### C',
].join('\n'));
assert.match(toc, /<details open>/, 'top-level TOC entries should be expanded');
assert.match(toc, /<details>/, 'nested TOC entries should be collapsible');

console.log('security smoke checks passed');

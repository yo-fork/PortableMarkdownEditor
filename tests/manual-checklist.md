# Manual Checklist

Run these checks without npm, package managers, CDN, or network access.

1. Open `index.html` directly in a browser.
2. Confirm the title and header show `Portable Markdown Editor`.
3. Confirm no Console CSP violation appears on initial load.
4. Confirm Mermaid flowchart rendering with a backward edge. The `修正` label must stay inside the diagram frame, and labels must not overlap node text or arrows:
   ```mermaid
   flowchart TD
     A[Markdownを書く] --> B{プレビュー}
     B -->|OK| C[保存]
     B -->|修正| A
   ```
5. Confirm Mermaid branching flowchart rendering. `OK` and `確認` must appear on separate branch edges without overlap:
   ```mermaid
   flowchart TD
     A[Markdownを書く] --> B{安全にプレビュー}
     B -->|OK| C[保存]
     B -->|確認| D[修正]
   ```
6. Confirm Mermaid left-to-right flowchart rendering with:
   ```mermaid
   flowchart LR
     A[入力] --> B{検証}
     B -->|OK| C[保存]
     B -->|NG| D[修正]
   ```
7. Confirm Mermaid sequence rendering. The participants should be exactly `User` and `Editor`; return arrows such as `E-->>U` must not create a bogus `E-` participant:
   ```mermaid
   sequenceDiagram
     participant U as User
     participant E as Editor
     U->>E: Markdownを書く
     E-->>U: Preview
     Note over U,E: local only
   ```
8. Confirm Mermaid mindmap rendering when the local Mermaid bundle is loaded. It should not leave `Syntax error in text` below the document. If the bundle is unavailable, the source should fall back as escaped code.
9. Confirm inline math `$x+1$` and display math `$$x+1$$` render and round-trip in rich editing. Math must not overflow the editor column.
10. Confirm there are no `body > div[id^="dpme-"]` Mermaid scratch nodes left after Mermaid rendering.
11. Open a folder containing Markdown plus PNG/JPEG/GIF/WebP images from the `フォルダ` button and confirm relative images render relative to the opened Markdown file. In supported browsers this should use the File System Access API folder picker and the status bar should show `FSAフォルダ`; otherwise it should fall back to folder file input.
12. In a supported browser opened from `http://localhost` or `http://127.0.0.1`, paste an image with `Ctrl+V` and drop a PNG/JPEG/GIF/WebP file into the editor. Confirm the files are created in `MarkdownFileName.assets/` next to the Markdown file and the Markdown contains relative image references.
13. Reopen the same folder from `フォルダ` and confirm the assets-folder images render again through the File System Access API directory mapping.
14. Restart the browser while the stored folder permission remains granted and confirm relative images are restored. Then revoke or clear the stored folder permission, restart again, and confirm the images remain unavailable until the folder is selected again.
15. Confirm `http`/`https` images remain blocked.
16. Confirm normal external links open only after adding the domain in `リンク許可`; unlisted domains remain blocked.
17. Open `tests/browser-selftest.html` directly and confirm every row reports `PASS`.
18. Open the security dialog, use `下書きを削除`, reload the page, and confirm the previous edited draft is not restored.
19. Open the security dialog, use `設定をリセット`, and confirm theme, display mode, and allowed link domains return to their initial state.
20. Open a Markdown file with relative images through a granted folder, then use `フォルダ権限の記録を削除`. Reload and confirm relative images are not displayed again until the folder is granted again.
21. In rich mode, place the caret in an empty paragraph and press `Ctrl+K`. Confirm a selected, visible `code` placeholder appears and typing replaces it as inline code.
22. Open a fenced code block in rich mode, change its language field, and confirm the Markdown fence info string updates without losing code text.
23. Move the caret to the end of a rich link and press `ArrowRight`. Confirm the URL editor opens without clicking and a long URL wraps without clipping.
24. Open link insertion, image insertion, and an existing rich image source editor with long targets. Confirm each target can be read and edited without horizontal clipping.
25. Open the keyboard shortcut dialog, change inline code to `Ctrl+Alt+Q`, and confirm the tooltip, key action, reload persistence, duplicate rejection, assignment removal, and default reset all work.
26. Open appearance settings, switch the document font between Gothic and Mincho, and confirm rich, preview, and focus modes use the same selection while normal source mode and rendered code remain monospaced. Reload and confirm the selection persists.
27. In rich mode, type `- [ ] ` at the start of an empty paragraph and confirm it becomes an unchecked checklist item instead of a plain bullet item containing `[ ]`.
28. In rich mode, use both the checklist toolbar button and `Ctrl+Alt+C`, and confirm each converts the current paragraph into a checklist item without losing its text.
29. In split mode, use a document with long wrapped paragraphs, scroll the source and preview panes in both directions, and confirm the corresponding section remains aligned near the top of the other pane.
30. In rich mode, click an inline formula and confirm its rendered position remains highlighted while an opaque source editor opens above or below it without covering the formula. Confirm the editor contains both the LaTeX source and a live rendered preview.
31. Place the rich caret in a heading, press `Ctrl+M`, and confirm the inserted inline formula remains inside the heading in both rich and preview modes and round-trips as heading Markdown.
32. In rich mode, load a table containing `$E=mc^2$` and `$P(A|B)$`, then press `Ctrl+M` in another cell. Confirm all formulas render in rich and preview modes, formula pipes do not create extra columns, and editing the formula preserves the table structure.
33. In rich mode, load `~~削除対象~~`, then create another strike with both the toolbar button and `Ctrl+Shift+X`. Confirm all three render as strike-through text and remain `~~...~~` after switching to source mode.

## Windows portable app

1. Run `BuildPortableWindows.cmd` without package restore or network access and confirm both MSBuild runs finish with zero warnings and zero errors.
2. Start `dist/PortableMarkdownEditor/PortableMarkdownEditor.exe` and confirm the native menu, native file toolbar, WebView2 editor, native status bar, and portable document path area are visible.
3. Confirm the Web editor does not duplicate the native New, Open, Save, folder permission, or Print buttons.
4. Open a UTF-8 Markdown file and confirm the native title and path area show the selected file without a website folder-permission prompt.
5. Edit the document, use Save As into a temporary test folder, and confirm the output is UTF-8 without a BOM.
6. Close or replace a modified document and confirm the native unsaved-change warning appears.
7. Insert the same PNG/JPEG/GIF/WebP image twice and confirm both files are saved under `MarkdownFileName.assets/` with non-colliding names.
8. Reopen the Markdown file and confirm its relative assets image renders through the native validated image response and the app remains open afterward.
9. Open a document containing a `C:\...` image path that points inside the document folder. Confirm the image renders and switching rich/source modes does not change `\` into `%5C`.
10. Confirm an absolute image path outside the document folder remains a reasoned placeholder.
11. Open `samples/math-syntax-gallery.md` and confirm `$...$`, `\(...\)`, `$$...$$`, and `\[...\]` render in rich, split, and preview modes.
12. Confirm `\$100`, inline code, and fenced code in the math gallery do not become formulas.
13. Confirm a multiline display formula immediately following paragraph text without a blank line remains a formula in rich mode and keeps a following `+ ` line inside the formula.
14. Export HTML and link-domain settings and confirm both use native Windows save dialogs.
15. Open Print and confirm the Windows system print dialog appears.
16. Move the complete portable folder to another writable location and confirm it starts without installation or administrator privileges.
17. On a test PC without WebView2 Runtime, confirm startup fails visibly instead of silently; install-free operation requires the runtime to already exist.
18. Confirm the release ZIP contains `LICENSE` and `THIRD-PARTY-NOTICES.txt`, and the same legal files are present beside the ZIP under `release/`.
19. Change a native file shortcut, confirm its Windows menu label updates, and confirm the new key works while the previous key no longer runs the command.
20. Open `Help > Appearance`, select Mincho, and confirm rich, preview, focus, printing, and exported HTML use the selected document font.
21. Open two Windows app windows, edit each document, reload both editing views, and confirm each window restores only its own draft.
22. Start saving a large document, continue editing before the write finishes, and confirm the title and status remain in the unsaved state after the earlier snapshot is saved.
23. Run `RunReleaseChecks.cmd -Publish` and confirm `release/` changes only after the generated ZIP and all automated checks pass.

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
14. Restart the browser and confirm relative images are not restored until the folder is selected again.
15. Confirm `http`/`https` images remain blocked.
16. Confirm normal external links open only after adding the domain in `リンク許可`; unlisted domains remain blocked.
17. Open `tests/browser-selftest.html` directly and confirm every row reports `PASS`.

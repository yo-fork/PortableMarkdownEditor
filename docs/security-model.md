# Security Model

## Goals

Portable Markdown Editor protects local editing sessions from common Markdown preview risks:

1. raw HTML execution,
2. JavaScript URL execution,
3. remote image tracking,
4. accidental network communication,
5. CDN tampering and runtime dependency fetching.

## Non-goals

- It is not a cryptographic vault.
- It does not protect against a compromised browser or operating system.
- It does not provide collaborative editing or cloud sync.

## Rendering pipeline

1. Markdown text is normalized to LF line endings.
2. The local bundled Markdown parser renders Markdown with raw HTML disabled.
3. Renderer hooks sanitize links and images before they become attributes.
4. Local bundled highlighter, Mermaid, and KaTeX integrations run inside the same CSP without network access.
5. The result is inserted into the preview container.

The app intentionally does not support raw HTML rendering.

The runtime does not use npm, CDN, external JavaScript, external CSS, external APIs, `fetch`, XHR, WebSocket, Worker, dynamic code evaluation, or package downloads. Browser libraries are fixed local files under `vendor/`.

## URL policy

| Type | Allowed | Blocked examples |
| --- | --- | --- |
| Link | relative, `#anchor`, allowlisted `http`/`https` domains | `javascript:`, `vbscript:`, protocol-relative URLs, non-allowlisted `http`/`https`, `mailto`, `tel`, `file` |
| Image | raster `data:` URL, `blob:`, folder-open relative path | `https://...`, `file:`, Windows drive path, UNC path, `data:text/html`, `data:image/svg+xml`, non-raster file extensions |

Link allowlist domains and application keyboard shortcuts are stored in localStorage. Users can import a local JSON settings file containing an `allowedLinkDomains` array and an optional `shortcuts` object; the app normalizes both values and writes the result back to localStorage. Exporting settings creates a local JSON download of the current allowlist and shortcut assignments. In File System Access API capable browsers, users can also grant a settings directory. The directory handle is stored in local IndexedDB; on later startup the app auto-loads `portable-markdown-editor-settings.json` only when permission is still granted, and explicit user action can overwrite the same file. This flow uses user-selected local files only and does not add network access.

Remote images are blocked to avoid tracking pixels and accidental network access. PNG/JPEG/GIF/WebP relative paths inside the opened or user-granted document folder remain the primary image format. The browser edition does not load direct `file:` URLs, Windows drive paths, or UNC paths. The Windows host may resolve up to 64 absolute image references already present in the Markdown source, but only when the target exists inside the current document folder, is 25MB or smaller, and its extension matches its raster file signature. The host returns a relative alias rather than the document directory or target absolute path. Relative images are resolved against the opened Markdown file only after the user grants folder access. If folder access is missing, or the selected folder does not contain the referenced image, the renderer shows a local placeholder explaining why the image is not displayed instead of loading an app-relative URL. In browsers with File System Access API support, the Open flow can ask the user to select the containing folder after selecting a Markdown file, and the Folder button can read a user-selected directory handle directly. File and folder pickers use the current Markdown directory or the previous folder handle as their starting location when the browser supports `startIn`; the app stores only File System Access handles in local IndexedDB, not absolute path strings. Folder scanning is capped at 5,000 files and 8 directory levels to avoid expensive traversal of large or network-backed trees. If the cap is reached, the app warns the user that skipped files will not be available as Markdown candidates or relative image assets. The Folder Permission action can attach a directory handle to the current Markdown file without reloading the file contents, so unsaved edits remain in memory. When the selected directory grants write access, pasted, dropped, or inserted image files are written to `MarkdownFileName.assets/` next to the opened Markdown file and inserted as relative Markdown references. Browsers do not expose the absolute folder path to web pages, so the app stores only the selected folder's relative file tree for the current session.

## Bundled libraries

- markdown-it is initialized with raw HTML disabled.
- Mermaid is initialized with `securityLevel: 'strict'` and `htmlLabels: false`; generated SVG is sanitized before insertion, and failures fall back to escaped source code.
- KaTeX JavaScript, CSS, and fonts are loaded from `vendor/katex/`; render errors are displayed as escaped math source.
- CSP keeps `script-src 'self'`, `font-src 'self' data:`, and `connect-src 'none'`.
- `style-src 'self' 'unsafe-inline'` is allowed for Mermaid/KaTeX generated styles only. Script execution, network connections, and raw HTML remain blocked.

## Local storage

The app uses localStorage for draft recovery, UI settings, link allowlist domains, and keyboard shortcut assignments. File System Access handles for Markdown folders and optional settings folders are stored in local IndexedDB. This is local to the browser profile, not encrypted. For sensitive documents, save the file explicitly and clear the draft from the UI or browser settings.

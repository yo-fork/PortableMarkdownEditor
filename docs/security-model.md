# Security Model

## Goals

Portable Markdown Editer protects local editing sessions from common Markdown preview risks:

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

## URL policy

| Type | Allowed | Blocked examples |
| --- | --- | --- |
| Link | relative, `#anchor`, allowlisted `http`/`https` domains | `javascript:`, `vbscript:`, protocol-relative URLs, non-allowlisted `http`/`https`, `mailto`, `tel`, `file` |
| Image | raster `data:` URL, `blob:`, folder-open relative path, `file:` URL, Windows drive path, UNC path | `https://...`, `data:text/html`, `data:image/svg+xml`, non-raster file extensions |

Remote images are blocked to avoid tracking pixels and accidental network access. Local and network-drive image references are allowed only for PNG/JPEG/GIF/WebP paths visible to the current PC. Relative images are resolved against the opened Markdown file only when the user opens a folder, because browser file inputs do not expose the original file-system directory for a single selected file.

## Local storage

The app uses localStorage for draft recovery and settings. This is local to the browser profile, not encrypted. For sensitive documents, save the file explicitly and clear the draft from the UI or browser settings.

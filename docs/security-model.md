# Security Model

## Goals

Portable Markdown Editer protects local editing sessions from common Markdown preview risks:

1. raw HTML execution,
2. JavaScript URL execution,
3. remote image tracking,
4. accidental network communication,
5. dependency and CDN tampering.

## Non-goals

- It is not a cryptographic vault.
- It does not protect against a compromised browser or operating system.
- It does not provide collaborative editing or cloud sync.

## Rendering pipeline

1. Markdown text is normalized to LF line endings.
2. Block parser classifies blocks such as headings, tables, code, lists, quotes, and paragraphs.
3. Inline parser escapes text first and only reinserts app-generated placeholders for safe tags.
4. URLs are sanitized before becoming attributes.
5. The result is inserted into the preview container.

The app intentionally does not support raw HTML rendering.

## URL policy

| Type | Allowed | Blocked examples |
| --- | --- | --- |
| Link | relative, `#anchor`, `http`, `https`, `mailto`, `tel` | `javascript:`, `vbscript:`, protocol-relative URLs |
| Image | `data:image/png`, `data:image/jpeg`, `data:image/gif`, `data:image/webp`, `blob:` | `https://...`, `data:text/html`, `data:image/svg+xml` |

Remote images are blocked to avoid tracking pixels and accidental network access.

## Local storage

The app uses localStorage for draft recovery and settings. This is local to the browser profile, not encrypted. For sensitive documents, save the file explicitly and clear the draft from the UI or browser settings.

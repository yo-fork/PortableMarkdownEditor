# Third-Party Licenses

This project is MIT licensed. Bundled third-party browser libraries must remain local and must not be loaded from a CDN at runtime.

The bundled library files and their upstream license files are stored under `vendor/`. The local inventory and SHA-256 hashes are recorded in `vendor/manifest.json`; regenerate hash output with `node tools/hash-vendor.mjs` and update the manifest manually after reviewing changes.

| Library | Version | Purpose | License | Local files |
| --- | --- | --- | --- | --- |
| markdown-it | 14.1.1 | Markdown parsing | MIT | `vendor/markdown-it/markdown-it.min.js`, `vendor/markdown-it/LICENSE`, `vendor/markdown-it/package.json` |
| @highlightjs/cdn-assets | 11.11.1 | Code highlighting assets | BSD-3-Clause | `vendor/highlight/highlight.min.js`, `vendor/highlight/styles/github-dark.min.css`, `vendor/highlight/LICENSE`, `vendor/highlight/package.json` |
| mermaid | 11.15.0 | Mermaid diagram rendering | MIT | `vendor/mermaid/mermaid.min.js`, `vendor/mermaid/LICENSE`, `vendor/mermaid/package.json` |
| KaTeX | 0.16.46 | Math rendering | MIT | `vendor/katex/katex.min.js`, `vendor/katex/katex.min.css`, `vendor/katex/fonts/`, `vendor/katex/LICENSE` |

## Review notes

- Mermaid's browser bundle may include dependency code from the Mermaid package. `vendor/mermaid/package.json` is recorded with the bundle, and Mermaid updates require dependency license review before replacing local files. REVIEW REQUIRED for any bundled dependency license not directly confirmed from local files.
- KaTeX's local bundle does not include `vendor/katex/package.json`; version `0.16.46` is confirmed from the local KaTeX CSS/JS bundle metadata.

## Mermaid package dependency license review

The following dependency list is copied from local `vendor/mermaid/package.json`. Licenses for these dependencies are not inferred here; they require review from the corresponding package metadata before updating the Mermaid bundle.

| Dependency | Version range | License status |
| --- | --- | --- |
| `@braintree/sanitize-url` | `^7.1.1` | REVIEW REQUIRED |
| `@iconify/utils` | `^3.0.2` | REVIEW REQUIRED |
| `@types/d3` | `^7.4.3` | REVIEW REQUIRED |
| `@upsetjs/venn.js` | `^2.0.0` | REVIEW REQUIRED |
| `cytoscape` | `^3.33.1` | REVIEW REQUIRED |
| `cytoscape-cose-bilkent` | `^4.1.0` | REVIEW REQUIRED |
| `cytoscape-fcose` | `^2.2.0` | REVIEW REQUIRED |
| `d3` | `^7.9.0` | REVIEW REQUIRED |
| `d3-sankey` | `^0.12.3` | REVIEW REQUIRED |
| `dagre-d3-es` | `7.0.14` | REVIEW REQUIRED |
| `dayjs` | `^1.11.19` | REVIEW REQUIRED |
| `dompurify` | `^3.3.1` | REVIEW REQUIRED |
| `es-toolkit` | `^1.45.1` | REVIEW REQUIRED |
| `katex` | `^0.16.25` | REVIEW REQUIRED |
| `khroma` | `^2.1.0` | REVIEW REQUIRED |
| `marked` | `^16.3.0` | REVIEW REQUIRED |
| `roughjs` | `^4.6.6` | REVIEW REQUIRED |
| `stylis` | `^4.3.6` | REVIEW REQUIRED |
| `ts-dedent` | `^2.2.0` | REVIEW REQUIRED |
| `uuid` | `^11.1.0 || ^12 || ^13 || ^14.0.0` | REVIEW REQUIRED |
| `@mermaid-js/parser` | `^1.1.1` | REVIEW REQUIRED |

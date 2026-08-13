# Third-Party Licenses

This project is MIT licensed. Bundled third-party browser libraries must remain local and must not be loaded from a CDN at runtime.

The bundled library files and their upstream license files are stored under `vendor/`. The local inventory and SHA-256 hashes are recorded in `vendor/manifest.json`; regenerate hash output with `node tools/hash-vendor.mjs` and update the manifest manually after reviewing changes.

| Library | Version | Purpose | License | Local files |
| --- | --- | --- | --- | --- |
| markdown-it | 14.1.1 | Markdown parsing | MIT | `vendor/markdown-it/markdown-it.min.js`, `vendor/markdown-it/LICENSE`, `vendor/markdown-it/package.json` |
| @highlightjs/cdn-assets | 11.11.1 | Code highlighting assets | BSD-3-Clause | `vendor/highlight/highlight.min.js`, `vendor/highlight/styles/github-dark.min.css`, `vendor/highlight/LICENSE`, `vendor/highlight/package.json` |
| mermaid | 11.15.0 | Mermaid diagram rendering | MIT | `vendor/mermaid/mermaid.min.js`, `vendor/mermaid/LICENSE`, `vendor/mermaid/package.json` |
| KaTeX | 0.16.46 | Math rendering | MIT | `vendor/katex/katex.min.js`, `vendor/katex/katex.min.css`, `vendor/katex/fonts/`, `vendor/katex/LICENSE` |
| CodeMirror 6 local packages | see package table below | Source-first editor model experiments | MIT | `vendor/codemirror6/node_modules/`, `vendor/codemirror6/import-map.json`, `vendor/codemirror6/package-lock.json` |
| ProseMirror local bundle | see package table below | Rich editor transaction model | MIT | `vendor/prosemirror/prosemirror-editor.js`, `vendor/prosemirror/licenses/`, `vendor/prosemirror/package-lock.json` |

## Review notes

- Mermaid's browser bundle may include dependency code from the Mermaid package. `vendor/mermaid/package.json` is recorded with the bundle, and Mermaid updates require dependency license review before replacing local files. REVIEW REQUIRED for any bundled dependency license not directly confirmed from local files.
- KaTeX's local bundle does not include `vendor/katex/package.json`; version `0.16.46` is confirmed from the local KaTeX CSS/JS bundle metadata.
- CodeMirror 6 packages were installed once into `.vendor-cache/codemirror6` with `npm install --ignore-scripts --no-audit --no-fund --save-exact ...`; no dependency lifecycle scripts were run. Runtime use remains local-only through files copied into `vendor/codemirror6/`.
- ProseMirror packages were installed once into `.vendor-cache/prosemirror` with `npm install --ignore-scripts --no-audit --no-fund --save-exact ...`; `prosemirror-tables` was added with `npm install --prefix vendor/prosemirror --package-lock-only --ignore-scripts --no-audit --fund=false --save-exact prosemirror-tables@1.8.5` followed by `npm ci --prefix vendor/prosemirror --ignore-scripts --no-audit --fund=false`; no dependency lifecycle scripts were run. Runtime use remains local-only through the classic script bundle at `vendor/prosemirror/prosemirror-editor.js`, which avoids `file://` ESM import restrictions.

## CodeMirror 6 package license review

The following packages are copied from local npm package metadata under `vendor/codemirror6/node_modules/`. All listed packages declare the MIT license.

| Package | Version | License |
| --- | --- | --- |
| `@codemirror/autocomplete` | 6.20.2 | MIT |
| `@codemirror/commands` | 6.10.3 | MIT |
| `@codemirror/lang-css` | 6.3.1 | MIT |
| `@codemirror/lang-html` | 6.4.11 | MIT |
| `@codemirror/lang-javascript` | 6.2.5 | MIT |
| `@codemirror/lang-markdown` | 6.5.0 | MIT |
| `@codemirror/language` | 6.12.3 | MIT |
| `@codemirror/lint` | 6.9.6 | MIT |
| `@codemirror/state` | 6.6.0 | MIT |
| `@codemirror/view` | 6.43.0 | MIT |
| `@lezer/common` | 1.5.2 | MIT |
| `@lezer/css` | 1.3.3 | MIT |
| `@lezer/highlight` | 1.2.3 | MIT |
| `@lezer/html` | 1.3.13 | MIT |
| `@lezer/javascript` | 1.5.4 | MIT |
| `@lezer/lr` | 1.4.10 | MIT |
| `@lezer/markdown` | 1.6.3 | MIT |
| `@marijn/find-cluster-break` | 1.0.2 | MIT |
| `crelt` | 1.0.6 | MIT |
| `style-mod` | 4.1.3 | MIT |
| `w3c-keyname` | 2.2.8 | MIT |

## ProseMirror package license review

The following runtime packages are bundled into `vendor/prosemirror/prosemirror-editor.js`; their local package metadata and license files are copied under `vendor/prosemirror/licenses/`. All listed packages declare the MIT license.

| Package | Version | License |
| --- | --- | --- |
| `orderedmap` | 2.1.1 | MIT |
| `prosemirror-commands` | 1.7.1 | MIT |
| `prosemirror-dropcursor` | 1.8.2 | MIT |
| `prosemirror-gapcursor` | 1.4.1 | MIT |
| `prosemirror-history` | 1.5.0 | MIT |
| `prosemirror-inputrules` | 1.5.1 | MIT |
| `prosemirror-keymap` | 1.2.3 | MIT |
| `prosemirror-markdown` | 1.13.4 | MIT |
| `prosemirror-model` | 1.25.7 | MIT |
| `prosemirror-schema-basic` | 1.2.4 | MIT |
| `prosemirror-schema-list` | 1.5.1 | MIT |
| `prosemirror-state` | 1.4.4 | MIT |
| `prosemirror-tables` | 1.8.5 | MIT |
| `prosemirror-transform` | 1.12.0 | MIT |
| `prosemirror-view` | 1.41.8 | MIT |
| `rope-sequence` | 1.3.4 | MIT |
| `w3c-keyname` | 2.2.8 | MIT |

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

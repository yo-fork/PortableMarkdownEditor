import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sandbox = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL };
sandbox.window = sandbox;
const context = vm.createContext(sandbox);
for (const file of ['vendor/mermaid/mermaid.min.js', 'modules/mermaid-policy.js']) {
  vm.runInContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context);
}
const policy = sandbox.PMEMermaidPolicy;
const mermaid = sandbox.mermaid;
mermaid.initialize({ ...policy.securityConfig(), startOnLoad: false, securityLevel: 'strict',
  htmlLabels: false, flowchart: { htmlLabels: false } });

// Actual vendored parsing, with no DOM or image decoder. Labels requiring DOMPurify
// and sequence properties are additionally exercised by the browser suite.
for (const key of ['img', '"img"', "'img'", '"i\\u006dg"', '"\\x69mg"']) {
  await assert.rejects(policy.assertSafeSource(`flowchart TD\nA@{ ${key}: "../../secret.png" }`, mermaid), /画像や外部資源/);
}
for (const target of ['../../secret.png', '/asset.png', 'https://example.com/p.png',
  'data:image/png;base64,AA==', 'blob:unowned', '#fragment']) {
  await assert.rejects(policy.assertSafeSource(`flowchart TD\nA@{ img: "${target}" }`, mermaid), /画像や外部資源/);
}
for (const source of ['flowchart TD\nA-->B', 'flowchart TD\nA@{ shape: rect }-->B',
  'flowchart TD\nA-->B\nstyle A fill:#fff,stroke:#000',
  'flowchart TD\nA-->B\nclassDef normal fill:#fff,stroke:#000\nclass A normal']) {
  await policy.assertSafeSource(source, mermaid);
}
for (const source of ['block-beta\nA B\nstyle A fill:url(probe.png)',
  'flowchart TD\nA-->B\nstyle A fill:u\\72l\\28probe.png\\29',
  'flowchart TD\nA-->B\nclassDef bad fill:u\\72l\\28probe.png\\29\nclass A bad',
  '%%{init: {"themeCSS":".node { fill: url(../../secret.png); }"}}%%\nflowchart TD\nA-->B',
  '---\nconfig:\n  themeCSS: ".node { fill: url(../../secret.png); }"\n---\nflowchart TD\nA-->B']) {
  await assert.rejects(policy.assertSafeSource(source, mermaid), /画像や外部資源/);
}
for (const prefix of ['%%{init: {"secure":[],"securityLevel":"loose","htmlLabels":true,"flowchart":{"htmlLabels":true},"dompurifyConfig":{"FORBID_TAGS":[]}}}%%',
  '---\nconfig:\n  secure: []\n  securityLevel: loose\n  htmlLabels: true\n  flowchart:\n    htmlLabels: true\n  dompurifyConfig:\n    FORBID_TAGS: []\n---']) {
  await policy.assertSafeSource(prefix + '\nflowchart TD\nA-->B', mermaid);
  const config = mermaid.mermaidAPI.getConfig();
  assert.equal(config.htmlLabels, false);
  assert.equal(config.flowchart.htmlLabels, false);
  assert.ok(config.dompurifyConfig.FORBID_TAGS.includes('img'));
}

for (const css of ['fill:#fff;stroke:rgb(0,0,0)', 'marker-end:url(#arrow)', 'filter: url("#shadow")']) {
  assert.equal(policy.isSafeStyle(css), true, css);
}
for (const css of ['fill:url(../../secret.png)', 'fill:u\\72l\\28secret.png\\29',
  'fill:u/**/rl(secret.png)', 'background:image-set("secret.png" 1x)',
  '@im\\70ort "secret.css"', 'fill:u\\\nrl(secret.png)', 'fill:url("#ok");stroke:url(other.svg)',
  'fill:var(--x, url(blob:unowned))', 'background:-webkit-image-set("secret.png" 1x)']) {
  assert.equal(policy.isSafeStyle(css), false, css);
}

// Semantic DB checks use same-realm Maps and do not depend on a fake DOM sanitizer.
async function withActor(icon) {
  await vm.runInContext(`PMEMermaidPolicy.assertSafeSource('sequenceDiagram', {
    parse: async () => {}, mermaidAPI: {
      getConfig: () => ({ ...PMEMermaidPolicy.securityConfig(), securityLevel: 'strict', htmlLabels: false }),
      getDiagramFromText: async () => ({ db: { getActors: () => new Map([['A', { properties: { icon: ${JSON.stringify(icon)} } }]]) } })
    }
  })`, context);
}
for (const icon of ['../../secret.png', 'data:image/png;base64,AA==', 'blob:unowned', '@../secret.svg']) {
  await assert.rejects(withActor(icon), /画像や外部資源/);
}
await withActor('@local-icon');
await withActor('');
await assert.rejects(policy.assertSafeSource('flowchart TD\nA-->B', {}), /描画前検査/);
await assert.rejects(policy.assertSafeSource('A'.repeat(50001), mermaid), /表示上限/);

console.log('Mermaid resource policy checks passed (vendor parsing, escaped metadata, styles, configuration, sequence icons)');

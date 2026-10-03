(() => {
  'use strict';

  const IMAGE_TAGS = ['img', 'image', 'feimage', 'picture', 'source', 'video', 'audio'];
  const MESSAGE = 'Mermaid内の画像や外部資源は表示できません。画像はMarkdownの画像参照を使用してください。';

  function securityConfig() {
    return {
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering',
        'maxEdges', 'htmlLabels', 'dompurifyConfig'],
      dompurifyConfig: { FORBID_TAGS: [...IMAGE_TAGS, 'style'], FORBID_ATTR: ['src', 'srcset'] },
    };
  }

  function normalizeCss(value) {
    // Decode CSS escapes before testing functions, including escaped delimiters.
    return String(value || '').replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\\(?:\r\n|[\n\r\f])/g, '')
      .replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\n\r\f])/gi, (_all, hex, character) => {
        const point = hex && Number.parseInt(hex, 16);
        return hex ? point && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd' : character;
      }).toLowerCase();
  }

  function isSafeStyle(value) {
    const css = normalizeCss(value);
    if (/@\s*import|expression\s*\(|javascript\s*:|data\s*:/.test(css)) return false;
    if (/(?:image-set|image|cross-fade|src|paint)\s*\(/.test(css)) return false;
    const withoutLocalUrls = css.replace(/url\(\s*(['"]?)#[^\s'"()<>]+\1\s*\)/g, '');
    return !/url\s*\(/.test(withoutLocalUrls);
  }

  function reject() { throw new Error(MESSAGE); }

  function inspectStyles(value, allStrings = false) {
    const seen = new Set();
    let remaining = 20000;
    function visit(item, styleContext) {
      if (--remaining < 0) throw new Error('Mermaidの設定またはスタイルが表示上限を超えています。');
      if (typeof item === 'string') { if (styleContext && !isSafeStyle(item)) reject(); return; }
      if (!item || typeof item !== 'object' || seen.has(item)) return;
      seen.add(item);
      if (item instanceof Map || item instanceof Set || Array.isArray(item)) {
        for (const child of item.values()) visit(child, styleContext);
      } else {
        for (const [key, child] of Object.entries(item)) visit(child, styleContext || /style/i.test(key));
      }
    }
    visit(value, allStrings);
  }

  async function assertSafeSource(source, mermaid) {
    const api = mermaid?.mermaidAPI;
    if (!mermaid?.parse || !api?.getDiagramFromText || !api?.getConfig) {
      throw new Error('Mermaidの描画前検査を使用できません。');
    }
    if (String(source).length > 50000) throw new Error('Mermaidのソースが表示上限を超えています。');
    // parse applies init/frontmatter configuration. getDiagramFromText alone does not.
    // Both calls must stay in the application's single Mermaid render queue.
    const parsed = await mermaid.parse(source);
    inspectStyles(parsed?.config, true);
    const config = api.getConfig();
    const forbidden = config.dompurifyConfig?.FORBID_TAGS || [];
    if (config.securityLevel !== 'strict' || config.htmlLabels !== false
      || config.flowchart?.htmlLabels === true || !IMAGE_TAGS.every((tag) => forbidden.includes(tag))) reject();
    inspectStyles(config, true);
    const diagram = await api.getDiagramFromText(source);
    const db = diagram?.db;
    if (!db) throw new Error('Mermaidの解析結果を確認できません。');
    if (typeof db.getVertices === 'function') {
      for (const vertex of db.getVertices().values()) {
        if (vertex.img || /^(?:image|imageSquare)$/.test(vertex.type || '')) reject();
      }
    }
    if (typeof db.getActors === 'function') {
      for (const actor of db.getActors().values()) {
        const icon = actor.properties?.icon;
        if (icon && (typeof icon !== 'string' || !/^@[A-Za-z_][\w:.-]*$/.test(icon))) reject();
      }
    }
    for (const getter of ['getVertices', 'getEdges', 'getClasses', 'getActors', 'getData', 'getBlocks', 'getBlocksFlat']) {
      if (typeof db[getter] === 'function') inspectStyles(db[getter]());
    }
  }

  window.PMEMermaidPolicy = Object.freeze({ securityConfig, assertSafeSource, isSafeStyle });
})();

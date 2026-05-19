import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const source = stripCommentsAndStrings(app);

const forbidden = [
  { name: 'eval()', pattern: /\beval\s*\(/ },
  { name: 'new Function', pattern: /new\s+Function\b/ },
  { name: 'fetch()', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'Worker', pattern: /\bWorker\b/ },
];

for (const rule of forbidden) {
  assert.doesNotMatch(source, rule.pattern, `${rule.name} must not be used in executable app.js code`);
}

console.log('security lint checks passed');

function stripCommentsAndStrings(text) {
  let output = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '/' && next === '/') {
      index = consumeLineComment(text, index + 2, output);
      output += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      const consumed = consumeBlockComment(text, index + 2);
      output += consumed.mask;
      index = consumed.index;
      continue;
    }

    if (char === '"' || char === "'") {
      const consumed = consumeQuotedString(text, index + 1, char);
      output += consumed.mask;
      index = consumed.index;
      continue;
    }

    if (char === '`') {
      const consumed = consumeTemplateString(text, index + 1);
      output += consumed.mask;
      index = consumed.index;
      continue;
    }

    output += char;
    index += 1;
  }
  return output;
}

function consumeLineComment(text, index) {
  while (index < text.length && text[index] !== '\n') index += 1;
  return index + 1;
}

function consumeBlockComment(text, index) {
  let mask = '  ';
  while (index < text.length) {
    if (text[index] === '*' && text[index + 1] === '/') {
      return { index: index + 2, mask: `${mask}  ` };
    }
    mask += text[index] === '\n' ? '\n' : ' ';
    index += 1;
  }
  return { index, mask };
}

function consumeQuotedString(text, index, quote) {
  let mask = ' ';
  while (index < text.length) {
    const char = text[index];
    mask += char === '\n' ? '\n' : ' ';
    index += 1;
    if (char === '\\') {
      if (index < text.length) {
        mask += text[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    if (char === quote) break;
  }
  return { index, mask };
}

function consumeTemplateString(text, index) {
  let mask = ' ';
  while (index < text.length) {
    const char = text[index];
    mask += char === '\n' ? '\n' : ' ';
    index += 1;
    if (char === '\\') {
      if (index < text.length) {
        mask += text[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    if (char === '`') break;
  }
  return { index, mask };
}

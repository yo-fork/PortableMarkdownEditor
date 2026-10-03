export const blockedLinkUrls = [
  String.raw`/\attacker.example/share`,
  String.raw`\/attacker.example/share`,
  String.raw`\\attacker.example/share`,
  '//attacker.example/share',
  '///attacker.example/share',
  String.raw`/\example.com/share`,
  String.raw`docs\guide.md`,
  String.raw`#section\name`,
  '/\t\\attacker.example/share',
  String.raw`https://example.com\@attacker.example/share`,
  'https://attacker.example/share',
  'https://example.com.attacker.example/share',
  'https://notexample.com/share',
  'https://user:password@example.com/share',
  'javascript:alert(1)',
  'file://attacker.example/share',
  'file:///C:/local.md',
  'data:text/html,hello',
];

export const blockedMarkdownLinks = [
  String.raw`[mixed](/\attacker.example/share)`,
  String.raw`[angle](</\attacker.example/share>)`,
  String.raw`[unc](<\\attacker.example/share>)`,
  '[network](//attacker.example/share)',
  '[encoded](/%5cattacker.example/share)',
  '[encoded-upper](/%5Cattacker.example/share)',
  '[entity](/&#92;attacker.example/share)',
];

export const relativeLinkUrls = ['guide.md', './guide.md', '../guide.md', '/docs/guide.md', '#section', '#日本語'];

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const repoRoot = new URL('..', import.meta.url);
const indexEntries = execFileSync('git', ['ls-files', '-s', '--'], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
});

const executablePaths = indexEntries
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.match(/^(\d{6}) [0-9a-f]+ \d+\t(.+)$/))
  .filter((match) => match?.[1] === '100755')
  .map((match) => match[2])
  .filter((path) => existsSync(new URL(path, repoRoot)));

assert.deepEqual(
  executablePaths,
  [],
  `tracked text/assets should use mode 100644 on this Windows project:\n${executablePaths.join('\n')}`,
);

console.log('repository hygiene checks passed');

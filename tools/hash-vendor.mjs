import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = path.join(root, 'vendor');

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function toRepoPath(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

const files = await collectFiles(vendorRoot);
files.sort((a, b) => toRepoPath(a).localeCompare(toRepoPath(b)));

const hashes = [];
for (const file of files) {
  const data = await readFile(file);
  const info = await stat(file);
  hashes.push({
    path: toRepoPath(file),
    bytes: info.size,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
}

console.log(JSON.stringify(hashes, null, 2));

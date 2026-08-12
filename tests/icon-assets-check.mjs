import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const png = readFileSync(new URL('../native/Assets/AppIcon.png', import.meta.url));
const ico = readFileSync(new URL('../native/Assets/AppIcon.ico', import.meta.url));

assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'app icon source must be a PNG');
assert.equal(png.readUInt32BE(12), 0x49484452, 'app icon PNG must begin with an IHDR chunk');
assert.equal(png.readUInt32BE(16), 1024, 'app icon PNG width changed unexpectedly');
assert.equal(png.readUInt32BE(20), 1024, 'app icon PNG height changed unexpectedly');
assert.equal(png[25], 6, 'app icon PNG must use RGBA color');

assert.equal(ico.readUInt16LE(0), 0, 'ICO reserved header must be zero');
assert.equal(ico.readUInt16LE(2), 1, 'app icon must be an ICO image');
const imageCount = ico.readUInt16LE(4);
assert.equal(imageCount, 7, 'app icon must contain seven Windows icon sizes');

const actualSizes = [];
for (let index = 0; index < imageCount; index += 1) {
  const entryOffset = 6 + (index * 16);
  const width = ico[entryOffset] || 256;
  const height = ico[entryOffset + 1] || 256;
  const byteLength = ico.readUInt32LE(entryOffset + 8);
  const imageOffset = ico.readUInt32LE(entryOffset + 12);
  assert.equal(width, height, 'each Windows icon frame must be square');
  assert.ok(byteLength > 0, `ICO ${width}px frame must not be empty`);
  assert.ok(imageOffset + byteLength <= ico.length, `ICO ${width}px frame must fit inside the file`);
  actualSizes.push(width);
}

assert.deepEqual(actualSizes.sort((left, right) => left - right), [16, 24, 32, 48, 64, 128, 256]);
console.log('icon asset checks passed');

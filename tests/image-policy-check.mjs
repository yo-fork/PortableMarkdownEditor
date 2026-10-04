import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../modules/image-policy.js');
const { LIMITS, inspectRaster, createRenderBudget } = PMEImagePolicy;
const concat = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)));
const be16 = value => Buffer.from([value >>> 8, value & 255]);
const le16 = value => Buffer.from([value & 255, value >>> 8]);
const be32 = value => Buffer.from([value >>> 24, value >>> 16, value >>> 8, value]);
const le32 = value => Buffer.from([value, value >>> 8, value >>> 16, value >>> 24]);
const le24 = value => le32(value).subarray(0, 3);
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

// Synthetic fixtures exercise encoded structure without ever calling a decoder.
// CRCs are included, but the admission policy is not a compressed-payload validator.
function pngChunk(type, data = []) {
  const body = concat(Buffer.from(type), data);
  let crc = 0xffffffff;
  for (const value of body) {
    crc ^= value;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return concat(be32(body.length - 4), body, be32((crc ^ 0xffffffff) >>> 0));
}
const ihdr = (width, height) => pngChunk('IHDR', concat(be32(width), be32(height), [8, 6, 0, 0, 0]));
const idat = () => pngChunk('IDAT', [1]);
const iend = () => pngChunk('IEND');
const png = (width = 1, height = 1, extra = []) => concat(pngSignature, ihdr(width, height), ...extra, idat(), iend());
const fctl = (sequence, width, height, x = 0, y = 0) => pngChunk('fcTL',
  concat(be32(sequence), be32(width), be32(height), be32(x), be32(y), [0, 1, 0, 10, 0, 0]));
function apng(width, height, count, separateDefault = false) {
  const parts = [pngSignature, ihdr(width, height), pngChunk('acTL', concat(be32(count), be32(0)))];
  let sequence = 0;
  if (separateDefault) parts.push(idat());
  for (let i = 0; i < count; i += 1) {
    parts.push(fctl(sequence++, width, height));
    parts.push(i === 0 && !separateDefault ? idat() : pngChunk('fdAT', concat(be32(sequence++), [1])));
  }
  return concat(...parts, iend());
}
const gifHead = (width, height) => concat(Buffer.from('GIF89a'), le16(width), le16(height), [128, 0, 0], [0, 0, 0, 255, 255, 255]);
const gifFrame = (width, height, x = 0, y = 0) => concat([0x2c], le16(x), le16(y), le16(width), le16(height), [0, 2, 2, 0x44, 1, 0]);
const gif = (width = 1, height = 1, frames = 1) => concat(gifHead(width, height), ...Array.from({ length: frames }, () => gifFrame(width, height)), [0x3b]);
const jpegSegment = (marker, data) => concat([0xff, marker], be16(data.length + 2), data);
const sof = (width, height, marker = 0xc0) => jpegSegment(marker, concat([8], be16(height), be16(width), [1, 1, 0x11, 0]));
const sos = (progressive = false) => jpegSegment(0xda, [1, 1, 0, 0, progressive ? 0 : 63, 0]);
const jpeg = (width = 1, height = 1, marker = 0xc0, metadata = []) => concat([0xff, 0xd8], ...metadata, sof(width, height, marker), sos(marker === 0xc2), [0, 0xff, 0xd9]);
const webpChunk = (type, data) => concat(Buffer.from(type), le32(data.length), data, data.length & 1 ? [0] : []);
const vp8 = (width, height) => webpChunk('VP8 ', concat([0x30, 0, 0, 0x9d, 1, 0x2a], le16(width), le16(height), [0]));
const vp8l = (width, height) => webpChunk('VP8L', concat([0x2f], le32((width - 1) + (height - 1) * 16384), [0]));
const vp8x = (width, height, flags = 0) => webpChunk('VP8X', concat([flags, 0, 0, 0], le24(width - 1), le24(height - 1)));
const webp = (...chunks) => {
  const body = concat(Buffer.from('WEBP'), ...chunks);
  return concat(Buffer.from('RIFF'), le32(body.length), body);
};
const anmf = (width, height, image = vp8l(width, height), x = 0, y = 0) => webpChunk('ANMF',
  concat(le24(x), le24(y), le24(width - 1), le24(height - 1), [1, 0, 0, 0], image));
const animatedWebp = (width, height, count) => webp(vp8x(width, height, 2), webpChunk('ANIM', Buffer.alloc(6)),
  ...Array.from({ length: count }, () => anmf(width, height)));
const rejects = (bytes, reason, mime = '', name = '') => assert.throws(() => inspectRaster(bytes, mime, name), Error, reason);
const info = (bytes, width, height, frames = 1) => {
  const result = inspectRaster(bytes);
  assert.equal(result.width, width);
  assert.equal(result.height, height);
  assert.equal(result.frames, frames);
  assert.equal(result.pixels, width * height * frames);
  assert.equal(result.size, bytes.length);
  assert.equal(Object.isFrozen(result), true);
  return result;
};

assert.equal(Object.isFrozen(PMEImagePolicy), true);
assert.equal(Object.isFrozen(LIMITS), true);
assert.deepEqual(LIMITS, { fileBytes: 26214400, assets: 64, totalBytes: 67108864, dimension: 8192,
  pixels: 16777216, frames: 60, totalPixels: 33554432, nodes: 64, readMs: 5000, inspectMs: 100, inspectSteps: 131072 });

const realPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64');
const realGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
// A white 1x1 JPEG encoded with the Windows GDI+ JPEG encoder.
const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKAP/2Q==', 'base64');
for (const bytes of [realPng, realGif, validJpeg]) info(bytes, 1, 1);
rejects(validJpeg.subarray(0, validJpeg.length - 5), 'truncated real JPEG is rejected');
assert.throws(() => inspectRaster(realPng, '', '', PMEImagePolicy.now() - 1), /タイムアウト/,
  'a deadline spent acquiring bytes must also reject otherwise valid structure');
const denseCount = LIMITS.inspectSteps + 1;
for (const bytes of [
  concat(pngSignature, ihdr(1, 1), Buffer.concat(Array(denseCount).fill(pngChunk('tEXt'))), idat(), iend()),
  concat(gifHead(1, 1), [0x21, 0xfe], Buffer.alloc(denseCount * 2, 1), [0], gifFrame(1, 1), [0x3b]),
  concat([0xff, 0xd8], Buffer.alloc(denseCount, 0xff), sof(1, 1), sos(), [0xff, 0xd9]),
  webp(vp8x(1, 1), Buffer.concat(Array(denseCount).fill(webpChunk('EXIF', []))), vp8l(1, 1)),
]) assert.throws(() => inspectRaster(bytes), /処理上限|タイムアウト/, 'dense container work is rejected');
// The byte limit still permits a large ordinary entropy stream: it is scanned
// in bounded chunks, not charged once per pixel/byte as a container structure.
info(concat([0xff, 0xd8], sof(1, 1), sos(), Buffer.alloc(24 * 1024 * 1024), [0xff, 0xd9]), 1, 1);

for (const [extension, mime, bytes] of [
  ['png', 'image/png', png()], ['jpg', 'image/jpeg', jpeg()], ['gif', 'image/gif', gif()], ['webp', 'image/webp', webp(vp8l(1, 1))],
]) {
  assert.equal(inspectRaster(bytes, mime, 'image.' + extension).mimeType, mime);
  assert.equal(inspectRaster(bytes, mime.toUpperCase(), 'image.' + extension.toUpperCase()).extension, '.' + extension);
  assert.equal(inspectRaster(bytes, 'application/octet-stream', 'extensionless').mimeType, mime);
  assert.equal(inspectRaster(bytes, '', 'folder/image.' + extension).mimeType, mime);
  rejects(bytes, 'forged MIME', 'image/svg+xml');
  rejects(bytes, 'forged supported extension', '', 'image.' + (extension === 'png' ? 'gif' : 'png'));
  rejects(bytes, 'unknown extension', '', 'image.svg');
  for (let end = 0; end < bytes.length; end += 1) rejects(bytes.subarray(0, end), `${extension} truncated at ${end}`);
  rejects(concat(bytes, [0]), 'trailing bytes');
}
assert.equal(inspectRaster(jpeg(), 'image/jpeg', 'image.jpeg').extension, '.jpg');
rejects(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'SVG bytes cannot spoof PNG', 'image/png', 'image.png');
rejects(new Uint8Array(LIMITS.fileBytes + 1), 'file byte limit');
rejects(new Uint16Array([1]), 'typed byte array required');
for (const make of [png, gif, jpeg, (width, height) => webp(vp8l(width, height))]) {
  info(make(8192, 1), 8192, 1);
  info(make(4096, 4096), 4096, 4096);
  rejects(make(8193, 1), 'dimension limit');
  rejects(make(4097, 4096), 'pixel limit');
}
rejects(png(0, 1), 'zero width');
rejects(png(1, 0xffffffff), 'large unsigned height');
rejects(png(1, 1, [ihdr(8192, 8192)]), 'second IHDR');
rejects(png(1, 1, [pngChunk('ABCD', [])]), 'unknown critical PNG');
info(png(1, 1, [pngChunk('tEXt', Buffer.from('key\0value'))]), 1, 1);
rejects(concat(pngSignature, ihdr(1, 1), be32(0xffffffff), Buffer.from('IDAT'), [0]), 'overflowing chunk length');
for (const make of [apng, gif, animatedWebp]) {
  info(make(2, 3, 2), 2, 3, 2);
  info(make(1, 1, 60), 1, 1, 60);
  rejects(make(1, 1, 61), 'frame count limit');
  rejects(make(4096, 4096, 2), 'animated work uses canvas area times all frames');
}
info(apng(2, 3, 2, true), 2, 3, 3);
rejects(apng(1, 1, 60, true), 'separate fallback also consumes frame budget');
rejects(concat(pngSignature, ihdr(2, 2), pngChunk('acTL', concat(be32(2), be32(0))), fctl(0, 2, 2), idat(), iend()), 'APNG declared/actual frame count mismatch');
rejects(concat(pngSignature, ihdr(2, 2), pngChunk('acTL', concat(be32(1), be32(0))), fctl(0, 1, 1), idat(), iend()), 'APNG IDAT frame dimensions must match IHDR');
rejects(concat(pngSignature, ihdr(2, 2), pngChunk('acTL', concat(be32(1), be32(0))), idat(), fctl(0, 2, 2, 1, 0), pngChunk('fdAT', concat(be32(1), [1])), iend()), 'APNG frame out of canvas');
rejects(concat(pngSignature, ihdr(2, 2), pngChunk('acTL', concat(be32(1), be32(0))), fctl(1, 2, 2), idat(), iend()), 'APNG bad sequence');
rejects(concat(pngSignature, ihdr(1, 1), fctl(0, 1, 1), idat(), iend()), 'APNG control without animation declaration');
rejects(concat(gifHead(2, 2), gifFrame(2, 2, 1, 0), [0x3b]), 'GIF frame out of canvas');
rejects(concat(gifHead(1, 1), [0x21, 0x01, 0], gifFrame(1, 1), [0x3b]), 'GIF plain text unsupported');
rejects(concat(gifHead(1, 1), [0x21, 0xfe, 255, 1, 2]), 'GIF truncated subblock');
info(concat(gifHead(1, 1), [0x21, 0xfe, 2, 65, 66, 0], gifFrame(1, 1), [0x3b]), 1, 1);
info(concat(gifHead(1, 1), [0x21, 0xff, 11], Buffer.from('NETSCAPE2.0'), [3, 1, 0, 0, 0], gifFrame(1, 1), [0x3b]), 1, 1);

for (const marker of [0xc0, 0xc1, 0xc2]) info(jpeg(2, 3, marker), 2, 3);
for (const marker of [0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) rejects(jpeg(2, 3, marker), 'unsupported JPEG frame');
rejects(concat([0xff, 0xd8], sof(1, 1), sof(2, 2), sos(), [0xff, 0xd9]), 'second JPEG SOF');
rejects(jpeg(1, 0), 'JPEG zero height cannot be patched by DNL');
rejects(concat([0xff, 0xd8], sof(1, 1), sos(), [0], jpegSegment(0xdc, be16(8192)), [0xff, 0xd9]), 'DNL inside entropy scan');
rejects(concat([0xff, 0xd8], jpegSegment(0xde, [0, 0]), sof(1, 1), sos(), [0xff, 0xd9]), 'hierarchical JPEG');
info(jpeg(1, 1, 0xc0, [jpegSegment(0xe1, Buffer.alloc(65533))]), 1, 1);
info(concat([0xff, 0xd8], sof(1, 1), sos(), [0xff, 0, 0xff, 0xd0, 0, 0xff, 0xd9]), 1, 1);
rejects(concat([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0]), 'JPEG metadata truncated');

for (const bitstream of [vp8, vp8l]) {
  info(webp(bitstream(2, 3)), 2, 3);
  info(webp(vp8x(2, 3), bitstream(2, 3)), 2, 3);
  rejects(webp(vp8x(2, 3), bitstream(3, 2)), 'WebP canvas contradicts bitstream dimensions');
  rejects(webp(bitstream(2, 3), bitstream(2, 3)), 'WebP duplicate bitstream');
  rejects(webp(vp8x(2, 3, 2), webpChunk('ANIM', Buffer.alloc(6)), anmf(2, 3, bitstream(3, 2))), 'WebP frame contradicts inner bitstream');
}
rejects(webp(vp8x(8193, 1), vp8l(1, 1)), 'WebP enormous extended canvas');
rejects(webp(vp8x(2, 2, 2), webpChunk('ANIM', Buffer.alloc(6)), anmf(2, 2, vp8l(2, 2), 1, 0)), 'WebP frame coordinate is doubled and must fit');
rejects(webp(vp8x(1, 1, 2), anmf(1, 1)), 'WebP missing ANIM');
rejects(webp(vp8x(1, 1), webpChunk('ANIM', Buffer.alloc(6)), anmf(1, 1)), 'WebP undeclared animation');
rejects(webp(vp8x(1, 1), vp8x(1, 1), vp8l(1, 1)), 'WebP duplicate VP8X');
rejects(webp(webpChunk('VP8L', [0x2f, 0, 0, 0, 0xe0, 0])), 'WebP unknown lossless version');
rejects(webp(webpChunk('VP8 ', [0x31, 0, 0, 0x9d, 1, 0x2a, 1, 0, 1, 0, 0])), 'WebP interframe unsupported');
rejects(webp(webpChunk('VP8 ', [0x30, 0, 0, 0x9d, 1, 0x2a, 1, 0x40, 1, 0, 0])), 'WebP scaled dimensions unsupported');
rejects(webp(webpChunk('VP8 ', [0xf0, 0xff, 0xff, 0x9d, 1, 0x2a, 1, 0, 1, 0, 0])), 'WebP truncated first partition');
info(webp(vp8x(1, 1, 16), webpChunk('ALPH', [0, 255]), vp8(1, 1)), 1, 1);
rejects(webp(vp8x(2, 2, 16), webpChunk('ALPH', [0, 255]), vp8(2, 2)), 'WebP raw alpha size must match');
rejects(webp(vp8x(1, 1, 2), webpChunk('ANIM', Buffer.alloc(6)), anmf(1, 1, concat(vp8l(1, 1), vp8l(1, 1)))), 'WebP duplicate inner bitstream');

const one = inspectRaster(png());
const large = inspectRaster(png(4096, 4096));
let budget = createRenderBudget();
for (let i = 0; i < 64; i += 1) assert.equal(budget.reserve(one), true);
assert.equal(budget.reserve(one), false, '65th anonymous image is rejected');
budget = createRenderBudget();
assert.equal(budget.reserve(large, 'first'), true);
assert.equal(budget.reserve(large, 'second'), true);
assert.equal(budget.reserve(one, 'third'), false, 'root decoded pixel total is bounded');
assert.equal(budget.release('first'), true);
assert.equal(budget.release('first'), false);
assert.equal(budget.reserve(one, 'third'), true);
assert.equal(budget.reserve(large, 'third'), true, 'updating token replaces its old reservation');
assert.equal(budget.reserve(one), false);
assert.equal(budget.reserve({ ...large, pixels: LIMITS.totalPixels + 1 }, 'third'), false);
assert.equal(budget.reserve(large, 'replacement'), true, 'denied update releases old reservation');
assert.equal(budget.reserve(one, 'after'), false);
assert.equal(budget.release('third'), false);
assert.equal(budget.release('replacement'), true);
assert.equal(budget.reserve({ ...one, width: NaN }), false);
assert.equal(budget.reserve({ ...one, frames: 0 }), false);
assert.equal(budget.reserve(null), false);
assert.equal(budget.reserve({ ...one, pixels: -1 }), false);
budget = createRenderBudget();
for (let i = 0; i < 64; i += 1) assert.equal(budget.reserve(one, i), true);
for (let i = 0; i < 64; i += 1) assert.equal(budget.reserve(one, i), true, 'same tokens do not leak slots');
assert.equal(budget.reserve(one, 'overflow'), false);
assert.equal(budget.release(0), true);
assert.equal(budget.reserve(one, 'reused'), true);

console.log('image policy checks passed');

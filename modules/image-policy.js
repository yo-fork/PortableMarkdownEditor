(() => {
  'use strict';

  const LIMITS = Object.freeze({
    fileBytes: 25 * 1024 * 1024, assets: 64, totalBytes: 64 * 1024 * 1024,
    dimension: 8192, pixels: 16 * 1024 * 1024, frames: 60,
    totalPixels: 32 * 1024 * 1024, nodes: 64, readMs: 5000,
    inspectMs: 100, inspectSteps: 131072,
  });
  const TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' });

  function invalid(message = '画像の形式または構造を確認できません。') {
    throw new Error(message);
  }

  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

  function inspectionBudget(deadline) {
    const end = Math.min(Number.isFinite(deadline) ? deadline : Infinity, now() + LIMITS.inspectMs);
    let steps = 0;
    return () => {
      if (++steps > LIMITS.inspectSteps) invalid('画像の構造検査の処理上限を超えています。');
      if (now() >= end) invalid('画像の構造検査がタイムアウトしました。');
    };
  }

  function requireBytes(bytes, offset, length, end = bytes.length) {
    if (offset < 0 || length < 0 || offset + length > end) invalid('画像データが途中で切れています。');
  }

  function ascii(bytes, offset, length) {
    requireBytes(bytes, offset, length);
    let result = '';
    for (let i = 0; i < length; i += 1) result += String.fromCharCode(bytes[offset + i]);
    return result;
  }

  function u16(bytes, offset, little = false) {
    requireBytes(bytes, offset, 2);
    return little ? bytes[offset] + bytes[offset + 1] * 256 : bytes[offset] * 256 + bytes[offset + 1];
  }

  function u24(bytes, offset) {
    requireBytes(bytes, offset, 3);
    return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
  }

  function u32(bytes, offset, little = false) {
    requireBytes(bytes, offset, 4);
    return little ? u24(bytes, offset) + bytes[offset + 3] * 16777216
      : bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
  }

  function dimensions(width, height, frames = 1) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > LIMITS.dimension || height > LIMITS.dimension) invalid('画像の幅または高さが上限を超えています。');
    if (!Number.isInteger(frames) || frames < 1 || frames > LIMITS.frames) invalid('画像のフレーム数が上限を超えています。');
    if (width * height * frames > LIMITS.pixels) invalid('画像の展開後の画素数が上限を超えています。');
    return { width, height, frames };
  }

  function rectangle(width, height, x, y, canvas) {
    dimensions(width, height);
    if (x + width > canvas.width || y + height > canvas.height) invalid('画像のフレームが描画範囲を超えています。');
  }

  // Inspect encoded structure only. Compressed pixel data is never inflated here.
  // PNG/APNG: https://www.w3.org/TR/png-3/
  function pngHeader(bytes) {
    requireBytes(bytes, 8, 25);
    if (u32(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') invalid();
    const canvas = dimensions(u32(bytes, 16), u32(bytes, 20));
    const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) invalid();
    return canvas;
  }

  function inspectPng(bytes, check) {
    const canvas = pngHeader(bytes);
    let offset = 33;
    let declared = 0;
    let frames = 0;
    let sequence = 0;
    let frame = null;
    let hasIdat = false;
    let idatEnded = false;
    let idatBytes = 0;
    let hasPalette = false;
    let separateDefault = false;
    while (offset < bytes.length) {
      check();
      requireBytes(bytes, offset, 12);
      const length = u32(bytes, offset);
      const type = ascii(bytes, offset + 4, 4);
      const data = offset + 8;
      requireBytes(bytes, data, length + 4);
      if (!/^[A-Za-z]{4}$/.test(type) || (bytes[offset + 6] & 32)) invalid();
      if (hasIdat && type !== 'IDAT') idatEnded = true;
      if (type === 'IHDR') invalid('画像の寸法ヘッダーが重複しています。');
      if (type === 'acTL') {
        if (declared || hasIdat || length !== 8) invalid();
        declared = u32(bytes, data);
        dimensions(canvas.width, canvas.height, declared);
      } else if (type === 'fcTL') {
        if (!declared || length !== 26 || (frame && !frame.dataBytes) || u32(bytes, data) !== sequence++) invalid();
        const width = u32(bytes, data + 4);
        const height = u32(bytes, data + 8);
        const x = u32(bytes, data + 12);
        const y = u32(bytes, data + 16);
        rectangle(width, height, x, y, canvas);
        if (bytes[data + 24] > 2 || bytes[data + 25] > 1) invalid();
        if (!hasIdat && (frames || x || y || width !== canvas.width || height !== canvas.height)) invalid();
        if (!frames) separateDefault = hasIdat;
        frames += 1;
        if (frames > declared) invalid();
        // A separate fallback image also consumes a decoded surface.
        dimensions(canvas.width, canvas.height, declared + Number(separateDefault));
        frame = { idat: !hasIdat, dataBytes: 0 };
      } else if (type === 'fdAT') {
        if (!hasIdat || !frame || frame.idat || length < 4 || u32(bytes, data) !== sequence++) invalid();
        frame.dataBytes += length - 4;
      } else if (type === 'IDAT') {
        if (idatEnded || (bytes[25] === 3 && !hasPalette)) invalid();
        hasIdat = true;
        idatBytes += length;
        if (frame) {
          if (!frame.idat) invalid();
          frame.dataBytes += length;
        }
      } else if (type === 'PLTE') {
        if (hasPalette || hasIdat || !length || length > 768 || length % 3 || [0, 4].includes(bytes[25])) invalid();
        hasPalette = true;
      } else if (type === 'IEND') {
        if (length || !idatBytes || offset + 12 !== bytes.length || (frame && !frame.dataBytes) || frames !== declared) invalid();
        return dimensions(canvas.width, canvas.height, declared ? declared + Number(separateDefault) : 1);
      } else if (!(bytes[offset + 4] & 32)) {
        invalid('未対応の PNG 構造です。');
      }
      offset = data + length + 4;
    }
    invalid();
  }

  // GIF89a: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
  function gifSubblocks(bytes, start, check) {
    let offset = start;
    let size = 0;
    while (true) {
      check();
      requireBytes(bytes, offset, 1);
      const length = bytes[offset++];
      if (!length) return { offset, size };
      requireBytes(bytes, offset, length);
      size += length;
      offset += length;
    }
  }

  function inspectGif(bytes, check) {
    requireBytes(bytes, 0, 13);
    const canvas = dimensions(u16(bytes, 6, true), u16(bytes, 8, true));
    let offset = 13;
    if (bytes[10] & 128) offset += 3 * (2 ** ((bytes[10] & 7) + 1));
    requireBytes(bytes, 0, offset);
    let frames = 0;
    while (offset < bytes.length) {
      check();
      const type = bytes[offset++];
      if (type === 0x3b) {
        if (!frames || offset !== bytes.length) invalid();
        return dimensions(canvas.width, canvas.height, frames);
      }
      if (type === 0x21) {
        requireBytes(bytes, offset, 1);
        const label = bytes[offset++];
        if (label === 0xf9) {
          requireBytes(bytes, offset, 6);
          if (bytes[offset] !== 4 || bytes[offset + 5] !== 0 || (bytes[offset + 1] & 0xe0)
            || ((bytes[offset + 1] >> 2) & 7) > 3) invalid();
          offset += 6;
        } else if (label === 0xff) {
          requireBytes(bytes, offset, 12);
          if (bytes[offset] !== 11) invalid();
          offset = gifSubblocks(bytes, offset + 12, check).offset;
        } else if (label === 0xfe) {
          offset = gifSubblocks(bytes, offset, check).offset;
        } else invalid('未対応の GIF 拡張です。');
      } else if (type === 0x2c) {
        requireBytes(bytes, offset, 9);
        rectangle(u16(bytes, offset + 4, true), u16(bytes, offset + 6, true),
          u16(bytes, offset, true), u16(bytes, offset + 2, true), canvas);
        const flags = bytes[offset + 8];
        if (flags & 0x18) invalid();
        offset += 9;
        if (flags & 128) offset += 3 * (2 ** ((flags & 7) + 1));
        requireBytes(bytes, offset, 1);
        if (bytes[offset] < 2 || bytes[offset] > 8) invalid();
        const blocks = gifSubblocks(bytes, offset + 1, check);
        if (!blocks.size) invalid();
        offset = blocks.offset;
        frames += 1;
        dimensions(canvas.width, canvas.height, frames);
      } else invalid();
    }
    invalid();
  }

  function jpegFrame(bytes, data, length, marker) {
    if (![0xc0, 0xc1, 0xc2].includes(marker) || length < 11 || bytes[data] !== 8) invalid('未対応の JPEG フレームです。');
    const canvas = dimensions(u16(bytes, data + 3), u16(bytes, data + 1));
    const components = bytes[data + 5];
    if (components < 1 || components > 4 || length !== 8 + 3 * components) invalid();
    const ids = new Set();
    for (let i = 0; i < components; i += 1) {
      const start = data + 6 + i * 3;
      const sampling = bytes[start + 1];
      if (ids.has(bytes[start]) || !(sampling >> 4) || (sampling >> 4) > 4
        || !(sampling & 15) || (sampling & 15) > 4 || bytes[start + 2] > 3) invalid();
      ids.add(bytes[start]);
    }
    return { ...canvas, ids, progressive: marker === 0xc2 };
  }

  function jpegScan(bytes, data, length, frame) {
    if (!frame || length < 8) invalid();
    const count = bytes[data];
    if (count < 1 || count > frame.ids.size || length !== 6 + 2 * count) invalid();
    const ids = new Set();
    for (let i = 0; i < count; i += 1) {
      const id = bytes[data + 1 + 2 * i];
      const tables = bytes[data + 2 + 2 * i];
      if (!frame.ids.has(id) || ids.has(id) || (tables >> 4) > 3 || (tables & 15) > 3) invalid();
      ids.add(id);
    }
    const start = bytes[data + 1 + count * 2];
    const end = bytes[data + 2 + count * 2];
    const approximation = bytes[data + 3 + count * 2];
    if (!frame.progressive && (start || end !== 63 || approximation)) invalid();
    if (frame.progressive && (start > end || end > 63 || (start === 0 && end !== 0)
      || (start > 0 && count !== 1) || (approximation >> 4) > 13 || (approximation & 15) > 13)) invalid();
  }

  function inspectJpeg(bytes, check) {
    let offset = 2;
    let frame = null;
    let scans = 0;
    let entropy = false;
    while (offset < bytes.length) {
      check();
      // Search only a bounded byte range before checking the deadline again.
      if (entropy && bytes[offset] !== 0xff) {
        const end = Math.min(bytes.length, offset + 32768);
        const marker = bytes.subarray(offset, end).indexOf(0xff);
        offset = marker < 0 ? end : offset + marker;
        continue;
      }
      if (bytes[offset++] !== 0xff) invalid();
      while (offset < bytes.length && bytes[offset] === 0xff) { check(); offset += 1; }
      requireBytes(bytes, offset, 1);
      const marker = bytes[offset++];
      if (entropy && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
      entropy = false;
      if (marker === 0xd9) {
        if (!frame || !scans || offset !== bytes.length) invalid();
        return dimensions(frame.width, frame.height);
      }
      if (marker === 0xdc) invalid('高さを後から変更する JPEG は表示できません。');
      requireBytes(bytes, offset, 2);
      const length = u16(bytes, offset);
      if (length < 2) invalid();
      requireBytes(bytes, offset, length);
      const data = offset + 2;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (frame) invalid('画像の寸法ヘッダーが重複しています。');
        frame = jpegFrame(bytes, data, length, marker);
      } else if (marker === 0xda) {
        jpegScan(bytes, data, length, frame);
        scans += 1;
        // Bound repeated progressive scans in addition to decoded surface size.
        if (scans > 256) invalid('JPEG の走査回数が上限を超えています。');
        entropy = true;
      } else if (![0xc4, 0xdb, 0xdd, 0xfe].includes(marker) && !(marker >= 0xe0 && marker <= 0xef)) {
        invalid('未対応の JPEG 構造です。');
      }
      offset += length;
    }
    invalid();
  }

  // WebP: https://developers.google.com/speed/webp/docs/riff_container
  function webpChunk(bytes, offset, end) {
    requireBytes(bytes, offset, 8, end);
    const length = u32(bytes, offset + 4, true);
    const data = offset + 8;
    requireBytes(bytes, data, length + (length & 1), end);
    if ((length & 1) && bytes[data + length] !== 0) invalid();
    return { type: ascii(bytes, offset, 4), data, length, end: data + length + (length & 1) };
  }

  function webpBitstream(bytes, chunk) {
    const { type, data, length } = chunk;
    if (type === 'VP8L') {
      if (length <= 5 || bytes[data] !== 0x2f || (bytes[data + 4] >> 5)) invalid();
      const bits = u32(bytes, data + 1, true);
      return dimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
    }
    if (type !== 'VP8 ' || length <= 10 || (bytes[data] & 1) || ((bytes[data] >> 1) & 7) > 3
      || !(bytes[data] & 16) || ascii(bytes, data + 3, 3) !== '\x9d\x01\x2a') invalid();
    const partition = u24(bytes, data) >>> 5;
    if (!partition || partition > length - 10) invalid();
    const width = u16(bytes, data + 6, true);
    const height = u16(bytes, data + 8, true);
    if ((width & 0xc000) || (height & 0xc000)) invalid('拡大指定を含む WebP は表示できません。');
    return dimensions(width, height);
  }

  function webpAlpha(bytes, chunk, canvas) {
    const flags = bytes[chunk.data];
    if (chunk.length < 2 || (flags & 0xc0) || ((flags >> 4) & 3) > 1 || (flags & 3) > 1) invalid();
    if ((flags & 3) === 0 && chunk.length !== 1 + canvas.width * canvas.height) invalid();
  }

  function webpFrame(bytes, start, end, expected, check) {
    let image = null;
    let alpha = null;
    let offset = start;
    while (offset < end) {
      check();
      const chunk = webpChunk(bytes, offset, end);
      if (chunk.type === 'ALPH') {
        if (alpha || image) invalid();
        alpha = chunk;
      } else if (chunk.type === 'VP8 ' || chunk.type === 'VP8L') {
        if (image || (alpha && chunk.type === 'VP8L')) invalid();
        image = webpBitstream(bytes, chunk);
      } else invalid('未対応の WebP フレーム構造です。');
      offset = chunk.end;
    }
    if (!image || image.width !== expected.width || image.height !== expected.height) invalid('WebP の寸法情報が一致しません。');
    if (alpha) webpAlpha(bytes, alpha, image);
  }

  function inspectWebp(bytes, check) {
    requireBytes(bytes, 0, 12);
    if (u32(bytes, 4, true) + 8 !== bytes.length) invalid();
    let offset = 12;
    let canvas = null;
    let image = null;
    let alpha = null;
    let animated = false;
    let hasAnim = false;
    let frames = 0;
    while (offset < bytes.length) {
      check();
      const chunk = webpChunk(bytes, offset, bytes.length);
      const { type, data, length } = chunk;
      if (type === 'VP8X') {
        if (offset !== 12 || length !== 10 || (bytes[data] & 0xc1) || u24(bytes, data + 1)) invalid();
        canvas = dimensions(u24(bytes, data + 4) + 1, u24(bytes, data + 7) + 1);
        animated = Boolean(bytes[data] & 2);
      } else if (type === 'ANIM') {
        if (!canvas || !animated || hasAnim || frames || length !== 6) invalid();
        hasAnim = true;
      } else if (type === 'ANMF') {
        if (!animated || !hasAnim || length < 16 || (bytes[data + 15] & 0xfc)) invalid();
        const width = u24(bytes, data + 6) + 1;
        const height = u24(bytes, data + 9) + 1;
        rectangle(width, height, u24(bytes, data) * 2, u24(bytes, data + 3) * 2, canvas);
        webpFrame(bytes, data + 16, data + length, { width, height }, check);
        frames += 1;
        dimensions(canvas.width, canvas.height, frames);
      } else if (type === 'VP8 ' || type === 'VP8L') {
        if (animated || image || (alpha && type === 'VP8L')) invalid();
        image = webpBitstream(bytes, chunk);
        if (canvas && (canvas.width !== image.width || canvas.height !== image.height)) invalid('WebP の寸法情報が一致しません。');
        if (alpha) webpAlpha(bytes, alpha, image);
      } else if (type === 'ALPH') {
        if (!canvas || animated || alpha || image) invalid();
        alpha = chunk;
      } else if (!['ICCP', 'EXIF', 'XMP '].includes(type) || !canvas) {
        invalid('未対応の WebP 構造です。');
      }
      offset = chunk.end;
    }
    if (animated) {
      if (!frames) invalid();
      return dimensions(canvas.width, canvas.height, frames);
    }
    if (!image) invalid();
    return image;
  }

  function inspectRaster(bytes, mimeType = '', name = '', deadline = Infinity) {
    if (!(bytes instanceof Uint8Array) || !bytes.length) invalid();
    if (bytes.length > LIMITS.fileBytes) invalid('画像ファイルが 25 MiB を超えています。');
    const check = inspectionBudget(deadline);
    check();
    let extension;
    let info;
    if (bytes.length >= 8 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') {
      extension = 'png'; info = inspectPng(bytes, check);
    } else if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) {
      extension = 'gif'; info = inspectGif(bytes, check);
    } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      extension = 'jpg'; info = inspectJpeg(bytes, check);
    } else if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
      extension = 'webp'; info = inspectWebp(bytes, check);
    } else invalid('PNG、JPEG、GIF、WebP の画像だけを表示できます。');
    const actualMime = TYPES[extension];
    const providedMime = String(mimeType).split(';', 1)[0].trim().toLowerCase();
    if (providedMime && providedMime !== 'application/octet-stream' && providedMime !== actualMime) invalid('画像の MIME 型と内容が一致しません。');
    const suffix = String(name).split(/[\\/]/).pop().match(/\.([^.]+)$/)?.[1].toLowerCase();
    const namedType = suffix === 'jpeg' ? 'jpg' : suffix;
    if (namedType && namedType !== extension) invalid('画像の拡張子と内容が一致しません。');
    check();
    return Object.freeze({ mimeType: actualMime, ...info, pixels: info.width * info.height * info.frames,
      size: bytes.length, extension: '.' + extension });
  }

  function createRenderBudget() {
    const reservations = new Map();
    let count = 0;
    let pixels = 0;
    function release(token) {
      if (!reservations.has(token)) return false;
      pixels -= reservations.get(token);
      count -= 1;
      reservations.delete(token);
      return true;
    }
    function reserve(info, token) {
      if (token !== undefined) release(token);
      try {
        if (!info) return false;
        dimensions(info.width, info.height, info.frames);
        if (info.pixels !== info.width * info.height * info.frames) return false;
      } catch { return false; }
      if (count >= LIMITS.nodes || pixels + info.pixels > LIMITS.totalPixels) return false;
      count += 1;
      pixels += info.pixels;
      if (token !== undefined) reservations.set(token, info.pixels);
      return true;
    }
    return Object.freeze({ reserve, release });
  }

  window.PMEImagePolicy = Object.freeze({ LIMITS, inspectRaster, createRenderBudget, now });
})();

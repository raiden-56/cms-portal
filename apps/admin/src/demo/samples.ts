/** Sample files for the demo media library, generated in code so nothing has to be shipped or downloaded. */
import type { UploadedFile } from './routes/media';

/** Small non-cryptographic content hash: enough to recognise an identical file being uploaded twice. */
export function checksum(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}${bytes.length.toString(16).padStart(8, '0')}`;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function asUpload(name: string, mimeType: string, bytes: Uint8Array): UploadedFile {
  return { name, size: bytes.length, bytes, dataUrl: `data:${mimeType};base64,${toBase64(bytes)}`, checksum: checksum(bytes) };
}

const text = (value: string) => new TextEncoder().encode(value);

/** A gradient cover with a label, in the style of the API's own seed images. */
export function svgImage(name: string, width: number, height: number, from: string, to: string, label: string): UploadedFile {
  const size = Math.round(Math.min(width, height) * 0.09);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${width * 0.78}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.28}" fill="rgba(255,255,255,0.10)"/>
  <text x="${width * 0.06}" y="${height * 0.86}" font-family="Arial, sans-serif" font-size="${size}" font-weight="700" fill="rgba(255,255,255,0.92)">${label}</text>
</svg>`;
  return asUpload(name, 'image/svg+xml', text(svg));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A real PNG (truecolour, uncompressed deflate blocks) of a two-colour diagonal gradient. */
export function pngImage(name: string, width: number, height: number, from: [number, number, number], to: [number, number, number]): UploadedFile {
  const row = width * 3 + 1;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      const at = y * row + 1 + x * 3;
      for (let ch = 0; ch < 3; ch += 1) raw[at + ch] = Math.round(from[ch] + (to[ch] - from[ch]) * t);
    }
  }
  // zlib stream made of stored blocks (max 65535 bytes each) followed by the Adler-32 checksum.
  const blocks = Math.ceil(raw.length / 65535);
  const zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  zlib.set([0x78, 0x01]);
  let at = 2;
  for (let i = 0; i < blocks; i += 1) {
    const chunk = raw.subarray(i * 65535, (i + 1) * 65535);
    zlib.set([i === blocks - 1 ? 1 : 0, chunk.length & 0xff, chunk.length >>> 8, ~chunk.length & 0xff, (~chunk.length >>> 8) & 0xff], at);
    zlib.set(chunk, at + 5);
    at += 5 + chunk.length;
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  new DataView(zlib.buffer).setUint32(at, ((b << 16) | a) >>> 0);

  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(text(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return asUpload(name, 'image/png', png);
}

/** A one-page PDF with a single line of text. */
export function pdfDocument(name: string, line: string): UploadedFile {
  const stream = `BT /F1 20 Tf 72 720 Td (${line.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return asUpload(name, 'application/pdf', text(body));
}

export const textFile = (name: string, mimeType: string, content: string): UploadedFile => asUpload(name, mimeType, text(content));

/**
 * Jest cannot do Nest's dynamic ESM import of `file-type` (it needs
 * --experimental-vm-modules), so FileTypeValidator would fail closed (400) for
 * every upload. Mapped via jest.config.js moduleNameMapper (works however
 * pnpm lays out node_modules, unlike jest.mock by name).
 *
 * This is a tiny faithful magic-number sniffer, so tests send real file bytes
 * and the validator + each controller's allowed-type regex genuinely run.
 */
type Sniffed = { mime: string; ext: string } | undefined;

const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) =>
  bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function sniff(buf: Uint8Array): Sniffed {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a'))) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (startsWith(buf, ascii('%PDF-'))) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  if (startsWith(buf, ascii('BM'))) {
    return { mime: 'image/bmp', ext: 'bmp' };
  }
  if (startsWith(buf, ascii('ID3')) || startsWith(buf, [0xff, 0xfb])) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WAVE'), 8)) {
    return { mime: 'audio/wav', ext: 'wav' };
  }
  if (startsWith(buf, ascii('ftyp'), 4)) {
    const brand = String.fromCharCode(...buf.slice(8, 12));
    if (brand === 'M4A ') return { mime: 'audio/x-m4a', ext: 'm4a' };
    return { mime: 'video/mp4', ext: 'mp4' };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { mime: 'video/webm', ext: 'webm' };
  }
  if (
    startsWith(buf, ascii('OggS')) &&
    startsWith(buf, ascii('\x01vorbis'), 28)
  ) {
    return { mime: 'audio/ogg', ext: 'ogg' };
  }
  return undefined; // text (svg/html), empty, garbage: not recognised
}

export const loadEsm = () =>
  Promise.resolve({
    fileTypeFromBuffer: (buf: Uint8Array) => Promise.resolve(sniff(buf)),
  });

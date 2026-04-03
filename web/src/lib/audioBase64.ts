/** Detect WAV / MP3 / ID3 from magic bytes for Blob MIME. */
export function detectAudioMime(buf: Uint8Array): string {
  if (
    buf.length > 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  ) {
    return "audio/wav";
  }
  if (
    (buf.length > 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
    (buf.length > 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }
  return "audio/wav";
}

export function base64ToObjectUrl(base64: string): string | null {
  try {
    const bin = atob(base64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const blob = new Blob([buf], { type: detectAudioMime(buf) });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

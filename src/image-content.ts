const rasterSignatures: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/png": bytes => bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value),
  "image/jpeg": bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/gif": bytes => bytes.length >= 6 && (new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF87a" || new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF89a"),
  "image/webp": bytes => bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
};

export function normalizeRasterImageType(contentType: string): string | null {
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return Object.hasOwn(rasterSignatures, mediaType) ? mediaType : null;
}

export function hasRasterImageSignature(contentType: string, data: ArrayBuffer | Uint8Array): boolean {
  const mediaType = normalizeRasterImageType(contentType);
  if (!mediaType) return false;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return rasterSignatures[mediaType](bytes);
}

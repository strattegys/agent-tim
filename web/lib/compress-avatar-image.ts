/**
 * Resize a user-picked image to a max square side for avatar upload.
 * Prefers createImageBitmap + resize so very large images are not fully decoded when possible.
 * Always uses timeouts so the UI cannot hang forever on decode/encode.
 */
const DEFAULT_MAX_SIDE = 512;
const DEFAULT_LOAD_MS = 25_000;
const DEFAULT_ENCODE_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
}

async function encodePng(canvas: HTMLCanvasElement, encodeTimeoutMs: number): Promise<Blob> {
  return withTimeout(
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Compression failed"))),
        "image/png",
        0.85
      );
    }),
    encodeTimeoutMs,
    "Image encode timed out"
  );
}

async function compressViaCreateImageBitmap(
  file: File,
  maxSide: number,
  loadTimeoutMs: number,
  encodeTimeoutMs: number
): Promise<Blob> {
  let bmp = await withTimeout(
    createImageBitmap(file, { resizeWidth: maxSide }),
    loadTimeoutMs,
    "Image decode timed out"
  );
  try {
    if (bmp.height > maxSide) {
      bmp.close();
      bmp = await withTimeout(
        createImageBitmap(file, { resizeHeight: maxSide }),
        loadTimeoutMs,
        "Image decode timed out"
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.drawImage(bmp, 0, 0);
    return await encodePng(canvas, encodeTimeoutMs);
  } finally {
    bmp.close();
  }
}

async function compressViaImageElement(
  file: File,
  maxSide: number,
  loadTimeoutMs: number,
  encodeTimeoutMs: number
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const t = setTimeout(() => reject(new Error("Image load timed out")), loadTimeoutMs);
      image.onload = () => {
        clearTimeout(t);
        resolve(image);
      };
      image.onerror = () => {
        clearTimeout(t);
        reject(new Error("Failed to load image"));
      };
      image.src = url;
    });
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w <= 0 || h <= 0) throw new Error("Invalid image dimensions");
    if (w > maxSide || h > maxSide) {
      if (w > h) {
        h = Math.round((h * maxSide) / w);
        w = maxSide;
      } else {
        w = Math.round((w * maxSide) / h);
        h = maxSide;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.drawImage(img, 0, 0, w, h);
    return await encodePng(canvas, encodeTimeoutMs);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressAvatarImage(
  file: File,
  options?: { maxSide?: number; loadTimeoutMs?: number; encodeTimeoutMs?: number }
): Promise<Blob> {
  const maxSide = options?.maxSide ?? DEFAULT_MAX_SIDE;
  const loadTimeoutMs = options?.loadTimeoutMs ?? DEFAULT_LOAD_MS;
  const encodeTimeoutMs = options?.encodeTimeoutMs ?? DEFAULT_ENCODE_MS;

  if (typeof createImageBitmap === "function") {
    try {
      return await compressViaCreateImageBitmap(file, maxSide, loadTimeoutMs, encodeTimeoutMs);
    } catch {
      // HEIC/odd types or engine quirks — fall back
    }
  }

  return compressViaImageElement(file, maxSide, loadTimeoutMs, encodeTimeoutMs);
}

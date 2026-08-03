/**
 * Downscale an image File to a JPEG data URL before upload.
 *
 * This is not a nicety. Merchants are on Bangladeshi mobile uplinks, and a
 * straight-from-camera photo is often 4-6MB: uploading it takes tens of seconds,
 * and every catalog page and product card then re-downloads it on connections
 * just as slow. Capping the long edge cuts upload time, stored bytes, and page
 * weight in one step.
 *
 * Canvas + FileReader only — no dependency. The trade-off is that this runs on
 * the main thread; at 5 images it is not worth moving to a worker.
 */

const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;

export async function downscaleImage(
  file: File,
  maxEdge = MAX_EDGE_PX,
  quality = JPEG_QUALITY
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);

    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    // Only ever shrink. Upscaling a small image would inflate it for nothing.
    const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    // JPEG has no alpha; without this, transparent PNG areas encode as black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the selected image'));
    img.src = src;
  });
}

/**
 * Phone photos are often 4–12 MB, more than one upload may carry (4 MB here; the host refuses
 * anything over 4.5 MB before our code even runs). Large photos are redrawn in the browser at most
 * 2400 px on the long side as JPEG before they are sent; small ones, PDFs and anything the browser
 * cannot open go as they are, and the server still checks every file.
 */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const UPLOAD_TOO_BIG = 'That file is larger than 4 MB. Choose a smaller one.';

export async function shrinkImage(file: File, maxSide = 2400): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size <= 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // JPEG has no transparency: a white background instead of black behind a transparent PNG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.85, 0.75, 0.6]) {
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', quality));
      if (blob && blob.size <= UPLOAD_MAX_BYTES) {
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
      }
    }
  } catch {
    // The browser cannot open this format (e.g. HEIC outside Safari): send it as it is.
  }
  return file;
}

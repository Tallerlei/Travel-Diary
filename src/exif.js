/**
 * EXIF parsing and image utilities.
 */
import exifr from 'exifr';

/**
 * Read a File as a base64 data URL.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(/** @type {string} */ (e.target.result));
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Fetch an image URL as a data URL (proxied through canvas to avoid CORS issues
 * for same-origin images; for cross-origin we rely on CORS headers).
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchImageAsDataURL(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  if (!blob.type.startsWith('image/')) throw new Error('URL is not an image');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(/** @type {string} */ (e.target.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Generate a small thumbnail data URL from a full image data URL.
 * @param {string} dataUrl
 * @param {number} [maxDim=200]
 * @returns {Promise<string>}
 */
export function generateThumbnail(dataUrl, maxDim = 200) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => resolve(dataUrl); // fallback
    img.src = dataUrl;
  });
}

/**
 * Parse EXIF metadata from a File or Blob.
 * Returns null if parsing fails or no relevant data found.
 *
 * @param {File|Blob} file
 * @returns {Promise<{lat?:number, lon?:number, date?:Date, orientation?:number}|null>}
 */
export async function parseExif(file) {
  try {
    const exif = await exifr.parse(file, {
      tiff: true,
      gps: true,
      exif: true,
      iptc: false,
      xmp: false,
      translateValues: true,
    });
    if (!exif) return null;

    const result = {};

    if (exif.latitude != null && exif.longitude != null) {
      result.lat = exif.latitude;
      result.lon = exif.longitude;
    }

    const rawDate = exif.DateTimeOriginal || exif.DateTimeDigitized || exif.DateTime;
    if (rawDate) {
      // exifr returns Date objects for these fields
      result.date = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(result.date.getTime())) delete result.date;
    }

    result.orientation = exif.Orientation || 1;

    return Object.keys(result).length > 0 ? result : null;
  } catch (e) {
    console.warn('EXIF parse failed for', file.name ?? 'blob', e.message);
    return null;
  }
}

/**
 * Format a Date for display (e.g. "14 Mar 2024, 10:32").
 * @param {Date|null|undefined} date
 * @returns {string}
 */
export function formatDate(date) {
  if (!date) return '';
  return date.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  }) + ', ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Convert a Date to the value expected by <input type="datetime-local">.
 * @param {Date|null|undefined} date
 * @returns {string}
 */
export function dateToInputValue(date) {
  if (!date) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

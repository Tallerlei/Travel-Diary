/**
 * Reverse geocoding via the Nominatim OpenStreetMap API.
 *
 * Results are cached in memory so we only hit the API once per unique
 * rounded coordinate pair.
 */

const cache = new Map();

/**
 * Round to 2 decimal places for cache key (≈ 1 km resolution).
 * @param {number} n
 */
const round2 = n => Math.round(n * 100) / 100;

/**
 * Return a human-readable location name for a lat/lon pair.
 * Returns an empty string on failure (never throws).
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string>}
 */
export async function reverseGeocode(lat, lon) {
  const key = `${round2(lat)},${round2(lon)}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}` +
      `&format=json&zoom=18&addressdetails=1`;

    const resp = await fetch(url, {
      headers: { 'Accept-Language': navigator.language || 'en' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const addr = data.address || {};
    const name =
      data.name ||
      addr.amenity ||
      addr.tourism ||
      addr.shop ||
      addr.leisure ||
      addr.village ||
      addr.city ||
      addr.town ||
      addr.hamlet ||
      addr.municipality ||
      addr.county ||
      addr.state ||
      addr.country ||
      data.display_name?.split(',')[0] ||
      '';

    cache.set(key, name);
    return name;
  } catch (e) {
    console.warn('Reverse geocode failed', e.message);
    cache.set(key, '');
    return '';
  }
}

/**
 * Generate a trip title from an ordered list of clusters and a date range.
 *
 * @param {Cluster[]} clusters
 * @returns {string}
 */
export async function generateTripTitle(clusters) {
  if (clusters.length === 0) return 'My Travel Diary';

  // Date range
  const allDates = clusters
    .flatMap(c => c.photos.map(p => p.date))
    .filter(Boolean)
    .sort((a, b) => a - b);

  let datePart = '';
  if (allDates.length > 0) {
    const first = allDates[0];
    const last = allDates[allDates.length - 1];
    const sameMonth =
      first.getFullYear() === last.getFullYear() &&
      first.getMonth() === last.getMonth();

    const monthYear = first.toLocaleDateString(undefined, {
      month: 'long', year: 'numeric',
    });
    datePart = sameMonth
      ? monthYear
      : `${first.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} – ${last.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
  }

  // Places: geocode first and last cluster
  const places = [];
  const first = clusters[0];
  const last = clusters[clusters.length - 1];

  const [nameFirst, nameLast] = await Promise.all([
    reverseGeocode(first.center.lat, first.center.lon),
    clusters.length > 1
      ? reverseGeocode(last.center.lat, last.center.lon)
      : Promise.resolve(''),
  ]);

  if (nameFirst) places.push(nameFirst);
  if (nameLast && nameLast !== nameFirst) places.push(nameLast);

  const placePart = places.join(' → ');

  if (placePart && datePart) return `${placePart} · ${datePart}`;
  if (placePart) return placePart;
  if (datePart) return `Travel Diary · ${datePart}`;
  return 'My Travel Diary';
}

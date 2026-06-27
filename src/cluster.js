/**
 * Groups photos into location clusters using a simple greedy radius-join.
 *
 * Photos are first sorted by date.  A photo is added to the nearest existing
 * cluster whose centre is within `radiusKm` kilometres; otherwise a new
 * cluster is created.  After all photos are assigned the cluster centres are
 * the arithmetic mean of member coordinates.  Clusters are finally sorted by
 * the date of their earliest photo to give a chronological travel order.
 */

const DEFAULT_RADIUS_KM = 0.15; // 150 m

/**
 * Haversine great-circle distance in kilometres.
 */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Cluster an array of Photo objects.
 *
 * @param {Photo[]} photos  Full photo list (may include ones without GPS).
 * @param {number}  [radiusKm]
 * @returns {{ located: Cluster[], unlocated: Photo[] }}
 */
export function clusterPhotos(photos, radiusKm = DEFAULT_RADIUS_KM) {
  const located = photos.filter(p => p.lat != null && p.lon != null);
  const unlocated = photos.filter(p => p.lat == null || p.lon == null);

  // Sort by date ascending (undated photos go last)
  const sorted = [...located].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date - b.date;
  });

  /** @type {Cluster[]} */
  const clusters = [];

  for (const photo of sorted) {
    let bestCluster = null;
    let bestDist = Infinity;

    for (const cluster of clusters) {
      const d = haversine(photo.lat, photo.lon, cluster.center.lat, cluster.center.lon);
      if (d < radiusKm && d < bestDist) {
        bestDist = d;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      bestCluster.photos.push(photo);
      // Recompute centre
      const n = bestCluster.photos.length;
      bestCluster.center.lat =
        bestCluster.photos.reduce((s, p) => s + p.lat, 0) / n;
      bestCluster.center.lon =
        bestCluster.photos.reduce((s, p) => s + p.lon, 0) / n;
    } else {
      clusters.push({
        id: crypto.randomUUID(),
        center: { lat: photo.lat, lon: photo.lon },
        photos: [photo],
        locationName: null,
      });
    }
  }

  // Sort clusters chronologically
  clusters.sort((a, b) => {
    const aDate = a.photos.find(p => p.date)?.date;
    const bDate = b.photos.find(p => p.date)?.date;
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate - bDate;
  });

  return { located: clusters, unlocated };
}

/**
 * Build an initial route from a sorted cluster list.
 * Returns the cluster centres as waypoints.
 *
 * @param {Cluster[]} clusters
 * @returns {{lat:number, lon:number, clusterId:string}[]}
 */
export function buildRoute(clusters, startClusterId = null) {
  if (clusters.length === 0) return [];
  
  let route = clusters.map(c => ({
    lat: c.center.lat,
    lon: c.center.lon,
    clusterId: c.id,
  }));

  if (startClusterId) {
    const idx = route.findIndex(w => w.clusterId === startClusterId);
    if (idx !== -1 && idx !== 0) {
      route = [...route.slice(idx), ...route.slice(0, idx)];
    }
  }
  
  // Close the loop for a round trip
  if (route.length > 1) {
    route.push({ ...route[0] }); // add a copy of the first point at the end
  }

  return route;
}

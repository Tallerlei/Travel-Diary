/**
 * Leaflet map management.
 *
 * Responsibilities:
 *  – Initialise the Leaflet map.
 *  – Render / update cluster markers (thumbnail bubble + count badge).
 *  – Render / update the route polyline.
 *  – Manage intermediate draggable waypoint markers for route editing.
 *  – Expose helpers: fit to bounds, toggle edit mode, get map instance.
 */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default icon path that Vite/webpack break
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

// ─────────────────────────────────────────────────────────
// Module-level state
// ─────────────────────────────────────────────────────────
/** @type {L.Map|null} */
let map = null;

/** cluster id → L.Marker */
const clusterMarkers = new Map();

/** @type {L.Polyline|null} */
let routeLine = null;

/** waypoint index → L.Marker (intermediate drag handles) */
const waypointMarkers = new Map();

/** Whether the route is in editable state */
let editMode = false;

// ─────────────────────────────────────────────────────────
// Callbacks registered by main.js
// ─────────────────────────────────────────────────────────
let onClusterClick = () => {};
let onWaypointDragged = () => {};
let onRouteLineClick = () => {};
let onMapClick = () => {};

// ─────────────────────────────────────────────────────────
// Initialise
// ─────────────────────────────────────────────────────────

/**
 * Initialise the Leaflet map inside `containerId`.
 *
 * @param {string} containerId
 * @param {{
 *   onClusterClick: (clusterId: string) => void,
 *   onWaypointDragged: (index: number, lat: number, lon: number) => void,
 *   onRouteLineClick: (lat: number, lon: number, segmentIndex: number) => void,
 *   onMapClick: (lat: number, lon: number) => void,
 * }} callbacks
 */
export function initMap(containerId, callbacks) {
  onClusterClick = callbacks.onClusterClick ?? onClusterClick;
  onWaypointDragged = callbacks.onWaypointDragged ?? onWaypointDragged;
  onRouteLineClick = callbacks.onRouteLineClick ?? onRouteLineClick;
  onMapClick = callbacks.onMapClick ?? onMapClick;

  map = L.map(containerId, {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  map.on('click', e => {
    onMapClick(e.latlng.lat, e.latlng.lng);
  });
}

/** Return the Leaflet map instance (may be null before initMap). */
export function getMap() {
  return map;
}

// ─────────────────────────────────────────────────────────
// Cluster markers
// ─────────────────────────────────────────────────────────

/**
 * Re-render all cluster markers.
 * Removes markers for clusters that no longer exist; adds/updates the rest.
 *
 * @param {Cluster[]} clusters
 */
export function renderClusterMarkers(clusters) {
  if (!map) return;

  const currentIds = new Set(clusters.map(c => c.id));

  // Remove stale markers
  for (const [id, marker] of clusterMarkers) {
    if (!currentIds.has(id)) {
      marker.remove();
      clusterMarkers.delete(id);
    }
  }

  // Add / update markers
  for (const cluster of clusters) {
    if (clusterMarkers.has(cluster.id)) {
      // Update position + icon
      const marker = clusterMarkers.get(cluster.id);
      marker.setLatLng([cluster.center.lat, cluster.center.lon]);
      marker.setIcon(clusterIcon(cluster));
    } else {
      const marker = L.marker([cluster.center.lat, cluster.center.lon], {
        icon: clusterIcon(cluster),
        draggable: false,
        zIndexOffset: 100,
      }).addTo(map);

      marker.on('click', () => onClusterClick(cluster.id));
      clusterMarkers.set(cluster.id, marker);
    }

    // Sync draggable state
    const marker = clusterMarkers.get(cluster.id);
    if (editMode) {
      marker.dragging?.enable();
      // Update position when dragged
      marker.off('dragend').on('dragend', e => {
        const { lat, lng } = e.target.getLatLng();
        onWaypointDragged(cluster.id, lat, lng, 'cluster');
      });
    } else {
      marker.dragging?.disable();
      marker.off('dragend');
    }
  }
}

/** Build a Leaflet DivIcon showing the cluster thumbnail + photo count. */
function clusterIcon(cluster) {
  const thumb = cluster.photos[0]?.thumbnail ?? '';
  const count = cluster.photos.length;
  const html = `
    <div class="cluster-bubble">
      ${thumb ? `<img src="${thumb}" alt="" />` : '<span style="font-size:22px;display:flex;align-items:center;justify-content:center;height:100%">📸</span>'}
      ${count > 1 ? `<span class="cluster-count">×${count}</span>` : ''}
    </div>`;
  return L.divIcon({
    html,
    className: 'cluster-marker',
    iconSize: [56, 56],
    iconAnchor: [28, 28],
    popupAnchor: [0, -32],
  });
}

// ─────────────────────────────────────────────────────────
// Route line
// ─────────────────────────────────────────────────────────

/**
 * Render / update the route polyline.
 *
 * @param {{lat:number, lon:number}[]} waypoints
 */
export function renderRoute(waypoints) {
  if (!map) return;

  const latlngs = waypoints.map(w => [w.lat, w.lon]);

  if (routeLine) {
    routeLine.setLatLngs(latlngs);
  } else if (latlngs.length >= 2) {
    routeLine = L.polyline(latlngs, {
      color: '#2563eb',
      weight: 3,
      opacity: 0.7,
      dashArray: '6 6',
    }).addTo(map);

    routeLine.on('click', e => {
      L.DomEvent.stop(e);
      // Find which segment was clicked
      const pts = routeLine.getLatLngs();
      let bestSeg = 0;
      let bestDist = Infinity;
      const clickLL = e.latlng;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = pointToSegmentDistance(clickLL, pts[i], pts[i + 1]);
        if (d < bestDist) { bestDist = d; bestSeg = i; }
      }
      onRouteLineClick(e.latlng.lat, e.latlng.lng, bestSeg);
    });
  }

  // Update waypoint drag handles in edit mode
  if (editMode) renderWaypointHandles(waypoints);
}

/** Distance from a LatLng to a line segment (in map pixels is fine for comparison). */
function pointToSegmentDistance(p, a, b) {
  const dx = b.lat - a.lat;
  const dy = b.lng - a.lng;
  if (dx === 0 && dy === 0) return p.distanceTo(a);
  const t = Math.max(0, Math.min(1,
    ((p.lat - a.lat) * dx + (p.lng - a.lng) * dy) / (dx * dx + dy * dy)
  ));
  return p.distanceTo(L.latLng(a.lat + t * dx, a.lng + t * dy));
}

/**
 * Show / update intermediate waypoint drag handles (in edit mode only).
 * @param {{lat:number, lon:number}[]} waypoints
 */
function renderWaypointHandles(waypoints) {
  if (!map) return;

  // Remove excess handles
  for (const [idx, m] of waypointMarkers) {
    if (idx >= waypoints.length) { m.remove(); waypointMarkers.delete(idx); }
  }

  const dotIcon = L.divIcon({
    html: '<div class="waypoint-dot"></div>',
    className: 'waypoint-marker',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  waypoints.forEach((wp, idx) => {
    if (waypointMarkers.has(idx)) {
      waypointMarkers.get(idx).setLatLng([wp.lat, wp.lon]);
    } else {
      const m = L.marker([wp.lat, wp.lon], {
        icon: dotIcon,
        draggable: true,
        zIndexOffset: 200,
      }).addTo(map);

      m.on('drag', e => {
        const { lat, lng } = e.target.getLatLng();
        // Live update the polyline while dragging
        const lls = routeLine.getLatLngs();
        lls[idx] = L.latLng(lat, lng);
        routeLine.setLatLngs(lls);
      });

      m.on('dragend', e => {
        const { lat, lng } = e.target.getLatLng();
        onWaypointDragged(idx, lat, lng, 'waypoint');
      });

      waypointMarkers.set(idx, m);
    }
  });
}

/** Remove all waypoint drag handles. */
function clearWaypointHandles() {
  for (const m of waypointMarkers.values()) m.remove();
  waypointMarkers.clear();
}

// ─────────────────────────────────────────────────────────
// Edit mode
// ─────────────────────────────────────────────────────────

/**
 * Enable or disable route edit mode.
 * @param {boolean} enabled
 * @param {{lat:number,lon:number}[]} currentWaypoints
 */
export function setEditMode(enabled, currentWaypoints = []) {
  editMode = enabled;

  if (routeLine) {
    routeLine.setStyle({
      weight: enabled ? 4 : 3,
      opacity: enabled ? 0.9 : 0.7,
      color: enabled ? '#7c3aed' : '#2563eb',
    });
  }

  if (enabled) {
    renderWaypointHandles(currentWaypoints);
    // Make cluster markers draggable
    for (const m of clusterMarkers.values()) {
      m.dragging?.enable();
    }
  } else {
    clearWaypointHandles();
    for (const m of clusterMarkers.values()) {
      m.dragging?.disable();
      m.off('dragend');
    }
  }
}

// ─────────────────────────────────────────────────────────
// Fit / show route
// ─────────────────────────────────────────────────────────

/**
 * Pan & zoom the map to show all cluster markers.
 * @param {Cluster[]} clusters
 */
export function fitToRoute(clusters) {
  if (!map || clusters.length === 0) return;
  if (clusters.length === 1) {
    map.setView([clusters[0].center.lat, clusters[0].center.lon], 13);
    return;
  }
  const bounds = L.latLngBounds(
    clusters.map(c => [c.center.lat, c.center.lon])
  );
  map.fitBounds(bounds, { padding: [48, 48] });
}

/**
 * Show / hide the route polyline.
 * @param {boolean} visible
 */
export function setRouteVisible(visible) {
  if (!routeLine) return;
  if (visible) routeLine.addTo(map);
  else routeLine.remove();
}

// ─────────────────────────────────────────────────────────
// Clean up
// ─────────────────────────────────────────────────────────

/** Remove all markers and route from the map. */
export function clearMap() {
  for (const m of clusterMarkers.values()) m.remove();
  clusterMarkers.clear();
  clearWaypointHandles();
  if (routeLine) { routeLine.remove(); routeLine = null; }
}

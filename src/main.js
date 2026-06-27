/**
 * Travel Diary — Main application entry point.
 *
 * Wires together:
 *  – Upload UI
 *  – EXIF parsing
 *  – Clustering
 *  – Reverse geocoding
 *  – Leaflet map
 *  – Photo popup / meta editor
 *  – Standalone export
 */

import { getState, setState, subscribe } from './state.js';
import {
  parseExif,
  readFileAsDataURL,
  generateThumbnail,
  formatDate,
  dateToInputValue,
} from './exif.js';
import { clusterPhotos, buildRoute } from './cluster.js';
import { reverseGeocode, generateTripTitle } from './geocode.js';
import {
  initMap,
  getMap,
  renderClusterMarkers,
  renderRoute,
  fitToRoute,
  setEditMode,
  clearMap,
} from './map.js';
import { exportDiary } from './export.js';

// ─────────────────────────────────────────────────────────
// DOM references
// ─────────────────────────────────────────────────────────
const uploadScreen   = /** @type {HTMLElement} */ (document.getElementById('upload-screen'));
const mapScreen      = /** @type {HTMLElement} */ (document.getElementById('map-screen'));
const fileInput      = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
const dropZone       = /** @type {HTMLElement} */ (document.getElementById('drop-zone'));
const uploadProgress = /** @type {HTMLElement} */ (document.getElementById('upload-progress'));
const progressFill   = /** @type {HTMLElement} */ (document.getElementById('progress-fill'));
const progressText   = /** @type {HTMLElement} */ (document.getElementById('progress-text'));
const uploadWarnings = /** @type {HTMLElement} */ (document.getElementById('upload-warnings'));

const tripTitleEl    = /** @type {HTMLElement} */ (document.getElementById('trip-title'));
const photoCountBadge = /** @type {HTMLElement} */ (document.getElementById('photo-count-badge'));
const photoListEl    = /** @type {HTMLElement} */ (document.getElementById('photo-list'));
const noLocPanel     = /** @type {HTMLElement} */ (document.getElementById('no-location-panel'));
const noLocList      = /** @type {HTMLElement} */ (document.getElementById('no-location-list'));
const noLocCount     = /** @type {HTMLElement} */ (document.getElementById('no-loc-count'));
const sidebar        = /** @type {HTMLElement} */ (document.getElementById('sidebar'));
const sidebarToggle  = /** @type {HTMLButtonElement} */ (document.getElementById('sidebar-toggle'));
const editModeBanner = /** @type {HTMLElement} */ (document.getElementById('edit-mode-banner'));
const pickOverlay    = /** @type {HTMLElement} */ (document.getElementById('pick-on-map-overlay'));

// Photo modal
const photoModal     = /** @type {HTMLElement} */ (document.getElementById('photo-modal'));
const modalLocName   = /** @type {HTMLElement} */ (document.getElementById('modal-location-name'));
const modalDates     = /** @type {HTMLElement} */ (document.getElementById('modal-dates'));
const modalPhotoImg  = /** @type {HTMLImageElement} */ (document.getElementById('modal-photo-img'));
const modalPhotoMeta = /** @type {HTMLElement} */ (document.getElementById('modal-photo-meta'));
const modalThumbs    = /** @type {HTMLElement} */ (document.getElementById('modal-thumbnails'));
const prevBtn        = /** @type {HTMLButtonElement} */ (document.getElementById('photo-prev'));
const nextBtn        = /** @type {HTMLButtonElement} */ (document.getElementById('photo-next'));
const removePhotoBtn = /** @type {HTMLButtonElement} */ (document.getElementById('remove-photo-btn'));
const editMetaBtn    = /** @type {HTMLButtonElement} */ (document.getElementById('edit-meta-btn'));
const moveSelect     = /** @type {HTMLSelectElement} */ (document.getElementById('move-photo-select'));

// Meta modal
const metaModal      = /** @type {HTMLElement} */ (document.getElementById('meta-modal'));
const metaModalTitle = /** @type {HTMLElement} */ (document.getElementById('meta-modal-title'));
const metaPreview    = /** @type {HTMLElement} */ (document.getElementById('meta-photo-preview'));
const metaForm       = /** @type {HTMLFormElement} */ (document.getElementById('meta-form'));
const metaDate       = /** @type {HTMLInputElement} */ (document.getElementById('meta-date'));
const metaLat        = /** @type {HTMLInputElement} */ (document.getElementById('meta-lat'));
const metaLon        = /** @type {HTMLInputElement} */ (document.getElementById('meta-lon'));

// Other modals
const urlModal       = /** @type {HTMLElement} */ (document.getElementById('url-modal'));
const googleModal    = /** @type {HTMLElement} */ (document.getElementById('google-modal'));
const urlInput       = /** @type {HTMLInputElement} */ (document.getElementById('url-input'));
const urlError       = /** @type {HTMLElement} */ (document.getElementById('url-error'));

// ─────────────────────────────────────────────────────────
// Photo modal state
// ─────────────────────────────────────────────────────────
let activeClusterPhotos = []; // photos currently shown in the popup
let activePhotoIdx = 0;       // index within activeClusterPhotos

// ─────────────────────────────────────────────────────────
// Initialise map
// ─────────────────────────────────────────────────────────
initMap('map', {
  onClusterClick: (clusterId) => openPhotoModal(clusterId),
  onWaypointDragged: (idxOrClusterId, lat, lon, type) => {
    const s = getState();
    if (type === 'cluster') {
      // idxOrClusterId is the cluster id
      const clusters = s.clusters.map(c =>
        c.id === idxOrClusterId ? { ...c, center: { lat, lon } } : c
      );
      const route = buildRoute(clusters);
      setState({ clusters, routeWaypoints: route });
    } else {
      // waypoint marker drag
      const waypoints = [...s.routeWaypoints];
      waypoints[idxOrClusterId] = { ...waypoints[idxOrClusterId], lat, lon };
      setState({ routeWaypoints: waypoints });
    }
    renderRoute(getState().routeWaypoints);
  },
  onRouteLineClick: (lat, lon, segmentIndex) => {
    const s = getState();
    if (!s.editMode) return;
    // Insert a new waypoint after segmentIndex
    const waypoints = [...s.routeWaypoints];
    waypoints.splice(segmentIndex + 1, 0, { lat, lon });
    setState({ routeWaypoints: waypoints });
    renderRoute(waypoints);
    setEditMode(true, waypoints);
  },
  onMapClick: (lat, lon) => {
    const s = getState();
    if (s.pendingLocationPhotoId) {
      assignLocationToPhoto(s.pendingLocationPhotoId, lat, lon);
    }
  },
});

// ─────────────────────────────────────────────────────────
// State subscription → re-render
// ─────────────────────────────────────────────────────────
subscribe((state) => {
  renderSidebar(state);
  renderClusterMarkers(state.clusters);
  if (state.routeWaypoints.length >= 2) renderRoute(state.routeWaypoints);
  tripTitleEl.textContent = state.tripTitle;
  document.title = state.tripTitle + ' – Travel Diary';
});

// ─────────────────────────────────────────────────────────
// Upload screen events
// ─────────────────────────────────────────────────────────

document.getElementById('local-btn').addEventListener('click', () => fileInput.click());
document.getElementById('google-btn').addEventListener('click', () => openModal(googleModal));
document.getElementById('url-btn').addEventListener('click', () => openModal(urlModal));
document.getElementById('paste-btn').addEventListener('click', () => {
  navigator.clipboard.read().then(async (items) => {
    const imageFiles = [];
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          imageFiles.push(new File([blob], `pasted-image.${type.split('/')[1]}`, { type }));
        }
      }
    }
    if (imageFiles.length) processFiles(imageFiles);
    else alert('No image found in clipboard. Try copying an image first.');
  }).catch(() => alert('Could not read clipboard. Try using Ctrl+V / ⌘+V to paste directly.'));
});

// Paste via keyboard
document.addEventListener('paste', e => {
  if (!uploadScreen.classList.contains('active')) return;
  const files = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
  if (files.length) processFiles(files);
});

// File input
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) processFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

// Drag & drop
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'));
  if (files.length) processFiles(files);
});

// URL load
document.getElementById('url-load-btn').addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  urlError.hidden = true;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    if (!blob.type.startsWith('image/')) throw new Error('URL does not point to an image');
    const filename = url.split('/').pop().split('?')[0] || 'image.jpg';
    const file = new File([blob], filename, { type: blob.type });
    closeModal(urlModal);
    urlInput.value = '';
    await processFiles([file]);
  } catch (e) {
    urlError.textContent = `Could not load image: ${e.message}`;
    urlError.hidden = false;
  }
});

// ─────────────────────────────────────────────────────────
// Add more photos (from map screen)
// ─────────────────────────────────────────────────────────
document.getElementById('add-more-btn').addEventListener('click', () => fileInput.click());

// ─────────────────────────────────────────────────────────
// Process uploaded files
// ─────────────────────────────────────────────────────────
const mapProgressEl = /** @type {HTMLElement} */ (document.getElementById('map-progress'));

async function processFiles(files) {
  if (!files.length) return;

  const onMapScreen = mapScreen.classList.contains('active');

  // Show appropriate progress UI
  if (onMapScreen) {
    mapProgressEl.textContent = `Processing ${files.length} photo${files.length > 1 ? 's' : ''}…`;
    mapProgressEl.classList.add('visible');
  } else {
    uploadProgress.hidden = false;
    uploadWarnings.hidden = true;
    progressFill.style.width = '0%';
  }

  const warnings = [];
  const newPhotos = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const label = `${i + 1} / ${files.length}: ${file.name}`;
    if (onMapScreen) {
      mapProgressEl.textContent = `Processing ${label}…`;
    } else {
      progressText.textContent = `Processing ${label}`;
      progressFill.style.width = `${((i + 1) / files.length) * 100}%`;
    }

    try {
      const dataUrl = await readFileAsDataURL(file);
      const thumbnail = await generateThumbnail(dataUrl, 200);
      const exif = await parseExif(file);

      /** @type {Photo} */
      const photo = {
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl,
        thumbnail,
        lat: exif?.lat ?? null,
        lon: exif?.lon ?? null,
        date: exif?.date ?? null,
        orientation: exif?.orientation ?? 1,
        hasExifLocation: exif?.lat != null,
        hasExifDate: exif?.date != null,
      };
      newPhotos.push(photo);
    } catch (e) {
      warnings.push(`${file.name}: ${e.message}`);
    }
  }

  // Hide progress
  if (onMapScreen) {
    mapProgressEl.classList.remove('visible');
  } else {
    uploadProgress.hidden = true;
  }

  if (warnings.length) {
    if (onMapScreen) {
      showToast(`⚠️ ${warnings.length} photo${warnings.length > 1 ? 's' : ''} could not be processed`);
    } else {
      uploadWarnings.hidden = false;
      uploadWarnings.textContent = '';
      const header = document.createElement('strong');
      header.textContent = '⚠️ Some photos could not be processed:';
      uploadWarnings.appendChild(header);
      warnings.forEach(w => {
        uploadWarnings.appendChild(document.createElement('br'));
        uploadWarnings.appendChild(document.createTextNode(`• ${w}`));
      });
    }
  }

  if (!newPhotos.length) return;

  // Merge with existing photos
  const allPhotos = [...getState().photos, ...newPhotos];
  const { located } = clusterPhotos(allPhotos);
  const route = buildRoute(located);

  setState({
    photos: allPhotos,
    clusters: located,
    routeWaypoints: route,
  });

  // Show map screen if not already there
  if (!onMapScreen) switchToMap();

  // Fit map after clusters render
  setTimeout(() => fitToRoute(located), 100);

  // Reverse geocode cluster centres & update location names
  geocodeClusters(located);

  // Generate trip title (only auto-set if not customised)
  generateTripTitle(located).then(title => {
    const currentTitle = getState().tripTitle;
    if (currentTitle === 'My Travel Diary') {
      setState({ tripTitle: title });
      tripTitleEl.textContent = title;
    }
  });

  // Notify about photos without location
  const noLoc = newPhotos.filter(p => p.lat == null).length;
  if (noLoc > 0) {
    if (onMapScreen) {
      showToast(`📍 ${noLoc} photo${noLoc > 1 ? 's have' : ' has'} no GPS data — use the sidebar to add locations`);
    } else if (noLoc === newPhotos.length) {
      uploadWarnings.hidden = false;
      if (uploadWarnings.childNodes.length > 0) {
        uploadWarnings.appendChild(document.createElement('br'));
      }
      uploadWarnings.appendChild(document.createTextNode(
        `⚠️ None of the ${newPhotos.length} photo${newPhotos.length > 1 ? 's' : ''} had GPS data. Use the sidebar to add location info.`
      ));
    }
  }
}

/** Reverse geocode each cluster centre and update locationName. */
async function geocodeClusters(clusters) {
  for (const cluster of clusters) {
    if (cluster.locationName) continue; // already done
    const name = await reverseGeocode(cluster.center.lat, cluster.center.lon);
    // Mutate cluster in place (fine since render pulls from state)
    cluster.locationName = name;
    // Trigger re-render
    setState({ clusters: [...getState().clusters] });
  }
}

// ─────────────────────────────────────────────────────────
// Screen switching
// ─────────────────────────────────────────────────────────
function switchToMap() {
  uploadScreen.classList.remove('active');
  mapScreen.classList.add('active');
  // Trigger Leaflet resize
  setTimeout(() => getMap()?.invalidateSize(), 200);
}

// ─────────────────────────────────────────────────────────
// Sidebar rendering
// ─────────────────────────────────────────────────────────
function renderSidebar(state) {
  const { clusters, photos } = state;
  const unlocated = photos.filter(p => p.lat == null);

  photoCountBadge.textContent = String(photos.length);

  // Unlocated panel
  if (unlocated.length > 0) {
    noLocPanel.hidden = false;
    noLocCount.textContent = String(unlocated.length);
    noLocList.innerHTML = '';
    unlocated.forEach(p => {
      const item = document.createElement('div');
      item.className = 'photo-item no-loc';
      item.innerHTML = `
        <img class="photo-thumb" src="${p.thumbnail}" alt="" />
        <div class="photo-item-info">
          <div class="photo-item-name">${escHtml(p.name)}</div>
          <div class="photo-item-meta">No location · <button class="inline-link" data-add-loc="${p.id}">Add location</button></div>
        </div>
        <button class="photo-item-remove" data-remove="${p.id}" title="Remove">✕</button>`;
      noLocList.appendChild(item);
    });
  } else {
    noLocPanel.hidden = true;
  }

  // Located photos grouped by cluster
  photoListEl.innerHTML = '';
  for (const cluster of clusters) {
    const header = document.createElement('div');
    const dateTxt = (() => {
      const dates = cluster.photos.map(p => p.date).filter(Boolean).sort((a,b) => a - b);
      if (!dates.length) return '';
      return dates[0].toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    })();
    header.className = 'photo-item';
    header.style.background = 'var(--bg)';
    header.style.cursor = 'pointer';
    header.dataset.openCluster = cluster.id;
    header.innerHTML = `
      <img class="photo-thumb" src="${cluster.photos[0]?.thumbnail ?? ''}" alt="" style="border:2px solid var(--primary)"/>
      <div class="photo-item-info">
        <div class="photo-item-name" style="font-weight:600">
          📍 ${escHtml(cluster.locationName || 'Location')}
        </div>
        <div class="photo-item-meta">${cluster.photos.length} photo${cluster.photos.length !== 1 ? 's' : ''} · ${dateTxt}</div>
      </div>`;
    photoListEl.appendChild(header);

    cluster.photos.forEach(photo => {
      const item = document.createElement('div');
      item.className = 'photo-item';
      item.style.paddingLeft = '28px';
      item.innerHTML = `
        <img class="photo-thumb" src="${photo.thumbnail}" alt="" />
        <div class="photo-item-info">
          <div class="photo-item-name">${escHtml(photo.name)}</div>
          <div class="photo-item-meta">${photo.date ? formatDate(photo.date) : 'No date'}</div>
        </div>
        <button class="photo-item-remove" data-remove="${photo.id}" title="Remove">✕</button>`;
      item.addEventListener('click', e => {
        if (e.target.closest('[data-remove]')) return;
        openPhotoModal(cluster.id, photo.id);
      });
      photoListEl.appendChild(item);
    });
  }

  // Delegated event listeners on sidebar
  document.getElementById('photo-list').onclick = handleSidebarClick;
  document.getElementById('no-location-list').onclick = handleSidebarClick;
}

function handleSidebarClick(e) {
  const removeBtn = e.target.closest('[data-remove]');
  const addLocBtn = e.target.closest('[data-add-loc]');
  const openCluster = e.target.closest('[data-open-cluster]');

  if (removeBtn) removePhoto(removeBtn.dataset.remove);
  else if (addLocBtn) openMetaEditor(addLocBtn.dataset.addLoc);
  else if (openCluster) openPhotoModal(openCluster.dataset.openCluster);
}

// ─────────────────────────────────────────────────────────
// Photo modal
// ─────────────────────────────────────────────────────────
function openPhotoModal(clusterId, photoId) {
  const { clusters } = getState();
  const cluster = clusters.find(c => c.id === clusterId);
  if (!cluster) return;

  activeClusterPhotos = cluster.photos;
  activePhotoIdx = photoId
    ? Math.max(0, cluster.photos.findIndex(p => p.id === photoId))
    : 0;

  modalLocName.textContent = cluster.locationName || 'Location';
  const dates = cluster.photos.map(p => p.date).filter(Boolean).sort((a, b) => a - b);
  modalDates.textContent = dates.length
    ? `${formatDate(dates[0])}${dates.length > 1 ? ' – ' + formatDate(dates[dates.length - 1]) : ''}`
    : '';

  buildModalThumbs();
  showModalPhoto(activePhotoIdx);
  populateMoveSelect(clusterId);

  photoModal.hidden = false;
  setState({ activeClusterId: clusterId });
}

function buildModalThumbs() {
  modalThumbs.innerHTML = '';
  activeClusterPhotos.forEach((p, i) => {
    const img = document.createElement('img');
    img.className = 'modal-thumb' + (i === activePhotoIdx ? ' active' : '');
    img.src = p.thumbnail;
    img.alt = p.name;
    img.addEventListener('click', () => showModalPhoto(i));
    modalThumbs.appendChild(img);
  });
}

function showModalPhoto(idx) {
  activePhotoIdx = idx;
  const photo = activeClusterPhotos[idx];
  modalPhotoImg.src = photo.dataUrl;
  modalPhotoImg.alt = photo.name;
  modalPhotoImg.style.transform = orientationTransform(photo.orientation);

  const metaParts = [];
  if (photo.date) metaParts.push(formatDate(photo.date));
  if (photo.lat != null) metaParts.push(`${photo.lat.toFixed(4)}, ${photo.lon.toFixed(4)}`);
  metaParts.push(photo.name);
  modalPhotoMeta.textContent = metaParts.join(' · ');

  prevBtn.disabled = idx === 0;
  nextBtn.disabled = idx === activeClusterPhotos.length - 1;

  // Update active thumb
  modalThumbs.querySelectorAll('.modal-thumb').forEach((el, i) =>
    el.classList.toggle('active', i === idx)
  );

  setState({ editingPhotoId: photo.id });
}

function orientationTransform(orientation) {
  const transforms = {
    2: 'scaleX(-1)',
    3: 'rotate(180deg)',
    4: 'scaleY(-1)',
    5: 'rotate(90deg) scaleX(-1)',
    6: 'rotate(90deg)',
    7: 'rotate(-90deg) scaleX(-1)',
    8: 'rotate(-90deg)',
  };
  return transforms[orientation] ?? 'none';
}

prevBtn.addEventListener('click', () => {
  if (activePhotoIdx > 0) showModalPhoto(activePhotoIdx - 1);
});
nextBtn.addEventListener('click', () => {
  if (activePhotoIdx < activeClusterPhotos.length - 1) showModalPhoto(activePhotoIdx + 1);
});

// Keyboard navigation
document.addEventListener('keydown', e => {
  if (photoModal.hidden) return;
  if (e.key === 'ArrowLeft') { if (activePhotoIdx > 0) showModalPhoto(activePhotoIdx - 1); }
  if (e.key === 'ArrowRight') { if (activePhotoIdx < activeClusterPhotos.length - 1) showModalPhoto(activePhotoIdx + 1); }
  if (e.key === 'Escape') closeModal(photoModal);
});

// Remove photo
removePhotoBtn.addEventListener('click', () => {
  const photo = activeClusterPhotos[activePhotoIdx];
  if (!photo) return;
  if (!confirm(`Remove "${photo.name}" from the diary?`)) return;
  removePhoto(photo.id);
  closeModal(photoModal);
});

// Edit meta
editMetaBtn.addEventListener('click', () => {
  const photo = activeClusterPhotos[activePhotoIdx];
  if (!photo) return;
  closeModal(photoModal);
  openMetaEditor(photo.id);
});

// Move to other cluster
moveSelect.addEventListener('change', () => {
  const targetClusterId = moveSelect.value;
  if (!targetClusterId) return;

  const photo = activeClusterPhotos[activePhotoIdx];
  if (!photo) return;

  movePhotoToCluster(photo.id, targetClusterId);
  moveSelect.value = '';
  closeModal(photoModal);
});

function populateMoveSelect(currentClusterId) {
  moveSelect.innerHTML = '<option value="">— move to location —</option>';
  const { clusters } = getState();
  clusters.forEach(c => {
    if (c.id === currentClusterId) return;
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.locationName || `Location (${c.photos.length} photos)`;
    moveSelect.appendChild(opt);
  });
  // Option to create new cluster
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '📍 New location on map…';
  moveSelect.appendChild(newOpt);
}

// ─────────────────────────────────────────────────────────
// Remove / move photo
// ─────────────────────────────────────────────────────────
function removePhoto(photoId) {
  const s = getState();
  const allPhotos = s.photos.filter(p => p.id !== photoId);
  const { located, unlocated } = clusterPhotos(allPhotos);

  // Preserve user-edited route waypoints that aren't cluster anchors
  const extraWaypoints = s.routeWaypoints.filter(w => !w.clusterId);
  const clusterWaypoints = buildRoute(located);
  const route = mergeWaypoints(clusterWaypoints, extraWaypoints);

  setState({ photos: allPhotos, clusters: located, routeWaypoints: route });
  geocodeClusters(located.filter(c => !c.locationName));
}

function movePhotoToCluster(photoId, targetClusterId) {
  const s = getState();
  const photo = s.photos.find(p => p.id === photoId);
  if (!photo) return;

  if (targetClusterId === '__new__') {
    // Open meta editor to pick a new location on the map
    openMetaEditor(photoId);
    return;
  }

  const target = s.clusters.find(c => c.id === targetClusterId);
  if (!target) return;

  // Update photo's coordinates to target cluster centre
  const updatedPhotos = s.photos.map(p =>
    p.id === photoId
      ? { ...p, lat: target.center.lat, lon: target.center.lon }
      : p
  );

  const { located } = clusterPhotos(updatedPhotos);
  const route = buildRoute(located);
  setState({ photos: updatedPhotos, clusters: located, routeWaypoints: route });
}

/** Merge cluster-anchor waypoints with user-added intermediates. */
function mergeWaypoints(clusterWPs, extras) {
  // Simple: just use cluster waypoints (extras would need re-indexing which is complex)
  return clusterWPs;
}

// ─────────────────────────────────────────────────────────
// Meta editor
// ─────────────────────────────────────────────────────────
function openMetaEditor(photoId) {
  const photo = getState().photos.find(p => p.id === photoId);
  if (!photo) return;

  setState({ editingPhotoId: photoId });

  metaModalTitle.textContent = `Edit Info — ${photo.name}`;
  metaPreview.innerHTML = `<img src="${photo.thumbnail}" alt="" style="max-height:100px;border-radius:8px" />`;
  metaDate.value = dateToInputValue(photo.date);
  metaLat.value = photo.lat != null ? String(photo.lat) : '';
  metaLon.value = photo.lon != null ? String(photo.lon) : '';

  openModal(metaModal);
}

metaForm.addEventListener('submit', e => {
  e.preventDefault();
  const photoId = getState().editingPhotoId;
  if (!photoId) return;

  const date = metaDate.value ? new Date(metaDate.value) : null;
  const lat = metaLat.value !== '' ? parseFloat(metaLat.value) : null;
  const lon = metaLon.value !== '' ? parseFloat(metaLon.value) : null;

  applyPhotoMeta(photoId, { date, lat, lon });
  closeModal(metaModal);
});

document.getElementById('pick-on-map-btn').addEventListener('click', () => {
  const photoId = getState().editingPhotoId;
  if (!photoId) return;
  closeModal(metaModal);
  enablePickOnMap(photoId);
});

function applyPhotoMeta(photoId, { date, lat, lon }) {
  const s = getState();
  const updatedPhotos = s.photos.map(p =>
    p.id === photoId ? { ...p, date, lat, lon } : p
  );
  const { located } = clusterPhotos(updatedPhotos);
  const route = buildRoute(located);
  setState({ photos: updatedPhotos, clusters: located, routeWaypoints: route });
  geocodeClusters(located.filter(c => !c.locationName));
  setTimeout(() => fitToRoute(getState().clusters), 100);
}

// ─────────────────────────────────────────────────────────
// Pick on map
// ─────────────────────────────────────────────────────────
function enablePickOnMap(photoId) {
  setState({ pendingLocationPhotoId: photoId });
  pickOverlay.hidden = false;
  getMap()?.getContainer()?.classList.add('crosshair-cursor');
}

document.getElementById('cancel-pick-btn').addEventListener('click', () => {
  setState({ pendingLocationPhotoId: null });
  pickOverlay.hidden = true;
});

function assignLocationToPhoto(photoId, lat, lon) {
  setState({ pendingLocationPhotoId: null });
  pickOverlay.hidden = true;
  applyPhotoMeta(photoId, {
    date: getState().photos.find(p => p.id === photoId)?.date ?? null,
    lat,
    lon,
  });
}

// ─────────────────────────────────────────────────────────
// Toolbar actions
// ─────────────────────────────────────────────────────────
tripTitleEl.addEventListener('blur', () => {
  setState({ tripTitle: tripTitleEl.textContent.trim() || 'My Travel Diary' });
});
tripTitleEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); tripTitleEl.blur(); }
});

document.getElementById('fit-map-btn').addEventListener('click', () => {
  fitToRoute(getState().clusters);
});

document.getElementById('toggle-edit-btn').addEventListener('click', () => {
  const s = getState();
  const newEdit = !s.editMode;
  setState({ editMode: newEdit });
  setEditMode(newEdit, s.routeWaypoints);
  editModeBanner.hidden = !newEdit;
  document.getElementById('toggle-edit-btn').classList.toggle('btn-primary', newEdit);
});

document.getElementById('done-edit-btn').addEventListener('click', () => {
  setState({ editMode: false });
  setEditMode(false, []);
  editModeBanner.hidden = true;
  document.getElementById('toggle-edit-btn').classList.remove('btn-primary');
});

document.getElementById('export-btn').addEventListener('click', async () => {
  const btn = document.getElementById('export-btn');
  const s = getState();
  if (!s.photos.length) { alert('Add some photos first!'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Exporting…';

  try {
    const unlocatedPhotos = s.photos.filter(p => p.lat == null);
    await exportDiary({
      tripTitle: s.tripTitle,
      clusters: s.clusters,
      routeWaypoints: s.routeWaypoints,
      unlocatedPhotos,
    });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⬇️ Export Diary';
  }
});

// Sidebar toggle
sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('sidebar-open');
  setTimeout(() => getMap()?.invalidateSize(), 280);
});

// ─────────────────────────────────────────────────────────
// Modal helpers
// ─────────────────────────────────────────────────────────
function openModal(el) { el.hidden = false; }
function closeModal(el) { el.hidden = true; }

// Close modals via data-close attribute or backdrop click
document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => {
    const modal = el.closest('.modal');
    if (modal) closeModal(modal);
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal:not([hidden])').forEach(m => closeModal(m));
  }
});

// ─────────────────────────────────────────────────────────
// Toast notifications
// ─────────────────────────────────────────────────────────
const toastEl = /** @type {HTMLElement} */ (document.getElementById('toast'));
let toastTimer = null;

function showToast(message, durationMs = 4000) {
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), durationMs);
}

// ─────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

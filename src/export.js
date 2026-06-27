/**
 * Standalone HTML exporter.
 *
 * Generates a self-contained HTML file containing:
 *  – All photos as embedded base64 data URLs
 *  – Map data (clusters, route, title) as inline JSON
 *  – A minimal Leaflet-based viewer (Leaflet loaded from CDN)
 *
 * The exported file works offline for the app logic; map tiles still need
 * internet (OpenStreetMap CDN).
 */

/**
 * Build and trigger a download of the standalone diary HTML.
 *
 * @param {{
 *   tripTitle: string,
 *   clusters: Cluster[],
 *   routeWaypoints: {lat:number,lon:number}[],
 *   unlocatedPhotos?: Photo[],
 * }} diaryData
 */
export async function exportDiary(diaryData) {
  const { tripTitle, clusters, routeWaypoints, unlocatedPhotos = [] } = diaryData;

  // Serialise clusters (include full dataUrl for photos)
  const serialisedClusters = clusters.map(c => ({
    id: c.id,
    center: c.center,
    locationName: c.locationName || '',
    photos: c.photos.map(p => ({
      id: p.id,
      name: p.name,
      dataUrl: p.dataUrl,
      thumbnail: p.thumbnail,
      date: p.date ? p.date.toISOString() : null,
      lat: p.lat,
      lon: p.lon,
    })),
  }));

  const serialisedUnlocated = unlocatedPhotos.map(p => ({
    id: p.id,
    name: p.name,
    dataUrl: p.dataUrl,
    thumbnail: p.thumbnail,
    date: p.date ? p.date.toISOString() : null,
  }));

  const dataJSON = JSON.stringify({
    tripTitle,
    clusters: serialisedClusters,
    routeWaypoints,
    unlocatedPhotos: serialisedUnlocated,
  }).replace(/</g, '\\u003c');

  const html = buildViewerHTML(dataJSON);
  downloadFile(html, `${slugify(tripTitle)}.html`, 'text/html');
}

// ─────────────────────────────────────────────────────────
// Viewer HTML template
// ─────────────────────────────────────────────────────────

function buildViewerHTML(dataJSON) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>Travel Diary</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--primary:#2563eb;--bg:#f8fafc;--surface:#fff;--border:#e2e8f0;--text:#0f172a;--muted:#64748b;--radius:10px;--shadow:0 2px 8px rgba(0,0,0,.12)}
html,body{height:100%;font-family:system-ui,sans-serif;font-size:14px;color:var(--text);overflow:hidden}
#toolbar{display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 16px;background:var(--surface);border-bottom:1px solid var(--border);box-shadow:var(--shadow);position:relative;z-index:400}
#toolbar h1{font-size:18px;font-weight:700}
#layout{display:flex;height:calc(100vh - 52px);overflow:hidden}
#map{flex:1;min-width:0}
#sidebar{width:260px;background:var(--surface);border-left:1px solid var(--border);overflow-y:auto;flex-shrink:0}
#sidebar h3{padding:12px 14px;font-size:13px;font-weight:600;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface)}
.cluster-btn{display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;background:none;border:none;border-bottom:1px solid var(--border);cursor:pointer;text-align:left;transition:background .15s}
.cluster-btn:hover{background:var(--bg)}
.cluster-thumb{width:44px;height:44px;object-fit:cover;border-radius:6px;border:2px solid var(--primary);flex-shrink:0}
.cluster-info{flex:1;min-width:0}
.cluster-name{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cluster-sub{font-size:11px;color:var(--muted)}
/* Modal */
.modal{display:none;position:fixed;inset:0;z-index:1000;align-items:center;justify-content:center;padding:16px}
.modal.open{display:flex}
.modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);backdrop-filter:blur(4px)}
.modal-box{position:relative;z-index:1;background:var(--surface);border-radius:14px;max-width:760px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.2)}
.modal-head{display:flex;align-items:flex-start;justify-content:space-between;padding:18px 22px 12px;border-bottom:1px solid var(--border);flex-shrink:0}
.modal-head h2{font-size:17px;font-weight:700}
.modal-head p{font-size:12px;color:var(--muted);margin-top:2px}
.modal-close{background:none;border:none;font-size:18px;cursor:pointer;color:var(--muted);padding:2px 8px;border-radius:6px}
.modal-close:hover{background:var(--bg)}
.modal-body{padding:20px 22px;overflow-y:auto}
.photo-viewer{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.photo-main{flex:1;background:#0f172a;border-radius:var(--radius);min-height:280px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.photo-main img{max-width:100%;max-height:400px;object-fit:contain}
.photo-meta{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.7));color:#fff;padding:20px 12px 10px;font-size:12px}
.nav-btn{background:var(--surface);border:1px solid var(--border);border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:var(--shadow)}
.nav-btn:disabled{opacity:.3;cursor:default}
.thumbs{display:flex;gap:6px;flex-wrap:wrap}
.thumb{width:52px;height:52px;object-fit:cover;border-radius:6px;cursor:pointer;opacity:.6;border:2px solid transparent;transition:opacity .15s,transform .15s}
.thumb:hover{opacity:.9;transform:scale(1.05)}
.thumb.active{opacity:1;border-color:var(--primary)}
/* Cluster marker */
.cbubble{background:var(--surface);border:3px solid var(--primary);border-radius:50%;width:52px;height:52px;overflow:hidden;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.cbubble img{width:100%;height:100%;object-fit:cover}
.cbadge{position:absolute;bottom:0;right:0;background:var(--primary);color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:999px}
/* Unlocated section */
#unlocated-section{padding:12px 14px}
#unlocated-section h4{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.unloc-item{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)}
.unloc-item img{width:36px;height:36px;object-fit:cover;border-radius:4px}
.unloc-name{font-size:12px;color:var(--muted)}
/* Responsive */
@media(max-width:600px){#sidebar{display:none}}
</style>
</head>
<body>
<div id="toolbar">
  <h1 id="diary-title"></h1>
  <span id="diary-date" style="font-size:12px;color:var(--muted)"></span>
</div>
<div id="layout">
  <div id="map"></div>
  <div id="sidebar">
    <h3>📍 Locations</h3>
    <div id="sidebar-clusters"></div>
    <div id="unlocated-section" style="display:none">
      <h4>📎 No Location</h4>
      <div id="unlocated-list"></div>
    </div>
  </div>
</div>

<!-- Photo modal -->
<div class="modal" id="photo-modal">
  <div class="modal-bg" onclick="closeModal()"></div>
  <div class="modal-box">
    <div class="modal-head">
      <div>
        <h2 id="modal-loc"></h2>
        <p id="modal-dates"></p>
      </div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="photo-viewer">
        <button class="nav-btn" id="prev-btn" onclick="navigate(-1)">&#8249;</button>
        <div class="photo-main">
          <img id="main-img" src="" alt="" />
          <div class="photo-meta" id="photo-meta-text"></div>
        </div>
        <button class="nav-btn" id="next-btn" onclick="navigate(1)">&#8250;</button>
      </div>
      <div class="thumbs" id="thumbs-strip"></div>
    </div>
  </div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const DATA = ${dataJSON};

// ── Setup ─────────────────────────────────────────────────
document.getElementById('diary-title').textContent = DATA.tripTitle;

// Date range
const allDates = DATA.clusters.flatMap(c=>c.photos.map(p=>p.date)).filter(Boolean).sort();
if(allDates.length>0){
  const fmt = d=>new Date(d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
  const txt = allDates.length===1?fmt(allDates[0]):\`\${fmt(allDates[0])} – \${fmt(allDates[allDates.length-1])}\`;
  document.getElementById('diary-date').textContent=txt;
}

// ── Map ───────────────────────────────────────────────────
const map=L.map('map',{center:[20,0],zoom:2});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Route
if(DATA.routeWaypoints.length>=2){
  L.polyline(DATA.routeWaypoints.map(w=>[w.lat,w.lon]),{
    color:'#2563eb',weight:3,opacity:.65,dashArray:'6 6'
  }).addTo(map);
}

// Cluster markers
DATA.clusters.forEach(c=>{
  const thumb=c.photos[0]?.thumbnail||'';
  const count=c.photos.length;
  const icon=L.divIcon({
    html:\`<div class="cbubble" style="position:relative">\${
      thumb?\`<img src="\${thumb}" />\`:'<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:20px">📸</div>'
    }\${count>1?\`<span class="cbadge">×\${count}</span>\`:''}
    </div>\`,
    className:'',iconSize:[52,52],iconAnchor:[26,26]
  });
  L.marker([c.center.lat,c.center.lon],{icon}).addTo(map)
    .on('click',()=>openCluster(c.id));
});

// Fit
if(DATA.clusters.length>0){
  if(DATA.clusters.length===1){
    map.setView([DATA.clusters[0].center.lat,DATA.clusters[0].center.lon],13);
  } else {
    map.fitBounds(L.latLngBounds(DATA.clusters.map(c=>[c.center.lat,c.center.lon])),{padding:[48,48]});
  }
}

// ── Sidebar ───────────────────────────────────────────────
const sidebarEl=document.getElementById('sidebar-clusters');
DATA.clusters.forEach(c=>{
  const btn=document.createElement('button');
  btn.className='cluster-btn';
  const thumb=c.photos[0]?.thumbnail||'';
  const dates=c.photos.map(p=>p.date).filter(Boolean).sort();
  const dateTxt=dates.length?new Date(dates[0]).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'';
  btn.innerHTML=\`\${thumb?\`<img class="cluster-thumb" src="\${thumb}" />\`:'<div class="cluster-thumb" style="background:#e2e8f0;display:flex;align-items:center;justify-content:center">📍</div>'}
    <div class="cluster-info">
      <div class="cluster-name">\${c.locationName||'Location'}</div>
      <div class="cluster-sub">\${c.photos.length} photo\${c.photos.length!==1?'s':''} · \${dateTxt}</div>
    </div>\`;
  btn.onclick=()=>openCluster(c.id);
  sidebarEl.appendChild(btn);
});

// Unlocated
if(DATA.unlocatedPhotos.length>0){
  document.getElementById('unlocated-section').style.display='';
  const ul=document.getElementById('unlocated-list');
  DATA.unlocatedPhotos.forEach(p=>{
    const d=document.createElement('div');
    d.className='unloc-item';
    d.innerHTML=\`<img src="\${p.thumbnail||p.dataUrl}" /><span class="unloc-name">\${p.name}</span>\`;
    ul.appendChild(d);
  });
}

// ── Photo modal ───────────────────────────────────────────
let currentCluster=null, currentIdx=0;

function openCluster(id){
  currentCluster=DATA.clusters.find(c=>c.id===id);
  if(!currentCluster) return;
  currentIdx=0;
  document.getElementById('modal-loc').textContent=currentCluster.locationName||'Photos';
  const dates=currentCluster.photos.map(p=>p.date).filter(Boolean).sort();
  if(dates.length){
    const fmt=d=>new Date(d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
    document.getElementById('modal-dates').textContent=
      dates.length===1?fmt(dates[0]):\`\${fmt(dates[0])} – \${fmt(dates[dates.length-1])}\`;
  }
  buildThumbs();
  showPhoto(0);
  document.getElementById('photo-modal').classList.add('open');
}

function closeModal(){
  document.getElementById('photo-modal').classList.remove('open');
}

function buildThumbs(){
  const strip=document.getElementById('thumbs-strip');
  strip.innerHTML='';
  currentCluster.photos.forEach((p,i)=>{
    const img=document.createElement('img');
    img.className='thumb'+(i===currentIdx?' active':'');
    img.src=p.thumbnail||p.dataUrl;
    img.onclick=()=>showPhoto(i);
    strip.appendChild(img);
  });
}

function showPhoto(idx){
  currentIdx=idx;
  const p=currentCluster.photos[idx];
  document.getElementById('main-img').src=p.dataUrl;
  const meta=[];
  if(p.date)meta.push(new Date(p.date).toLocaleString());
  if(p.lat!=null)meta.push(\`\${p.lat.toFixed(4)}, \${p.lon.toFixed(4)}\`);
  meta.push(p.name);
  document.getElementById('photo-meta-text').textContent=meta.join(' · ');
  document.getElementById('prev-btn').disabled=idx===0;
  document.getElementById('next-btn').disabled=idx===currentCluster.photos.length-1;
  // Update thumbs
  document.querySelectorAll('#thumbs-strip .thumb').forEach((el,i)=>el.classList.toggle('active',i===idx));
}

function navigate(dir){
  const next=currentIdx+dir;
  if(next>=0&&next<currentCluster.photos.length) showPhoto(next);
}

// Keyboard navigation
document.addEventListener('keydown',e=>{
  if(!document.getElementById('photo-modal').classList.contains('open')) return;
  if(e.key==='ArrowLeft') navigate(-1);
  if(e.key==='ArrowRight') navigate(1);
  if(e.key==='Escape') closeModal();
});
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

/**
 * Trigger a file download in the browser.
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Convert a string to a filename-safe slug.
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'travel-diary';
}

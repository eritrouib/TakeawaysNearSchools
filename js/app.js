(function () {
'use strict';

/* global L */
const Z = window.TNSZones;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const API = 'https://www.planning.data.gov.uk';
const fmt = (n) => Number(n).toLocaleString('en-GB');

const state = {
  council: null, // {entity, name}
  schools: [],
  takeaways: [],
  takeawayFile: null,
  phases: new Set(Object.entries(Z.PHASES).filter(([, p]) => p.default).map(([k]) => k)),
  result: null,
  layers: {},
  site: null,
};

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
const map = L.map('map', { preferCanvas: true }).setView([52.7, -1.7], 6);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, maxNativeZoom: 16, attribution: 'Basemap &copy; Esri',
}).addTo(map);
const renderer = L.canvas({ padding: 0.3 });

function status(text, busy = false, error = false) {
  const el = $('#status');
  el.className = `status${error ? ' error' : ''}`;
  el.innerHTML = `${busy ? '<span class="spinner"></span>' : ''}<span>${esc(text)}</span>`;
}

async function getJson(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function geocode(text) {
  const t = text.trim();
  const pc = t.match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i);
  if (pc) {
    const r = await getJson(`https://api.postcodes.io/postcodes/${encodeURIComponent(`${pc[1]} ${pc[2]}`)}`).catch(() => null);
    if (!r || !r.result) throw new Error('Postcode not found');
    return { lat: r.result.latitude, lon: r.result.longitude, label: `${pc[1].toUpperCase()} ${pc[2].toUpperCase()}` };
  }
  const r = await getJson(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: t, format: 'jsonv2', limit: '1', countrycodes: 'gb' })}`);
  if (!r.length) throw new Error('Place not found');
  return { lat: +r[0].lat, lon: +r[0].lon, label: r[0].display_name };
}

// ---------------------------------------------------------------------------
// Loading a council
// ---------------------------------------------------------------------------
$('#find').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    status('Finding place…', true);
    const p = await geocode($('#place').value);
    status('Finding the council…', true);
    const at = await getJson(`${API}/entity.json?latitude=${p.lat.toFixed(6)}&longitude=${p.lon.toFixed(6)}&dataset=local-authority-district&limit=5`);
    const lad = (at.entities || []).find((x) => x.dataset === 'local-authority-district' || !x.dataset);
    if (!lad) throw new Error('That place doesn\'t seem to be in England.');
    await loadCouncil({ entity: lad.entity, name: lad.name, reference: lad.reference });
  } catch (err) {
    status(err.message || 'Something went wrong.', false, true);
  }
});

async function loadCouncil(council) {
  state.council = council;
  status(`Loading schools in ${council.name}…`, true);
  const schools = [];
  let url = `${API}/entity.json?dataset=educational-establishment&geometry_entity=${council.entity}&geometry_relation=intersects&limit=500&exclude_field=geometry`;
  for (let page = 0; page < 8 && url; page++) {
    const d = await getJson(url);
    const ents = (d.entities || []).filter((x) => !x.dataset || x.dataset === 'educational-establishment');
    schools.push(...ents);
    const next = d.links && d.links.next;
    url = next && ents.length ? (next.startsWith('http') ? next : API + next) : null;
  }
  state.schools = Z.schoolsFrom(schools);

  status('Loading takeaways…', true);
  state.takeaways = [];
  state.takeawayFile = null;
  let note = '';
  try {
    const index = await getJson('data/takeaways/index.json');
    const auth = Z.matchAuthority(council.name, index);
    if (!auth) {
      note = `No Food Standards Agency takeaway file matched "${council.name}".`;
    } else {
      const file = await getJson(`data/takeaways/${encodeURIComponent(auth.code)}.json`);
      state.takeaways = Z.takeawaysFrom(file);
      state.takeawayFile = { ...auth, extract: file.extract, generated: index.generated };
    }
  } catch (e) {
    note = 'Takeaway data hasn\'t been built yet. Run the "Update takeaways" GitHub Action (or python scripts/build_takeaways.py). Schools, zones and site checks still work.';
  }
  $('#dl').disabled = !state.takeawayFile;
  $('#nodata').hidden = !note;
  $('#nodata').textContent = note;
  status('');
  ['settings', 'site-block', 'schools-block'].forEach((id) => { $(`#${id}`).hidden = false; });
  $('#legend').hidden = false;
  $('#council-name').textContent = council.name;
  drawPhases();
  update(true);
}

// ---------------------------------------------------------------------------
// Analysis and drawing
// ---------------------------------------------------------------------------
function drawPhases() {
  const counts = {};
  for (const s of state.schools) counts[s.phase] = (counts[s.phase] || 0) + 1;
  $('#phases').innerHTML = Object.entries(Z.PHASES).filter(([k]) => counts[k]).map(([k, p]) => `
    <label><input type="checkbox" value="${k}" ${state.phases.has(k) ? 'checked' : ''}><span>${esc(p.label)} <span class="n">(${counts[k]})</span></span></label>`).join('')
    || '<span class="small muted">No open schools found.</span>';
  $('#phases').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => {
    if (i.checked) state.phases.add(i.value); else state.phases.delete(i.value);
    update();
  }));
}
$('#metres').addEventListener('change', () => update());

function metres() { return Number($('#metres').value); }

function update(fit = false) {
  const m = metres();
  state.result = Z.analyse(state.schools, state.takeaways, { metres: m, phases: state.phases });
  draw(fit);
  drawStats();
  drawSchools();
  if (state.site) runSite(state.site);
}

function draw(fit) {
  for (const l of Object.values(state.layers)) l.remove();
  const m = metres();
  const included = new Set(state.result.schools.map((s) => s.id));
  state.layers.zones = L.layerGroup(state.schools.filter((s) => included.has(s.id)).map((s) => L.circle([s.lat, s.lon], {
    radius: m, renderer, color: Z.COLORS.school, weight: 1, dashArray: '4 4', fillColor: Z.COLORS.school, fillOpacity: 0.07, interactive: false,
  }))).addTo(map);
  state.layers.takeaways = L.layerGroup(state.result.takeaways.map((t) => L.circleMarker([t.lat, t.lon], {
    renderer, radius: t.inZone ? 5 : 4, color: '#fff', weight: 1, fillColor: t.inZone ? Z.COLORS.inZone : Z.COLORS.outside, fillOpacity: 1,
  }).bindPopup(`<strong>${esc(t.name)}</strong><br>${esc(t.address)} ${esc(t.postcode || '')}`
    + `<br>Food hygiene rating: ${esc(t.rating || '–')}`
    + (t.nearest ? `<br>${Math.round(t.distance)} m from ${esc(t.nearest.name)}${t.inZone ? ' <strong>(in a zone)</strong>' : ''}` : '')))).addTo(map);
  state.layers.schools = L.layerGroup(state.schools.map((s) => L.marker([s.lat, s.lon], {
    icon: L.divIcon({ className: `school-icon${included.has(s.id) ? '' : ' off'}`, html: esc(Z.PHASES[s.phase].letter), iconSize: [18, 18] }),
    title: s.name,
  }).bindPopup(schoolPopup(s)))).addTo(map);
  if (fit) {
    const pts = state.schools.map((s) => [s.lat, s.lon]).concat(state.takeaways.map((t) => [t.lat, t.lon]));
    if (pts.length) map.fitBounds(pts, { padding: [20, 20] });
  }
}

function schoolPopup(s) {
  const r = state.result && state.result.schools.find((x) => x.id === s.id);
  const n = r ? r.takeawaysWithin.length : null;
  return `<strong>${esc(s.name)}</strong><br>${esc(Z.PHASES[s.phase].label)}${s.phase === 'unknown' ? ' (couldn\'t tell from the type or name)' : ''}`
    + `${n != null ? `<br>${n} takeaway${n === 1 ? '' : 's'} within ${metres()} m` : '<br>Not included in the zones'}`
    + `<br><a href="https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/${encodeURIComponent(s.urn)}" target="_blank" rel="noopener">DfE record</a>`;
}

function drawStats() {
  const st = state.result.stats;
  const tf = state.takeawayFile;
  $('#tiles').innerHTML = `
    <div class="tile hl"><div class="num">${tf ? `${fmt(st.inZone)}` : '–'}</div><div class="lbl">takeaways within ${metres()} m of a school${tf && st.takeaways ? ` (${Math.round(st.pctInZone)}% of ${fmt(st.takeaways)})` : ''}</div></div>
    <div class="tile"><div class="num">${tf ? fmt(st.schoolsWithAny) : '–'} / ${fmt(st.schools)}</div><div class="lbl">schools with at least one takeaway nearby</div></div>
    <div class="tile"><div class="num">${tf ? fmt(st.maxNearOneSchool) : '–'}</div><div class="lbl">most takeaways near a single school</div></div>
    <div class="tile"><div class="num">${tf ? esc(tf.extract || '–') : '–'}</div><div class="lbl">food hygiene data date</div></div>`;
}

function drawSchools() {
  const list = state.result.schools.filter((s) => s.takeawaysWithin.length).slice(0, 15);
  $('#schools').innerHTML = list.length ? list.map((s) => `<li><button data-id="${s.id}"><span>${esc(s.name)} <span class="muted small">${esc(Z.PHASES[s.phase].label)}</span></span>
    <span class="c"><strong>${s.takeawaysWithin.length}</strong> · nearest ${Math.round(s.takeawaysWithin[0].d)} m</span></button></li>`).join('')
    : `<li class="muted small">${state.takeawayFile ? `No takeaways within ${metres()} m of the included schools.` : 'Takeaway data not available.'}</li>`;
  $('#schools').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const s = state.schools.find((x) => x.id === Number(b.dataset.id));
    map.setView([s.lat, s.lon], 16);
    L.popup().setLatLng([s.lat, s.lon]).setContent(schoolPopup(s)).openOn(map);
  }));
}

// ---------------------------------------------------------------------------
// Site check
// ---------------------------------------------------------------------------
$('#site').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const p = await geocode($('#site-q').value);
    runSite(p);
    map.setView([p.lat, p.lon], 16);
  } catch (err) {
    $('#site-result').innerHTML = `<div class="note warn">${esc(err.message)}</div>`;
  }
});
map.on('click', (ev) => {
  if (!state.council) return;
  runSite({ lat: ev.latlng.lat, lon: ev.latlng.lng, label: `${ev.latlng.lat.toFixed(5)}, ${ev.latlng.lng.toFixed(5)}` });
});

function runSite(p) {
  state.site = p;
  const m = metres();
  const r = Z.siteCheck(p, state.schools, { metres: m, phases: state.phases });
  if (state.layers.site) state.layers.site.remove();
  state.layers.site = L.layerGroup([
    L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 3, fillColor: r.inZone ? Z.COLORS.inZone : '#1e1d1b', fillOpacity: 1 }),
    ...r.within.map((w) => L.polyline([[p.lat, p.lon], [w.school.lat, w.school.lon]], { color: Z.COLORS.inZone, weight: 2, dashArray: '4 4' })),
  ]).addTo(map);
  $('#site-result').innerHTML = r.inZone
    ? `<div class="verdict in"><strong>Inside a ${m} m school zone</strong>${esc(p.label)}<ul>${r.within.slice(0, 6).map((w) => `<li>${Math.round(w.d)} m from ${esc(w.school.name)} (${esc(Z.PHASES[w.school.phase].label)})</li>`).join('')}</ul></div>`
    : `<div class="verdict out"><strong>Not within ${m} m of an included school</strong>${esc(p.label)}${r.nearest ? `<ul><li>Nearest: ${esc(r.nearest.school.name)}, ${Math.round(r.nearest.d)} m</li></ul>` : ''}</div>`;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
$('#dl').addEventListener('click', () => {
  const rows = Z.csvRows(state.result);
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `takeaways-near-schools-${(state.council && state.council.name || 'council').toLowerCase().replace(/[^a-z]+/g, '-')}-${metres()}m.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
});
})();

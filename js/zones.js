(function () {
'use strict';

// Takeaways Near Schools: core logic (no DOM, no network) so it can be tested.
// Exposes globalThis.TNSZones.

// School phases. Planning Data's school records (from DfE's Get Information
// about Schools) give the establishment type but not the phase, so the phase is
// worked out from the type code and, failing that, the school's name.
// Map colours (validated with the dataviz palette checker: blue/orange pass all
// colour-blind checks). Phase is shown by a letter on each school, not by colour.
const COLORS = { school: '#2a78d6', inZone: '#eb6834', outside: '#9a9a94' };

const PHASES = {
  primary: { label: 'Primary', letter: 'P', default: true },
  secondary: { label: 'Secondary', letter: 'S', default: true },
  'all-through': { label: 'All-through', letter: 'A', default: true },
  special: { label: 'Special / alternative provision', letter: 'X', default: true },
  unknown: { label: 'Phase unclear', letter: '?', default: true },
  nursery: { label: 'Nursery', letter: 'N', default: false },
  'post-16': { label: '16–19 / sixth form', letter: '6', default: false },
};

// DfE "TypeOfEstablishment" codes that settle the phase on their own.
const TYPE_PHASE = {
  15: 'nursery',
  7: 'special', 8: 'special', 10: 'special', 12: 'special', 14: 'special', 33: 'special', 36: 'special',
  38: 'special', 42: 'special', 43: 'special', 44: 'special',
  40: 'secondary', 41: 'secondary', 6: 'secondary',
  31: 'post-16', 32: 'post-16', 39: 'post-16', 45: 'post-16', 46: 'post-16', 57: 'post-16',
};
// Not schools for the purposes of these policies (colleges, universities, overseas, etc.).
const EXCLUDED_TYPES = new Set([18, 24, 25, 26, 27, 29, 30, 37, 56]);

function phaseOf(school) {
  const type = Number(school['educational-establishment-type']);
  if (EXCLUDED_TYPES.has(type)) return null;
  const name = String(school.name || '').toLowerCase();
  if (/\ball[- ]through\b/.test(name)) return 'all-through';
  if (TYPE_PHASE[type]) return TYPE_PHASE[type];
  if (/\b(special|pupil referral|alternative provision|\bpru\b)/.test(name)) return 'special';
  if (/\b(nursery|pre-?school|kindergarten|children'?s centre)\b/.test(name)) return 'nursery';
  if (/\b(infants?|juniors?|primary|first school|lower school|c of e school|ce school|r ?c school|catholic school)\b/.test(name)) return 'primary';
  if (/\b(secondary|high school|grammar|upper school|sixth form|comprehensive|community college|academy trust school|studio school|utc|university technical|girls'? school|boys'? school)\b/.test(name)) return 'secondary';
  if (/\b(college|academy)\b/.test(name)) return 'secondary';
  return 'unknown';
}

/** Open, or open but proposed to close (DfE status 1 or 3), and not end-dated. */
function isOpen(school, today = new Date().toISOString().slice(0, 10)) {
  if (school['end-date'] && school['end-date'] <= today) return false;
  const st = String(school['educational-establishment-status'] || '1');
  return st === '1' || st === '3';
}

function parsePoint(wkt) {
  const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(String(wkt || ''));
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

/** Straight-line distance in metres. */
function distance(a, b) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Turn Planning Data school entities into {id, name, lat, lon, phase, url}. */
function schoolsFrom(entities, today) {
  const out = [];
  const seen = new Set();
  for (const e of entities) {
    if (seen.has(e.entity) || !isOpen(e, today)) continue;
    const p = parsePoint(e.point);
    const phase = phaseOf(e);
    if (!p || !phase) continue;
    seen.add(e.entity);
    out.push({ id: e.entity, urn: e.reference, name: e.name, lat: p.lat, lon: p.lon, phase, website: e['website-url'] || null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Rows from a data/takeaways/<code>.json file into objects. */
function takeawaysFrom(file) {
  const f = file.fields;
  return (file.rows || []).map((r) => Object.fromEntries(f.map((k, i) => [k, r[i]])))
    .map((t) => ({ ...t, lat: Number(t.lat), lon: Number(t.lon) }));
}

/**
 * Takeaways within `metres` of any included school.
 * Returns {takeaways: [...with nearest, distance, inZone, schoolsWithin], schools: [...with takeawaysWithin], stats}.
 */
function analyse(schools, takeaways, { metres = 400, phases } = {}) {
  const included = schools.filter((s) => !phases || phases.has(s.phase));
  // Cheap pre-filter: ~1 degree latitude = 111 km.
  const dLat = metres / 111000;
  const perSchool = new Map(included.map((s) => [s.id, []]));
  const out = takeaways.map((t) => {
    let nearest = null, best = Infinity;
    const within = [];
    for (const s of included) {
      if (Math.abs(s.lat - t.lat) > dLat * 6) continue;
      const d = distance(s, t);
      if (d < best) { best = d; nearest = s; }
      if (d <= metres) { within.push(s); perSchool.get(s.id).push({ t, d }); }
    }
    return { ...t, nearest, distance: nearest ? best : null, inZone: within.length > 0, schoolsWithin: within.length };
  });
  const schoolsOut = included.map((s) => ({ ...s, takeawaysWithin: perSchool.get(s.id).sort((a, b) => a.d - b.d) }))
    .sort((a, b) => b.takeawaysWithin.length - a.takeawaysWithin.length || a.name.localeCompare(b.name));
  const inZone = out.filter((t) => t.inZone).length;
  return {
    takeaways: out,
    schools: schoolsOut,
    stats: {
      takeaways: out.length,
      inZone,
      pctInZone: out.length ? (100 * inZone) / out.length : null,
      schools: included.length,
      schoolsWithAny: schoolsOut.filter((s) => s.takeawaysWithin.length).length,
      maxNearOneSchool: schoolsOut.length ? schoolsOut[0].takeawaysWithin.length : 0,
    },
  };
}

/** Is a site within `metres` of an included school? Lists those schools, nearest first. */
function siteCheck(site, schools, { metres = 400, phases } = {}) {
  const list = schools.filter((s) => !phases || phases.has(s.phase))
    .map((s) => ({ school: s, d: distance(site, s) }))
    .sort((a, b) => a.d - b.d);
  return { inZone: list.length > 0 && list[0].d <= metres, within: list.filter((x) => x.d <= metres), nearest: list[0] || null };
}

/** Match a Planning Data local authority name to an FSA authority in the index. */
function normaliseName(s) {
  return String(s || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(city of|county of|royal borough of|london borough of|borough of|metropolitan borough|district|council|corporation)\b/g, ' ')
    .replace(/,.*$/, (m) => (m.includes('city') || m.includes('county') ? '' : m))
    .replace(/[^a-z]+/g, ' ')
    .replace(/\b(the)\b/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

const NAME_FIXES = { 'bristol': 'bristol', 'herefordshire': 'herefordshire', 'kingston upon hull': 'hull', 'hull': 'hull', 'st helens': 'st helens', 'st albans': 'st albans' };

function matchAuthority(ladName, index) {
  const want = normaliseName(ladName);
  const key = NAME_FIXES[want] || want;
  const auths = (index && index.authorities) || [];
  const norm = auths.map((a) => ({ a, n: NAME_FIXES[normaliseName(a.name)] || normaliseName(a.name) }));
  return (norm.find((x) => x.n === key) || norm.find((x) => x.n.startsWith(key) || key.startsWith(x.n)) || {}).a || null;
}

const CSV_FIELDS = ['name', 'address', 'postcode', 'rating', 'lat', 'lon', 'in_zone', 'nearest_school', 'nearest_school_phase', 'distance_m', 'schools_within'];
function csvRows(result) {
  return [CSV_FIELDS, ...result.takeaways.map((t) => [
    t.name, t.address, t.postcode, t.rating, t.lat, t.lon, t.inZone ? 'Y' : 'N',
    t.nearest ? t.nearest.name : '', t.nearest ? PHASES[t.nearest.phase].label : '',
    t.distance == null ? '' : Math.round(t.distance), t.schoolsWithin,
  ])];
}

globalThis.TNSZones = {
  COLORS, PHASES, phaseOf, isOpen, parsePoint, distance, schoolsFrom, takeawaysFrom, analyse, siteCheck,
  normaliseName, matchAuthority, csvRows,
};
})();

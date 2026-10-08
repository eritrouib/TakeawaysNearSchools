import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/zones.js';

const Z = globalThis.TNSZones;

test('phase from type code and name', () => {
  const p = (name, type = 1) => Z.phaseOf({ name, 'educational-establishment-type': type });
  assert.equal(p('Surbiton Hill Nursery School', 15), 'nursery');
  assert.equal(p('Latchmere School'), 'unknown');
  assert.equal(p('King Athelstan Primary School'), 'primary');
  assert.equal(p('St Agatha\'s Catholic Primary School', 2), 'primary');
  assert.equal(p('Coombe Girls\' School', 28), 'secondary');
  assert.equal(p('Tiffin School'), 'unknown');
  assert.equal(p('Southborough High School'), 'secondary');
  assert.equal(p('Kingston Academy', 35), 'secondary');
  assert.equal(p('Dysart School', 7), 'special');
  assert.equal(p('Kingston College', 18), null, 'FE college excluded');
  assert.equal(p('Kingston University', 29), null);
  assert.equal(p('Richmond upon Thames College', 31), 'post-16');
  assert.equal(p('Riverside All-through School'), 'all-through');
});

test('open schools only, with a location', () => {
  const s = Z.schoolsFrom([
    { entity: 1, name: 'Open Primary School', point: 'POINT (-0.3 51.4)', 'educational-establishment-status': '1' },
    { entity: 2, name: 'Closed Primary School', point: 'POINT (-0.3 51.4)', 'educational-establishment-status': '2' },
    { entity: 3, name: 'Old Primary School', point: 'POINT (-0.3 51.4)', 'end-date': '1999-01-01' },
    { entity: 4, name: 'No Point Primary School' },
    { entity: 5, name: 'Kingston University', point: 'POINT (-0.3 51.4)', 'educational-establishment-type': 29 },
    { entity: 1, name: 'Open Primary School', point: 'POINT (-0.3 51.4)' },
  ], '2026-10-08');
  assert.deepEqual(s.map((x) => x.id), [1]);
  assert.equal(s[0].phase, 'primary');
});

test('distance is about right', () => {
  const d = Z.distance({ lat: 51.4, lon: -0.3 }, { lat: 51.4036, lon: -0.3 });
  assert.ok(Math.abs(d - 400) < 2, String(d));
});

test('analyse counts takeaways near included schools', () => {
  const schools = [
    { id: 1, name: 'A Primary', lat: 51.4, lon: -0.3, phase: 'primary' },
    { id: 2, name: 'B High School', lat: 51.42, lon: -0.3, phase: 'secondary' },
    { id: 3, name: 'C Nursery', lat: 51.44, lon: -0.3, phase: 'nursery' },
  ];
  const takeaways = [
    { name: 'Near A', lat: 51.4027, lon: -0.3 }, // ~300 m from A
    { name: 'Near B', lat: 51.4209, lon: -0.3 }, // ~100 m from B
    { name: 'Far', lat: 51.43, lon: -0.3 }, // ~1.1 km from B, ~1.1 km from C
    { name: 'Near C', lat: 51.4401, lon: -0.3 },
  ];
  const all = Z.analyse(schools, takeaways, { metres: 400, phases: new Set(['primary', 'secondary']) });
  assert.deepEqual(all.takeaways.map((t) => t.inZone), [true, true, false, false], 'nursery not included');
  assert.equal(all.stats.inZone, 2);
  assert.equal(all.stats.pctInZone, 50);
  assert.equal(all.stats.schoolsWithAny, 2);
  const sec = Z.analyse(schools, takeaways, { metres: 400, phases: new Set(['secondary']) });
  assert.equal(sec.stats.inZone, 1);
  assert.equal(sec.takeaways[0].nearest.name, 'B High School');
  const wide = Z.analyse(schools, takeaways, { metres: 250, phases: new Set(['primary', 'secondary']) });
  assert.equal(wide.stats.inZone, 1, 'smaller zone');
  const rows = Z.csvRows(all);
  assert.equal(rows[0][6], 'in_zone');
  assert.equal(rows[1][6], 'Y');
});

test('site check', () => {
  const schools = [{ id: 1, name: 'A Primary', lat: 51.4, lon: -0.3, phase: 'primary' }];
  const r = Z.siteCheck({ lat: 51.4018, lon: -0.3 }, schools, { metres: 400 });
  assert.equal(r.inZone, true);
  assert.ok(Math.abs(r.nearest.d - 200) < 2);
  assert.equal(Z.siteCheck({ lat: 51.41, lon: -0.3 }, schools, { metres: 400 }).inZone, false);
});

test('matching council names between Planning Data and the FSA', () => {
  const index = { authorities: [
    { code: '521', name: 'Kingston-Upon-Thames' }, { code: '508', name: 'City of London Corporation' },
    { code: '853', name: 'Bristol' }, { code: '508b', name: 'Barking and Dagenham' }, { code: '100', name: 'Newcastle-Upon-Tyne' },
  ] };
  assert.equal(Z.matchAuthority('Kingston upon Thames', index).code, '521');
  assert.equal(Z.matchAuthority('City of London', index).code, '508');
  assert.equal(Z.matchAuthority('Bristol, City of', index).code, '853');
  assert.equal(Z.matchAuthority('Barking & Dagenham', index).code, '508b');
  assert.equal(Z.matchAuthority('Newcastle upon Tyne', index).code, '100');
  assert.equal(Z.matchAuthority('Nowhere', index), null);
});

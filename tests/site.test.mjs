import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, expiryOf, listReports, prune, renderIndex, build } from '../scripts/site.mjs';

function makeDocs(reports) {
  const docs = mkdtempSync(join(tmpdir(), 'site-'));
  mkdirSync(join(docs, 'reports'), { recursive: true });
  for (const [slug, meta] of Object.entries(reports)) {
    const dir = join(docs, 'reports', slug);
    mkdirSync(dir);
    writeFileSync(join(dir, 'index.html'), `<html>${slug}</html>`);
    if (meta !== null) writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  }
  return docs;
}

test('addDays handles month and year boundaries', () => {
  assert.equal(addDays('2026-11-29', 7), '2026-12-06');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('expiryOf prefers an explicit expires, then endDate + retention, then startDate, then created + 30', () => {
  assert.equal(expiryOf({ expires: '2026-12-25', endDate: '2026-11-29' }, 7), '2026-12-25');
  assert.equal(expiryOf({ endDate: '2026-11-29' }, 7), '2026-12-06');
  assert.equal(expiryOf({ startDate: '2026-11-27' }, 7), '2026-12-04');
  assert.equal(expiryOf({ created: '2026-11-25' }, 7), '2026-12-25');
});

test('expiryOf throws when a report has no usable date', () => {
  assert.throws(() => expiryOf({ title: 'x' }, 7), /date/i);
});

test('listReports separates valid reports from folders without usable meta', () => {
  const docs = makeDocs({
    ok: { title: 'OK', slug: 'ok', endDate: '2026-11-29' },
    nometa: null,
    nodate: { title: 'No date' },
  });
  const { reports, invalid } = listReports(join(docs, 'reports'));
  assert.deepEqual(reports.map((r) => r.slug), ['ok']);
  assert.deepEqual(invalid.sort(), ['nodate', 'nometa']);
});

test('prune removes only reports whose expiry is strictly before today', () => {
  const docs = makeDocs({
    old: { title: 'Old', endDate: '2026-11-01' },
    edge: { title: 'Edge', endDate: '2026-11-18' },
    fresh: { title: 'Fresh', endDate: '2026-11-29' },
  });
  const res = prune({ reportsDir: join(docs, 'reports'), today: '2026-11-25', retentionDays: 7 });
  assert.deepEqual(res.removed, ['old']);
  assert.deepEqual(res.kept.sort(), ['edge', 'fresh']);
  assert.equal(existsSync(join(docs, 'reports', 'old')), false);
  assert.equal(existsSync(join(docs, 'reports', 'edge')), true);
  const res2 = prune({ reportsDir: join(docs, 'reports'), today: '2026-11-26', retentionDays: 7 });
  assert.deepEqual(res2.removed, ['edge'], 'edge expires the day after its expiry date');
});

test('prune never deletes folders it cannot read dates from', () => {
  const docs = makeDocs({ nometa: null, nodate: { title: 'x' } });
  const res = prune({ reportsDir: join(docs, 'reports'), today: '2099-01-01', retentionDays: 7 });
  assert.deepEqual(res.removed, []);
  assert.deepEqual(res.invalid.sort(), ['nodate', 'nometa']);
  assert.equal(existsSync(join(docs, 'reports', 'nometa')), true);
});

test('prune ignores slugs that are not plain folder names', () => {
  const docs = makeDocs({ ok: { title: 'OK', endDate: '2020-01-01' } });
  writeFileSync(join(docs, 'reports', 'stray.txt'), 'hello');
  const res = prune({ reportsDir: join(docs, 'reports'), today: '2026-11-25', retentionDays: 7 });
  assert.deepEqual(res.removed, ['ok']);
  assert.equal(existsSync(join(docs, 'reports', 'stray.txt')), true);
});

test('renderIndex lists reports soonest first, links them, escapes titles, shows expiry', () => {
  const reports = [
    { slug: 'later', meta: { title: 'Later <trip>', startDate: '2027-02-01', endDate: '2027-02-03' } },
    { slug: 'soon', meta: { title: 'Soon', subtitle: 'Sub', startDate: '2026-11-27', endDate: '2026-11-29' } },
  ];
  const html = renderIndex(reports, { retentionDays: 7 });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('href="reports/soon/"'));
  assert.ok(html.includes('Later &lt;trip&gt;'));
  assert.ok(!html.includes('Later <trip>'));
  assert.ok(html.indexOf('reports/soon/') < html.indexOf('reports/later/'));
  assert.ok(html.includes('2026-12-06'), 'expiry date shown');
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('noindex'));
});

test('renderIndex has a friendly empty state', () => {
  assert.ok(renderIndex([], { retentionDays: 7 }).includes('No reports'));
});

test('build prunes, writes index.html and .nojekyll, and reports what it did', () => {
  const docs = makeDocs({
    old: { title: 'Old', endDate: '2026-10-01' },
    fresh: { title: 'Fresh trip', startDate: '2026-11-27', endDate: '2026-11-29' },
  });
  const summary = build({ docsDir: docs, today: '2026-11-25', retentionDays: 7 });
  assert.deepEqual(summary.removed, ['old']);
  assert.deepEqual(summary.kept, ['fresh']);
  const index = readFileSync(join(docs, 'index.html'), 'utf8');
  assert.ok(index.includes('Fresh trip'));
  assert.ok(!index.includes('>Old<'));
  assert.equal(existsSync(join(docs, '.nojekyll')), true);
});

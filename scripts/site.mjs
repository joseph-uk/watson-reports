import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_RETENTION_DAYS = 7;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The last day a report stays online. An explicit `expires` wins; otherwise the
 * trip's last day plus the retention window; otherwise 30 days after creation.
 */
export function expiryOf(meta, retentionDays = DEFAULT_RETENTION_DAYS) {
  if (ISO_DATE.test(meta?.expires ?? '')) return meta.expires;
  const end = [meta?.endDate, meta?.startDate].find((d) => ISO_DATE.test(d ?? ''));
  if (end) return addDays(end, retentionDays);
  if (ISO_DATE.test(meta?.created ?? '')) return addDays(meta.created, 30);
  throw new Error('report meta has no usable date (expires, endDate, startDate or created)');
}

/** Valid reports plus the names of folders whose meta.json is missing, malformed or undated. */
export function listReports(reportsDir) {
  const reports = [];
  const invalid = [];
  if (!existsSync(reportsDir)) return { reports, invalid };
  for (const entry of readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(reportsDir, entry.name, 'meta.json');
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      expiryOf(meta);
      reports.push({ slug: entry.name, meta });
    } catch {
      invalid.push(entry.name);
    }
  }
  return { reports, invalid };
}

/** Delete report folders whose expiry is strictly before `today`. Unreadable folders are kept and reported. */
export function prune({ reportsDir, today, retentionDays = DEFAULT_RETENTION_DAYS }) {
  const { reports, invalid } = listReports(reportsDir);
  const removed = [];
  const kept = [];
  for (const { slug, meta } of reports) {
    if (today > expiryOf(meta, retentionDays)) {
      rmSync(join(reportsDir, slug), { recursive: true, force: true });
      removed.push(slug);
    } else {
      kept.push(slug);
    }
  }
  return { removed, kept, invalid };
}

const sortKey = (m) => m.startDate ?? m.endDate ?? m.created ?? '';

const CSS = `
:root{color-scheme:light dark;--bg:#f7f5f0;--ink:#1c1b19;--mut:#5c5a55;--card:#fff;--tint:#efece4;--line:#ddd8cc;--acc:#0b6b4d;--head:#0b6b4d;--onhead:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#111312;--ink:#ebebe8;--mut:#a3a8a5;--card:#1a1d1c;--tint:#232726;--line:#2f3433;--acc:#45be90;--head:#173229;--onhead:#ececec}}
*{box-sizing:border-box}
body{margin:0;font:1rem/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink);overflow-wrap:anywhere}
::selection{background:var(--tint)}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
header{background:var(--head);color:var(--onhead);padding:1.5rem max(1rem,calc((100% - 720px)/2 + 1rem)) 1rem}
header h1{margin:0;font-size:1.625rem;line-height:1.2;letter-spacing:-.015em;text-wrap:balance}
header p{margin:.5rem 0 0;font-size:.9375rem;opacity:.88;max-width:56ch;text-wrap:pretty}
main{max-width:720px;margin:0 auto;padding:1.5rem 1rem 3rem}
a.report{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem;margin:0 0 .75rem;text-decoration:none;color:var(--ink);min-height:44px}
a.report:hover{background:var(--tint)}
a.report b{display:block;font-size:1.125rem;line-height:1.3}
a.report span{display:block;margin-top:.25rem;color:var(--mut);font-size:.9375rem}
.empty{color:var(--mut)}
footer{max-width:720px;margin:0 auto;padding:0 1rem 2rem;color:var(--mut);font-size:.8125rem}
`;

export function renderIndex(reports, { retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  const sorted = [...reports].sort((a, b) => sortKey(a.meta).localeCompare(sortKey(b.meta)));
  const items = sorted.map(({ slug, meta }) => {
    const dates = meta.startDate && meta.endDate && meta.startDate !== meta.endDate
      ? `${meta.startDate} to ${meta.endDate}` : (meta.startDate ?? meta.endDate ?? meta.created ?? '');
    return `<a class="report" href="reports/${escapeHtml(slug)}/"><b>${escapeHtml(meta.title ?? slug)}</b>
${meta.subtitle ? `<span>${escapeHtml(meta.subtitle)}</span>` : ''}<span>${escapeHtml(dates)} · online until ${escapeHtml(expiryOf(meta, retentionDays))}</span></a>`;
  });
  const body = items.length ? items.join('\n') : '<p class="empty">No reports are online right now.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b6b4d"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow">
<title>Watson reports</title><style>${CSS}</style></head>
<body><header><h1>Watson reports</h1><p>City-break and events cheat sheets. Old reports are removed automatically.</p></header>
<main>
${body}
</main><footer>Reports are deleted a few days after the trip or event they cover.</footer></body></html>
`;
}

/** Prune expired reports, then regenerate docs/index.html. */
export function build({ docsDir, today, retentionDays = DEFAULT_RETENTION_DAYS }) {
  const reportsDir = join(docsDir, 'reports');
  const { removed, kept, invalid } = prune({ reportsDir, today, retentionDays });
  const { reports } = listReports(reportsDir);
  writeFileSync(join(docsDir, 'index.html'), renderIndex(reports, { retentionDays }));
  writeFileSync(join(docsDir, '.nojekyll'), '');
  return { removed, kept, invalid };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i > -1 ? args[i + 1] : fallback;
  };
  if (args[0] !== 'build') {
    process.stderr.write('usage: node scripts/site.mjs build [--today YYYY-MM-DD] [--retention DAYS] [--docs DIR]\n');
    process.exit(2);
  }
  const today = flag('--today', new Date().toISOString().slice(0, 10));
  const retentionDays = Number(flag('--retention', process.env.RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS));
  if (!ISO_DATE.test(today) || !Number.isInteger(retentionDays) || retentionDays < 0) {
    process.stderr.write('invalid --today or --retention\n');
    process.exit(2);
  }
  const summary = build({ docsDir: flag('--docs', 'docs'), today, retentionDays });
  process.stdout.write(`${JSON.stringify({ today, retentionDays, ...summary })}\n`);
}

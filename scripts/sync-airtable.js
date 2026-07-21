// scripts/sync-airtable.js — Airtable → Vault JSON sync
// Usage: npm run sync-airtable
// Re-runnable. Writes raw JSON per table to data/raw/, then transforms to data/vault-records.json.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Load .env (silently skip if absent — env vars may be set externally)
try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
} catch { /* no .env file */ }

const TOKEN = process.env.AIRTABLE_TOKEN;
if (!TOKEN || TOKEN === 'your_pat_here') {
  console.error('\nERROR: AIRTABLE_TOKEN not set.');
  console.error('Create .env with: AIRTABLE_TOKEN=pat_xxx\n');
  process.exit(1);
}

const BASE = 'appNy6YdAD3eh4R0C';
const RATE_MS = 250; // 4 req/sec — stays under Airtable's 5/sec limit

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchTable(tableId, label) {
  const records = [];
  let offset;
  let page = 0;
  do {
    page++;
    const url = offset
      ? `https://api.airtable.com/v0/${BASE}/${tableId}?offset=${encodeURIComponent(offset)}`
      : `https://api.airtable.com/v0/${BASE}/${tableId}`;
    process.stdout.write(`\r  ${label}: page ${page} (${records.length} so far)...   `);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const json = await res.json();
    records.push(...json.records);
    offset = json.offset;
    if (offset) await sleep(RATE_MS);
  } while (offset);
  process.stdout.write(`\r  ${label}: ${records.length} records\n`);
  return records;
}

// ── Status helpers ──────────────────────────────────────────────────────────

function ledgerStatus(v) {
  if (!v) return { status: 'unchecked', statusLabel: 'Not yet assessed' };
  if (v.startsWith('Resolved')) return { status: 'verified', statusLabel: v };
  if (v === 'No ID Possible (generic entry)') return { status: 'unverified', statusLabel: 'No ID possible (generic entry)' };
  return { status: 'unchecked', statusLabel: v }; // Unresolved – Attempted / Not Yet Attempted
}

function uvrsStatus(v) {
  if (!v) return { status: 'unchecked', statusLabel: 'Not yet assessed' };
  if (v === 'High') return { status: 'verified', statusLabel: 'High confidence' };
  if (v === 'Low') return { status: 'unverified', statusLabel: 'Low confidence' };
  return { status: 'unchecked', statusLabel: v }; // Medium, Inferred/CS-derived
}

function unitStatus(v) {
  if (!v || v === 'Not yet assessed') return { status: 'unchecked', statusLabel: 'Not yet assessed' };
  if (v === 'Confident') return { status: 'verified', statusLabel: 'Confident' };
  if (v === 'No source available') return { status: 'unverified', statusLabel: 'No source available' };
  return { status: 'unchecked', statusLabel: v };
}

function personStatus(v) {
  if (!v) return { status: 'unchecked', statusLabel: 'Not yet assessed' };
  if (v === 'Fully identified') return { status: 'verified', statusLabel: 'Fully identified' };
  return { status: 'unchecked', statusLabel: v };
}

// ── Field normalizers ───────────────────────────────────────────────────────

// Authoritative Unit Type values from schema; anything not listed → 'Other'
const BRANCH_NORM = {
  'Infantry': 'Infantry',
  'Cavalry': 'Cavalry',
  'Artillery': 'Artillery',
  'Heavy Artillery': 'Artillery',        // bucketed into Artillery
  'Colored Troops (USCT)': 'Other',
  'Engineers': 'Other',
  'Other': 'Other',
};

const SALOON_NORM = {
  'Cooper Shop': 'Cooper',
  'Union Volunteer Refreshment Saloon': 'Union',
  'Both / Unclear': 'Both',
  'Related Institution': 'Related Institution',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${MONTHS[+m - 1]} ${+d}, ${y}`;
}

// Extract leading ordinal regiment number: "69th NY" → 69, "2d NJ" → 2
function extractRegNum(title) {
  if (!title) return undefined;
  const m = title.match(/^(\d+)(st|nd|rd|th|d)\b/i);
  return m ? +m[1] : undefined;
}

// ── Transform functions ─────────────────────────────────────────────────────

function transformLedger(rec) {
  const f = rec.fields;
  const title = (f['Original Unit Name'] || f['Standardized Unit Name'] || '').trim() || '(untitled entry)';

  const metaParts = [];
  if (f['Commanding Officer']) metaParts.push(f['Commanding Officer']);
  if (f['Date']) metaParts.push(fmtDate(f['Date']));
  const count = f['Men Fed'] ?? f['Total Strength'];
  if (count != null) metaParts.push(`${count} men`);
  if (f['Direction']) metaParts.push(f['Direction']);

  const { status, statusLabel } = ledgerStatus(f['Resolution Status']);

  const out = {
    id: rec.id,
    type: 'Ledger Entry',
    saloon: 'Cooper',
    title,
    meta: metaParts.join(' · '),
    status,
    statusLabel,
    source: 'Cooper Shop Ledger',
  };
  if (f['Date']) out.date = f['Date'];
  if (f['Notes']) out.note = f['Notes'];
  const unitLinks = f['Unit'];
  if (unitLinks && unitLinks.length) out.links = unitLinks;
  return out;
}

function transformUVRS(rec) {
  const f = rec.fields;
  const regiment = (f['Regiment'] || '').trim();
  const date = f['Date'];
  const pageId = f['Page ID'];

  const title = regiment
    || (date ? `UVRS Diary — ${fmtDate(date)}` : `UVRS Diary — ${pageId || rec.id}`);

  const metaParts = [];
  if (f['Commander']) metaParts.push(f['Commander']);
  if (f['Men Count'] != null) metaParts.push(`${f['Men Count']} men`);
  if (date) metaParts.push(fmtDate(date));
  if (pageId) metaParts.push(pageId);

  const { status, statusLabel } = uvrsStatus(f['Transcription Confidence']);

  const out = {
    id: rec.id,
    type: 'Ledger Entry',
    saloon: 'Union',
    title,
    meta: metaParts.join(' · '),
    status,
    statusLabel,
    source: pageId ? `UVRS Diary, ${pageId}` : 'UVRS Diary',
  };
  if (date) out.date = date;
  if (f['Remarks']) out.note = f['Remarks'];
  const unitLinks = f['Unit'];
  if (unitLinks && unitLinks.length) out.links = unitLinks;
  return out;
}

function transformUnit(rec, saloonMap) {
  const f = rec.fields;
  const title = (f['Standardized Unit Name'] || '').trim() || '(unknown unit)';

  const { status, statusLabel } = unitStatus(f['Unit Bio Source Status']);
  const branch = f['Unit Type'] ? (BRANCH_NORM[f['Unit Type']] ?? 'Other') : undefined;
  const rn = extractRegNum(title);
  const saloon = saloonMap[rec.id];

  const metaParts = [];
  if (f['State']) metaParts.push(f['State']);
  if (f['Unit Type']) metaParts.push(f['Unit Type']);

  const out = {
    id: rec.id,
    type: 'Unit',
    title,
    meta: metaParts.join(', '),
    status,
    statusLabel,
  };
  if (saloon) out.saloon = saloon;
  if (f['State']) out.state = f['State'];
  if (branch) out.branch = branch;
  if (rn !== undefined) out.regNum = rn;
  if (f['Notes']) out.note = f['Notes'];

  // Only include bio URL if it's an actual URL, not the placeholder text
  const bioUrl = f['Unit Bio Source URL'];
  if (bioUrl && bioUrl.startsWith('http')) out.source = bioUrl;

  // Cross-links: cooper + uvrs ledger entries
  const cooperLinks = f['Cooper Shop Ledger'] || [];
  const uvrsLinks = f['UVRS Diary Entries'] || [];
  const allLinks = [...cooperLinks, ...uvrsLinks];
  if (allLinks.length) out.links = allLinks;

  return out;
}

function transformLeadership(rec) {
  const f = rec.fields;
  const title = (f['Best Full Name'] || f['Name (as recorded)'] || '').trim() || '(unnamed)';
  const { status, statusLabel } = personStatus(f['Status']);
  const saloon = SALOON_NORM[f['Saloon']];

  const out = {
    id: rec.id,
    type: 'Person',
    title,
    meta: (f['Role/Title'] || '').trim(),
    status,
    statusLabel,
    links: [],
  };
  if (saloon) out.saloon = saloon;
  if (f['Sources']) out.source = f['Sources'];
  if (f['Notes']) out.note = f['Notes'];
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n── Airtable → Vault sync ──\n');
  mkdirSync(join(root, 'data/raw'), { recursive: true });

  const ledger     = await fetchTable('tbl3GLsizc0TiQvuN', 'Cooper Shop Ledger');
  const units      = await fetchTable('tblhxtIMaCgWCGHMz', 'Units');
  const uvrs       = await fetchTable('tblOa5rUbgpKkJ8cC', 'UVRS Diary Entries');
  const leadership = await fetchTable('tblFIIbDo4eyFUiK8', 'Saloon Leadership');

  // Raw files — portable research dataset
  const rawDir = join(root, 'data/raw');
  writeFileSync(join(rawDir, 'cooper-shop-ledger.json'),  JSON.stringify(ledger,      null, 2), 'utf8');
  writeFileSync(join(rawDir, 'units.json'),               JSON.stringify(units,       null, 2), 'utf8');
  writeFileSync(join(rawDir, 'uvrs-diary-entries.json'),  JSON.stringify(uvrs,        null, 2), 'utf8');
  writeFileSync(join(rawDir, 'saloon-leadership.json'),   JSON.stringify(leadership,  null, 2), 'utf8');

  console.log('\nRaw files written:');
  console.log(`  data/raw/cooper-shop-ledger.json   ${ledger.length} records`);
  console.log(`  data/raw/units.json                ${units.length} records`);
  console.log(`  data/raw/uvrs-diary-entries.json   ${uvrs.length} records`);
  console.log(`  data/raw/saloon-leadership.json    ${leadership.length} records`);

  // Compute saloon affiliation for units from reverse-link fields (option b)
  const saloonMap = {};
  for (const u of units) {
    const hasCooper = (u.fields['Cooper Shop Ledger']  || []).length > 0;
    const hasUnion  = (u.fields['UVRS Diary Entries']  || []).length > 0;
    if (hasCooper && hasUnion) saloonMap[u.id] = 'Both';
    else if (hasCooper)        saloonMap[u.id] = 'Cooper';
    else if (hasUnion)         saloonMap[u.id] = 'Union';
    // else: unit not yet linked to either saloon — saloon tag omitted
  }

  // Collect any Unit Type values not in BRANCH_NORM (for reporting)
  const unknownBranches = new Set();
  for (const u of units) {
    const v = u.fields['Unit Type'];
    if (v && !(v in BRANCH_NORM)) unknownBranches.add(v);
  }

  // Transform to vault schema
  const vaultRecords = [
    ...ledger.map(transformLedger),
    ...uvrs.map(transformUVRS),
    ...units.map(r => transformUnit(r, saloonMap)),
    ...leadership.map(transformLeadership),
  ];

  writeFileSync(join(root, 'data/vault-records.json'), JSON.stringify(vaultRecords, null, 2), 'utf8');

  // ── Summary ──
  const cooperOnly = Object.values(saloonMap).filter(v => v === 'Cooper').length;
  const unionOnly  = Object.values(saloonMap).filter(v => v === 'Union').length;
  const both       = Object.values(saloonMap).filter(v => v === 'Both').length;
  const unlinked   = units.length - cooperOnly - unionOnly - both;

  // Branch normalization summary
  const branchStats = {};
  for (const u of units) {
    const v = u.fields['Unit Type'] || '(blank)';
    branchStats[v] = (branchStats[v] || 0) + 1;
  }

  console.log('\n── Summary ──');
  console.log(`  Cooper Shop Ledger:  ${ledger.length}`);
  console.log(`  UVRS Diary Entries:  ${uvrs.length}`);
  console.log(`  Units:               ${units.length}`);
  console.log(`  Saloon Leadership:   ${leadership.length}`);
  console.log(`  Total vault records: ${vaultRecords.length}`);
  console.log('\n  Unit saloon affiliation (computed from linked records):');
  console.log(`    Cooper only: ${cooperOnly}`);
  console.log(`    Union only:  ${unionOnly}`);
  console.log(`    Both:        ${both}`);
  console.log(`    Unlinked:    ${unlinked}`);
  console.log('\n  Unit Type → branch mapping:');
  for (const [k, n] of Object.entries(branchStats).sort((a, b) => b[1] - a[1])) {
    const mapped = k === '(blank)' ? '(omitted)' : (BRANCH_NORM[k] ?? 'Other *unexpected*');
    console.log(`    ${k}: ${n} → ${mapped}`);
  }
  if (unknownBranches.size) {
    console.log(`\n  WARNING: unexpected Unit Type values bucketed to Other: ${[...unknownBranches].join(', ')}`);
  }

  console.log('\n  data/vault-records.json written\n✓ Done\n');
}

main().catch(err => {
  console.error('\nSync failed:', err.message);
  process.exit(1);
});

// Paste-to-chart: turn a copied spreadsheet range into a hand-drawn chart made
// of native board elements (rectangles, lines, freedraw slices, text labels).
// Every member carries `chartId`, `groupId` and a `chart` spec so the whole
// chart can be re-generated in place from the chart editor.

export const CHART_SERIES_COLORS = ['#a5d8ff', '#b2f2bb', '#ffec99', '#ffc9c9', '#d0bfff', '#ffd8a8'];

const numericValue = (raw) => {
  const cleaned = String(raw ?? '').replace(/[$,%\s]/g, '');
  if (cleaned === '' || Number.isNaN(Number(cleaned))) return null;
  return Number(cleaned);
};

// Parse clipboard text into { headers, categories, series }. Accepts TSV (what
// Excel and Google Sheets put on the clipboard) and plain CSV. The first
// column becomes category labels; every column whose body cells are all
// numeric (or empty) becomes a series. Returns null when the text is not a
// usable table.
export function parseTableText(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/);
  // Tabs first (clipboard format), then European-style semicolon CSVs,
  // then plain comma CSVs.
  const delim = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',');
  const rows = lines.map((line) => line.split(delim));
  if (rows.length < 2) return null;
  const width = Math.max(...rows.map((row) => row.length));
  if (width < 2) return null;
  const grid = rows.map((row) => Array.from({ length: width }, (_, i) => String(row[i] ?? '').trim()));

  const trailing = grid[0].slice(1);
  const hasHeader = trailing.some((cell) => /[a-zäöü]/i.test(cell));
  const headers = hasHeader ? grid[0] : grid[0].map((_, i) => (i === 0 ? '' : `Series ${i}`));
  const body = hasHeader ? grid.slice(1) : grid;
  if (!body.length) return null;

  const numericCols = [];
  for (let c = 1; c < width; c += 1) {
    const cells = body.map((row) => row[c]).filter((cell) => cell !== '');
    if (cells.length && cells.every((cell) => numericValue(cell) !== null)) numericCols.push(c);
  }
  if (!numericCols.length) return null;

  return {
    headers,
    categories: body.map((row) => row[0] || '—'),
    series: numericCols.map((c) => ({
      name: headers[c] || `Series ${c}`,
      values: body.map((row) => {
        const value = numericValue(row[c]);
        return value === null ? 0 : value;
      }),
    })),
  };
}

function niceCeil(value) {
  const v = Math.max(1e-9, value);
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const frac = v / base;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * base;
}

function formatValue(value) {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 100) / 10}k`.replace('.0k', 'k');
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// Build the full element list for a chart. `make` is the app's element factory
// (applies default styles); every element is tagged so the chart can later be
// found and regenerated as a unit.
export function buildChartElements(table, { type, x, y, w, h, make, groupId, chartId, sheetName, fileName }) {
  // `box` remembers where the chart was placed so regenerations (editor,
  // update-from-file) reuse the exact same spot instead of re-deriving a
  // center from whichever element happens to be first. `sheetName`/`fileName`
  // track the spreadsheet the data came from for update-from-file matching.
  const chart = { type, table, sheetName, fileName, box: { x, y, w, h } };
  const meta = { groupId, chartId, chart };
  const elements = [];
  const add = (elType, ex, ey, ew, eh, overrides = {}) => {
    elements.push(make(elType, ex, ey, ew, eh, { ...meta, ...overrides }));
  };

  if (type === 'pie') {
    buildPie(table, { x, y, w, h, add });
    return elements;
  }

  const left = x + 54;
  const top = y + 30;
  const bottom = y + h - 60;
  const right = x + w - 20;
  const plotH = bottom - top;
  const plotW = right - left;

  add('line', left, top, 0, plotH);
  add('line', left, bottom, plotW, 0);

  const max = niceCeil(Math.max(1, ...table.series.flatMap((s) => s.values)));
  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const value = (max / ticks) * i;
    const ty = bottom - (plotH * i) / ticks;
    add('text', left - 12, ty - 9, 0, 0, { text: formatValue(value), fontSize: 13, textAlign: 'right' });
  }

  const n = Math.max(1, table.categories.length);
  const slot = plotW / n;
  const multi = table.series.length > 1;

  if (type === 'bar') {
    const barW = multi ? slot * 0.68 / table.series.length : slot * 0.52;
    table.categories.forEach((category, i) => {
      table.series.forEach((s, si) => {
        const value = s.values[i] ?? 0;
        const bh = Math.max(2, (plotH * Math.max(0, value)) / max);
        const bx = multi
          ? left + slot * i + slot * 0.16 + si * barW
          : left + slot * i + (slot - barW) / 2;
        add('rectangle', bx, bottom - bh, barW, bh, {
          background: CHART_SERIES_COLORS[si % CHART_SERIES_COLORS.length],
          fillStyle: 'solid',
        });
        if (!multi) add('text', bx + barW / 2, bottom - bh - 22, 0, 0, { text: formatValue(value), fontSize: 12, textAlign: 'center' });
      });
      add('text', left + slot * i + slot / 2, bottom + 12, 0, 0, {
        text: category, fontSize: 13, textAlign: 'center', width: Math.max(40, slot - 10),
      });
    });
    if (multi) addLegend(add, table.series, left, y + 4);
    return elements;
  }

  // line
  table.series.forEach((s, si) => {
    const pts = s.values.map((value, i) => ({
      px: left + slot * (i + 0.5),
      py: bottom - (plotH * Math.max(0, value)) / max,
    }));
    if (pts.length > 1) {
      add('freedraw', pts[0].px, pts[0].py, 0, 0, {
        points: pts.map((p) => [p.px - pts[0].px, p.py - pts[0].py]),
        background: 'transparent',
      });
    }
    pts.forEach((p) => {
      add('ellipse', p.px - 6, p.py - 6, 12, 12, {
        background: CHART_SERIES_COLORS[si % CHART_SERIES_COLORS.length],
        fillStyle: 'solid',
      });
    });
  });
  table.categories.forEach((category, i) => {
    add('text', left + slot * (i + 0.5), bottom + 12, 0, 0, {
      text: category, fontSize: 13, textAlign: 'center', width: Math.max(40, slot - 10),
    });
  });
  if (multi) addLegend(add, table.series, left, y + 4);
  return elements;
}

function addLegend(add, series, x, y) {
  let lx = x;
  series.forEach((s, si) => {
    add('rectangle', lx, y + 2, 14, 14, {
      background: CHART_SERIES_COLORS[si % CHART_SERIES_COLORS.length],
      fillStyle: 'solid',
    });
    const label = s.name;
    add('text', lx + 20, y, 0, 0, { text: label, fontSize: 13 });
    lx += 26 + Math.max(40, label.length * 8);
  });
}

function buildPie(table, { x, y, w, h, add }) {
  const series = table.series[0];
  const cx = x + w / 2;
  const cy = y + h / 2 + 10;
  const r = Math.max(50, Math.min(w, h) / 2 - 74);
  const total = series.values.reduce((sum, v) => sum + Math.abs(v), 0) || 1;

  let angle = -Math.PI / 2;
  series.values.forEach((value, i) => {
    const sweep = (Math.abs(value) / total) * Math.PI * 2;
    const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 16)));
    const points = [[0, 0]];
    for (let s = 0; s <= steps; s += 1) {
      const a = angle + (sweep * s) / steps;
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    add('freedraw', cx, cy, 0, 0, {
      points,
      background: CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length],
      fillStyle: 'solid',
    });
    const mid = angle + sweep / 2;
    const pct = Math.round((Math.abs(value) / total) * 100);
    const cos = Math.cos(mid);
    const label = `${table.categories[i] ?? ''} ${pct}%`;
    add('text', cx + cos * (r + 26), cy + Math.sin(mid) * (r + 16) - 8, 0, 0, {
      text: label,
      fontSize: 13,
      textAlign: cos > 0.35 ? 'left' : cos < -0.35 ? 'right' : 'center',
    });
    angle += sweep;
  });
}

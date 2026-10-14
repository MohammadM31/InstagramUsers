// Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF, embedded newlines). Pure.
// Every returned row also has `__line`: the line in the file where that record starts (header = line 1), so import errors can point at the real row.
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false, line = 1, start = 1;
  const s = String(text).replace(/^\uFEFF/, '');
  const end = () => { row.push(f); f = ''; if (row.some(x => x !== '')) rows.push({ cells: row, line: start }); row = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else { if (c === '\n' || (c === '\r' && s[i + 1] !== '\n')) line++; f += c; }
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; end(); line++; start = line; }
    else f += c;
  }
  end();
  if (!rows.length) return [];
  const head = rows[0].cells.map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  return rows.slice(1).map(r => ({ ...Object.fromEntries(head.map((h, i) => [h, (r.cells[i] ?? '').trim()])), __line: r.line }));
}

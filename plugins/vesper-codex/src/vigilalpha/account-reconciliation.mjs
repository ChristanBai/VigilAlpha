/** Read-only Trading 212 export reconciliation. Decimal strings avoid binary rounding. */
const SCALE = 10n ** 12n;
function decimal(value, label = 'amount') {
  const text = String(value ?? '').trim();
  if (!/^[+-]?\d+(?:\.\d{1,12})?$/.test(text)) throw new Error(`Invalid ${label}: decimal with at most 12 places required`);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  return (negative ? -1n : 1n) * (BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0')));
}
function format(value) {
  const abs = value < 0n ? -value : value;
  const fraction = String(abs % SCALE).padStart(12, '0').replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${abs / SCALE}${fraction ? `.${fraction}` : ''}`;
}
export function parseTrading212Csv(csv) {
  if (typeof csv !== 'string') throw new Error('CSV text required');
  const rows = []; let row = [], cell = '', quoted = false, afterQuote = false;
  const input = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else cell += ch;
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(cell); cell = ''; afterQuote = false;
      if (ch !== ',') { if (row.some(x => x !== '')) rows.push(row); row = []; if (ch === '\r' && input[i + 1] === '\n') i++; }
    } else if (ch === '"' && cell === '' && !afterQuote) quoted = true;
    else { if (afterQuote || ch === '"') throw new Error('Malformed CSV quoting'); cell += ch; }
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (cell || row.length || afterQuote) { row.push(cell); rows.push(row); }
  if (!rows.length) throw new Error('Empty CSV');
  const header = rows.shift();
  if (new Set(header).size !== header.length) throw new Error('Duplicate CSV headers');
  for (const name of ['Action', 'Time (UTC)', 'ISIN', 'ID', 'No. of shares', 'Total', 'Currency (Total)']) if (!header.includes(name)) throw new Error(`Missing CSV header: ${name}`);
  return rows.map((values, i) => {
    if (values.length !== header.length) throw new Error(`CSV row ${i + 2} has incorrect column count`);
    return Object.fromEntries(header.map((name, j) => [name, values[j]]));
  });
}
export function reconcileTrading212Csv(csv, { openingCash = {}, openingHoldings = {} } = {}) {
  const rows = parseTrading212Csv(csv), issues = [], cash = {}, holdings = {}, results = {}, fees = {}, actions = {}, ids = new Set(), times = [];
  const add = (map, key, amount) => { if (!key) throw new Error('Missing currency or ISIN'); map[key] = (map[key] ?? 0n) + amount; };
  for (const [key, value] of Object.entries(openingCash)) add(cash, key, decimal(value));
  for (const [key, value] of Object.entries(openingHoldings)) add(holdings, key, decimal(value));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], action = r.Action.trim(), id = r.ID.trim(), rowNumber = i + 2;
    actions[action] = (actions[action] ?? 0) + 1;
    if (id && ids.has(id)) { issues.push({ row: rowNumber, code: 'DUPLICATE_ID', severity: 'ERROR' }); continue; }
    if (id) ids.add(id);
    try {
      // Validate a complete, timezone-bearing timestamp; the UTC export may use a space.
      const time = r['Time (UTC)'].replace(' ', 'T');
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(time) || !Number.isFinite(Date.parse(time))) throw new Error('Invalid UTC timestamp');
      const c = {}, h = {}, result = {}, fee = {};
      const amount = () => decimal(r.Total, 'Total');
      const positive = value => { if (value < 0n) throw new Error('Unexpected negative amount'); return value; };
      if (/^(Market|Limit|Stop|Stop limit) (buy|sell)$/.test(action)) {
        const buy = action.endsWith('buy');
        const quantity = positive(decimal(r['No. of shares'], 'shares'));
        add(h, r.ISIN, buy ? quantity : -quantity);
        add(c, r['Currency (Total)'], (buy ? -1n : 1n) * positive(amount()));
      } else if (action === 'Stock dividends') add(h, r.ISIN, positive(decimal(r['No. of shares'], 'shares')));
      else if (action === 'Deposit' || action.startsWith('Dividend (')) add(c, r['Currency (Total)'], positive(amount()));
      else if (action === 'Withdrawal') { const n = amount(); add(c, r['Currency (Total)'], n > 0n ? -n : n); }
      else if (action === 'Currency conversion') {
        add(c, r['Currency (Currency conversion from amount)'], -positive(decimal(r['Currency conversion from amount'])));
        add(c, r['Currency (Currency conversion to amount)'], positive(decimal(r['Currency conversion to amount'])));
        const total = amount(); if (total > 0n) throw new Error('Conversion Total must be a signed charge or zero');
        add(c, r['Currency (Total)'], total);
      } else { issues.push({ row: rowNumber, code: 'UNSUPPORTED_ACTION', action, severity: 'ERROR' }); continue; }
      if (r.Result) add(result, r['Currency (Result)'], decimal(r.Result));
      for (const name of ['Currency conversion fee', 'Stamp duty reserve tax', 'Withholding tax']) if (r[name]) {
        const n = decimal(r[name]); add(fee, `${name}:${r[`Currency (${name})`] || 'UNKNOWN'}`, n < 0n ? -n : n);
      }
      for (const [dest, source] of [[cash, c], [holdings, h], [results, result], [fees, fee]]) for (const [key, value] of Object.entries(source)) add(dest, key, value);
      times.push(new Date(time).toISOString());
    } catch (error) { issues.push({ row: rowNumber, code: 'INVALID_ROW', message: error.message, severity: 'ERROR' }); }
  }
  const serialize = map => Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, format(value)]));
  times.sort();
  return {
    schemaVersion: 1, mode: 'ACCOUNT_EXPORT_RECONCILIATION', executionAuthority: 'NONE',
    status: issues.length ? 'BLOCKED' : 'SNAPSHOT_COMPARISON_REQUIRED', rowCount: rows.length,
    period: { first: times[0] ?? null, last: times.at(-1) ?? null }, actions,
    cashMovementPlusOpening: serialize(cash), holdingsMovementPlusOpeningByIsin: serialize(holdings),
    brokerReportedResultsByCurrency: serialize(results), reportedChargesByTypeAndCurrency: serialize(fees),
    openingCashProvided: Object.keys(openingCash).length > 0, openingHoldingsProvided: Object.keys(openingHoldings).length > 0,
    issues, profitValidated: false,
    limitations: [
      'Balances are period movements plus explicitly supplied openings; absence of an opening is not proof of zero.',
      'Compare against a broker snapshot at the same cutoff before treating balances as reconciled.',
      'Deposits and withdrawals may include internal transfers; they are not classified as external capital.',
      'Reported charges are informational and are not deducted again from transaction Totals.',
      'Currencies are kept separate; broker Result is not independently verified realized or total account profit.',
      'Stock dividends add shares only; cost basis, splits, other corporate actions and market valuation are not reconstructed.',
    ],
  };
}

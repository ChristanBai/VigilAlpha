// Adapted from ianlyoo/ticker-research-mcp sec_derived.py, commit
// 0d5d553a06e2a7f7106cbe34708ef12cdaf780de (MIT); see vendor/ticker-research.
// Adaptations: immutable JS output, matching periods/units, availability gates,
// explicit unavailable reasons, provenance for every derived result.
const validNumber = value => typeof value === 'number' && Number.isFinite(value);
const zoned = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const absent = reason => ({ status: 'UNAVAILABLE', value: null, reason });
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

export function deriveCompanyMetrics({ facts, asOf }) {
  if (!zoned(asOf)) throw new Error('asOf must include timezone');
  function derive(names, formula, compute, ratio = false) {
    const inputs = names.map(name => facts?.[name]);
    if (inputs.some(x => !x || !validNumber(x.value))) return absent('MISSING_OR_NONFINITE_INPUT');
    if (inputs.some(x => !zoned(x.availableAt) || Date.parse(x.availableAt) > Date.parse(asOf))) return absent('FUTURE_OR_UNKNOWN_AVAILABILITY');
    if (inputs.some(x => typeof x.source !== 'string' || !x.source.trim())) return absent('SOURCE_REQUIRED');
    const first = inputs[0];
    if (!date(first.periodStart) || !date(first.periodEnd) || first.periodStart > first.periodEnd || !first.unit || inputs.some(x => x.periodStart !== first.periodStart || x.periodEnd !== first.periodEnd || x.unit !== first.unit)) return absent('PERIOD_OR_UNIT_MISMATCH');
    if (ratio && first.value <= 0) return absent('NONPOSITIVE_REVENUE');
    const value = compute(inputs.map(x => x.value));
    if (!validNumber(value)) return absent('NONFINITE_DERIVATION');
    return { status: 'AVAILABLE', value, unit: ratio ? 'ratio' : first.unit, periodStart: first.periodStart,
      periodEnd: first.periodEnd, availableAt: new Date(Math.max(...inputs.map(x => Date.parse(x.availableAt)))).toISOString(),
      formula, inputs: structuredClone(inputs), derived: true };
  }
  const grossProfit = derive(['revenue', 'costOfRevenue'], 'revenue - costOfRevenue', ([a,b]) => a - b);
  const freeCashFlow = derive(['operatingCashFlow', 'capex'], 'operatingCashFlow - abs(capex)', ([a,b]) => a - Math.abs(b));
  const grossMargin = derive(['revenue', 'costOfRevenue'], '(revenue - costOfRevenue) / revenue', ([a,b]) => (a-b)/a, true);
  const freeCashFlowMargin = derive(['revenue', 'operatingCashFlow', 'capex'], '(operatingCashFlow - abs(capex)) / revenue', ([a,b,c]) => (b-Math.abs(c))/a, true);
  return { version: 'vigilalpha.company-evidence.v1', asOf, metrics: { grossProfit, freeCashFlow, grossMargin, freeCashFlowMargin },
    executionAuthority: 'NONE', interpretation: 'Historical accounting evidence; not valuation, a supply relationship or a buy/sell recommendation.' };
}

export function reviewSecCompanyFacts({ companyFacts, periodEnd, asOf }) {
  if (!zoned(asOf) || !date(periodEnd)) throw new Error('Explicit periodEnd and timezone-qualified asOf required');
  const cik = String(companyFacts?.cik ?? '');
  if (!/^\d{1,10}$/.test(cik)) throw new Error('SEC company CIK required');
  const root = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10,'0')}.json`;
  const concepts = {
    revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'],
    costOfRevenue: ['CostOfRevenue','CostOfGoodsAndServicesSold','CostOfGoodsSold'],
    operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment']
  };
  const facts = {}, missing = [];
  for (const [name,tags] of Object.entries(concepts)) {
    const candidates = tags.flatMap((tag,priority) => (companyFacts?.facts?.['us-gaap']?.[tag]?.units?.USD ?? []).map(row=>({...row,tag,priority})))
      .filter(row => ['10-K','10-K/A'].includes(row.form) && row.end === periodEnd && validNumber(row.val)
        && date(row.filed) && date(row.start)
        && Date.parse(`${row.filed}T23:59:59.999Z`) <= Date.parse(asOf)
        && (Date.parse(row.end)-Date.parse(row.start))/86400000 >= 300
        && (Date.parse(row.end)-Date.parse(row.start))/86400000 <= 400)
      .sort((a,b) => b.filed.localeCompare(a.filed) || a.priority-b.priority);
    const selected = candidates[0];
    if (!selected) { missing.push({ name, reason: 'NO_ELIGIBLE_ANNUAL_USD_FACT' }); continue; }
    if (candidates.some(row => row.filed === selected.filed && row.priority === selected.priority
      && (row.val !== selected.val || row.start !== selected.start))) {
      missing.push({ name, reason: 'AMBIGUOUS_SAME_FILING_FACT' }); continue;
    }
    facts[name] = { value: selected.val, unit: 'USD', periodStart: selected.start, periodEnd: selected.end,
      availableAt: `${selected.filed}T23:59:59.999Z`, availabilityBasis: 'CONSERVATIVE_END_OF_FILING_DATE_NOT_VERIFIED_ACCEPTANCE_TIME',
      filed: selected.filed, accession: selected.accn ?? null, concept: selected.tag, form: selected.form, source: root };
  }
  return { ...deriveCompanyMetrics({ facts, asOf }), entity: { cik, name: companyFacts.entityName ?? null }, periodEnd, facts, missing,
    limitations: ['Selected US-GAAP annual USD concepts only; no IFRS, full statements, debt or valuation model.',
      'Uses eligible filing dates, not independently verified intraday acceptance timestamps.', 'Comparative restatements are included only when filed by asOf.'] };
}

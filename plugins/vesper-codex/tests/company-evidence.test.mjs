import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCompanyMetrics, reviewSecCompanyFacts } from '../src/vigilalpha/company-evidence.mjs';
import { experimentalKronosForecast } from '../src/vigilalpha/kronos-adapter.mjs';
import { createToolRuntime } from '../src/mcp/tools.mjs';

const fact = value => ({value,unit:'USD',periodStart:'2024-01-01',periodEnd:'2024-12-31',availableAt:'2025-02-01T20:00:00Z',source:'https://www.sec.gov/example'});
const inputs = () => ({facts:{revenue:fact(100),costOfRevenue:fact(60),operatingCashFlow:fact(30),capex:fact(10)},asOf:'2025-03-01T00:00:00Z'});
test('ported accounting equations retain inputs and do not mutate them',()=>{
  const input=inputs(),copy=structuredClone(input);const {metrics}=deriveCompanyMetrics(input);
  assert.equal(metrics.grossProfit.value,40);assert.equal(metrics.freeCashFlow.value,20);
  assert.equal(metrics.grossMargin.value,0.4);assert.equal(metrics.freeCashFlowMargin.value,0.2);
  assert.equal(metrics.grossProfit.inputs[0].source,input.facts.revenue.source);assert.deepEqual(input,copy);
});
test('negative capex sign normalized; genuine zero remains available',()=>{
  const input=inputs();input.facts.capex.value=-30;
  assert.equal(deriveCompanyMetrics(input).metrics.freeCashFlow.value,0);
  assert.equal(deriveCompanyMetrics(input).metrics.freeCashFlow.status,'AVAILABLE');
});
test('missing, future, mismatched and nonfinite facts never become zero',()=>{
  for(const mutate of [x=>x.facts.revenue.value=null,x=>x.facts.revenue.value=NaN,x=>x.facts.revenue.value=true,
    x=>x.facts.revenue.unit='GBP',x=>x.facts.revenue.periodStart='2024-02-01',x=>x.facts.revenue.availableAt='2026-01-01T00:00:00Z',x=>delete x.facts.revenue.source]){
    const input=inputs();mutate(input);const result=deriveCompanyMetrics(input).metrics.grossProfit;
    assert.equal(result.status,'UNAVAILABLE');assert.equal(result.value,null);
  }
});
test('zero denominator never fabricates a margin',()=>{
  const input=inputs();input.facts.revenue.value=0;
  assert.equal(deriveCompanyMetrics(input).metrics.grossMargin.reason,'NONPOSITIVE_REVENUE');
});
function sec(){
  const row={start:'2024-01-01',end:'2024-12-31',val:100,form:'10-K',filed:'2025-02-01',accn:'a',fy:2024};
  return {cik:320193,entityName:'Test',facts:{'us-gaap':{
    Revenues:{units:{USD:[row,{...row,val:150,filed:'2026-02-01',accn:'future',fy:2025}]}},
    CostOfRevenue:{units:{USD:[{...row,val:60}]}},NetCashProvidedByUsedInOperatingActivities:{units:{USD:[{...row,val:30}]}},
    PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:[{...row,val:10}]}}
  }}};
}
test('SEC selects economic period, excludes future restatement and retains accession',()=>{
  const report=reviewSecCompanyFacts({companyFacts:sec(),periodEnd:'2024-12-31',asOf:'2025-03-01T00:00:00Z'});
  assert.equal(report.metrics.grossProfit.value,40);assert.equal(report.facts.revenue.accession,'a');
  assert.equal(report.facts.revenue.availableAt,'2025-02-01T23:59:59.999Z');
});
test('ambiguous same-filing facts and partial-year rows are unavailable',()=>{
  const data=sec();data.facts['us-gaap'].Revenues.units.USD.push({...data.facts['us-gaap'].Revenues.units.USD[0],val:101});
  const report=reviewSecCompanyFacts({companyFacts:data,periodEnd:'2024-12-31',asOf:'2025-03-01T00:00:00Z'});
  assert.equal(report.metrics.grossProfit.status,'UNAVAILABLE');assert.equal(report.missing[0].reason,'AMBIGUOUS_SAME_FILING_FACT');
});
test('company evidence MCP is offline; optional model cannot silently download',async()=>{
  const runtime=createToolRuntime({env:{}});
  const result=await runtime.call('company_quality_evidence',{companyFacts:sec(),periodEnd:'2024-12-31',asOf:'2025-03-01T00:00:00Z'});
  assert.equal(result.executionAuthority,'NONE');
  const model=await runtime.call('experimental_kronos_forecast',{bars:[],futureSessions:[],instrumentId:'x'});
  assert.equal(model.reason,'LOCAL_MODEL_CONFIGURATION_REQUIRED');
});
test('missing model runtime returns unavailable without exposing environment',async()=>{
  const r=await experimentalKronosForecast({}, {env:{VIGILALPHA_EXPERIMENT_PYTHON:'/missing/vigilalpha-python',VIGILALPHA_KRONOS_MODEL_DIR:'/none',VIGILALPHA_KRONOS_TOKENIZER_DIR:'/none'}});
  assert.equal(r.reason,'MODEL_RUNTIME_UNAVAILABLE');assert.equal(r.executionAuthority,'NONE');
});

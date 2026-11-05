import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrading212Csv, reconcileTrading212Csv } from '../src/vigilalpha/account-reconciliation.mjs';
const headers = ['Action','Time (UTC)','ISIN','ID','No. of shares','Total','Currency (Total)','Result','Currency (Result)','Currency conversion from amount','Currency (Currency conversion from amount)','Currency conversion to amount','Currency (Currency conversion to amount)','Currency conversion fee','Currency (Currency conversion fee)','Notes'];
const csv = rows => [headers, ...rows.map(row => headers.map(key => ({'Time (UTC)': '2026-01-01 12:00:00+00:00', ...row})[key] ?? ''))].map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
test('CSV quoting handles multiline notes and rejects malformed data', () => {
  const input = csv([{ Action:'Deposit', Total:'1', 'Currency (Total)':'GBP', Notes:'a,"b"\nc'}]);
  assert.equal(parseTrading212Csv(input)[0].Notes, 'a,"b"\nc');
  assert.throws(() => parseTrading212Csv(input + '"'), /quot/);
  assert.throws(() => parseTrading212Csv('Action,Action\na,b'), /Duplicate/);
});
test('cash and fractional holdings are exact; dividends and fees not double-counted', () => {
  const report = reconcileTrading212Csv(csv([
    {Action:'Deposit', Total:'100', 'Currency (Total)':'GBP'},
    {Action:'Market buy', ISIN:'GBX', 'No. of shares':'0.1', Total:'10.01', 'Currency (Total)':'GBP', 'Currency conversion fee':'0.01','Currency (Currency conversion fee)':'GBP'},
    {Action:'Stock dividends', ISIN:'GBX', 'No. of shares':'0.00000001', Total:'0', 'Currency (Total)':'GBP'},
    {Action:'Market sell', ISIN:'GBX', 'No. of shares':'0.01', Total:'1.1', 'Currency (Total)':'GBP',Result:'0.09','Currency (Result)':'GBP'},
    {Action:'Withdrawal', Total:'-2', 'Currency (Total)':'GBP'},
    {Action:'Dividend (Dividend)', Total:'0.02', 'Currency (Total)':'GBP'},
  ]));
  assert.equal(report.cashMovementPlusOpening.GBP,'89.11');
  assert.equal(report.holdingsMovementPlusOpeningByIsin.GBX,'0.09000001');
  assert.equal(report.profitValidated,false);
  assert.equal(report.status,'SNAPSHOT_COMPARISON_REQUIRED');
});
test('currency conversion has two legs and one signed fee, with currencies separate', () => {
  const report = reconcileTrading212Csv(csv([{Action:'Currency conversion',Total:'-0.10','Currency (Total)':'GBP','Currency conversion from amount':'89.26','Currency (Currency conversion from amount)':'USD','Currency conversion to amount':'67.27','Currency (Currency conversion to amount)':'GBP','Currency conversion fee':'-0.10','Currency (Currency conversion fee)':'GBP'}]), {openingCash:{USD:'100'}});
  assert.deepEqual(report.cashMovementPlusOpening, {GBP:'67.17',USD:'10.74'});
});
test('duplicates, unknown actions and invalid rows block without partial row mutation', () => {
  const report = reconcileTrading212Csv(csv([
    {Action:'Deposit', ID:'a',Total:'1','Currency (Total)':'GBP'},
    {Action:'Deposit', ID:'a',Total:'1','Currency (Total)':'GBP'},
    {Action:'Split',ISIN:'GBX','No. of shares':'1'},
    {Action:'Market buy',ISIN:'GBX','No. of shares':'1',Total:'invalid','Currency (Total)':'GBP'},
  ]));
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.issues.length,3);
  assert.deepEqual(report.cashMovementPlusOpening,{GBP:'1'});
  assert.deepEqual(report.holdingsMovementPlusOpeningByIsin,{});
});

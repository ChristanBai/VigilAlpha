#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { reconcileTrading212Csv } from '../src/vigilalpha/account-reconciliation.mjs';
const [file, openingFile] = process.argv.slice(2);
if (!file) { console.error('Usage: node scripts/reconcile-account.mjs export.csv [opening-balances.json]'); process.exitCode = 1; }
else {
  try {
    const report = reconcileTrading212Csv(await readFile(file, 'utf8'), openingFile ? JSON.parse(await readFile(openingFile, 'utf8')) : {});
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'BLOCKED') process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

#!/usr/bin/env python3
"""Reprice saved forecasts, without model execution, downloads or broker access.

Usage: python reprice-pilot.py /absolute/pilot-directory
Outputs JSON to stdout; never overwrites the frozen source experiment.
"""
import argparse
import hashlib
import json
import pathlib

from pilot_accounting import account_trials, validate_outcomes


def reprice(folder):
    raw = (folder / 'report.json').read_bytes()
    report = json.loads(raw)
    frozen = {'initialCash': 1000, 'costBps': 10, 'stressCostBps': 20, 'horizon': 5, 'folds': 4}
    if any(type(report.get('spec', {}).get(key)) not in (int, float) or report['spec'][key] != value for key, value in frozen.items()):
        raise ValueError('Unsupported or missing frozen experiment specification')
    trials = report['trials']
    if len(trials) != 4:
        raise ValueError('All four original trials required')
    hashes = {}
    for index, trial in enumerate(trials, 1):
        path = folder / f'fold-{index}.json'
        content = path.read_bytes()
        hashes[path.name] = hashlib.sha256(content).hexdigest()
        fold = json.loads(content)
        context, actual = fold['input']['bars'], fold['actual']
        validate_outcomes(actual, context[-1]['time'])
        if trial['fold'] != index or fold['model']['status'] != 'FORECAST_ONLY_UNVALIDATED':
            raise ValueError('Uncomputed or misordered original fold')
        expected = {'signalTime': context[-1]['time'], 'start': actual[0]['time'],
                    'end': actual[-1]['time'], 'entryOpen': actual[0]['open'],
                    'actualClose': actual[-1]['close'], 'priorClose': context[-1]['close'],
                    'predictedClose': fold['model']['predictions'][-1]['close']}
        if any(trial[key] != value for key, value in expected.items()):
            raise ValueError('Trial summary does not match retained source fold')
        if trial['long'] != (expected['predictedClose'] / expected['priorClose'] - 1 > 0.002):
            raise ValueError('Frozen signal mismatch')
    return {'version': 'vigilalpha.pilot-repricing.v1',
            'sourceReportSha256': hashlib.sha256(raw).hexdigest(), 'foldSha256': hashes,
            'modelRerun': False, 'brokerOrders': 0, 'executionAuthority': 'NONE',
            'liquidated': {str(bps): account_trials(trials, bps) for bps in (10, 20)},
            'terminalMarked': {str(bps): account_trials(trials, bps, terminal_liquidation=False) for bps in (10, 20)},
            'limitations': ['Saved historical forecasts only; not a new prospective experiment.',
                            'Terminal marking is an accounting sensitivity, not a change to the frozen five-day exit rule.',
                            'Source identity, calendar completeness, corporate actions, training overlap and usage rights remain unverified.',
                            'All costs are assumptions. Zero trades cannot validate transaction costs.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=pathlib.Path)
    args = parser.parse_args()
    print(json.dumps(reprice(args.directory), indent=2, allow_nan=False))

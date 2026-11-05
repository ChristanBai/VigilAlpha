import copy
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from pilot_accounting import account_trials, validate_outcomes

spec = importlib.util.spec_from_file_location('reprice_pilot', pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'reprice-pilot.py')
repricer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repricer)


def trials(long=True):
    return [{'status': 'COMPUTED', 'long': long, 'entryOpen': 100, 'actualClose': 100,
             'signalTime': f'2026-10-{1+i*7:02}T16:00:00Z',
             'start': f'2026-10-{2+i*7:02}T16:00:00Z',
             'end': f'2026-10-{6+i*7:02}T16:00:00Z'} for i in range(4)]


class Accounting(unittest.TestCase):
    def fixture(self, folder):
        source = trials(False)
        for i, trial in enumerate(source):
            trial.update(fold=i+1, priorClose=100, predictedClose=100)
            bars = [{'time': f'2026-10-{2+i*7+j:02}T16:00:00Z', 'open': 100,
                     'high': 101, 'low': 99, 'close': 100, 'volume': 10} for j in range(5)]
            fold = {'input': {'bars': [{'time': trial['signalTime'], 'close': 100}]},
                    'actual': bars, 'model': {'status': 'FORECAST_ONLY_UNVALIDATED', 'predictions': [{'close': 100}]}}
            (folder / f'fold-{i+1}.json').write_text(json.dumps(fold))
        (folder / 'report.json').write_text(json.dumps({'trials': source, 'spec': {'initialCash': 1000, 'costBps': 10, 'stressCostBps': 20, 'horizon': 5, 'folds': 4}}))

    def test_reprice_preserves_sources_and_matches_original_folds(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory); self.fixture(folder)
            before = {p.name: p.read_bytes() for p in folder.iterdir()}
            result = repricer.reprice(folder)
            self.assertEqual(result['liquidated']['10']['tradeCount'], 0)
            self.assertFalse(result['modelRerun'])
            self.assertEqual(before, {p.name: p.read_bytes() for p in folder.iterdir()})
            report = json.loads((folder / 'report.json').read_text())
            report['trials'][0]['entryOpen'] = 101
            (folder / 'report.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'does not match'):
                repricer.reprice(folder)

    def test_reprice_rejects_corrupt_retained_actual_prices(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory); self.fixture(folder)
            path = folder / 'fold-1.json'; fold = json.loads(path.read_text())
            fold['actual'][2]['high'] = 99
            path.write_text(json.dumps(fold))
            with self.assertRaisesRegex(ValueError, 'Incoherent'):
                repricer.reprice(folder)

    def test_flat_price_roundtrips_and_terminal_mark(self):
        source = trials(); before = copy.deepcopy(source)
        sold = account_trials(source, 100)
        marked = account_trials(source, 100, terminal_liquidation=False)
        self.assertAlmostEqual(sold['strategyFinalEquity'], 1000 * (0.99 / 1.01)**4)
        self.assertAlmostEqual(marked['strategyFinalEquity'], 1000 * (0.99 / 1.01)**3 / 1.01)
        self.assertAlmostEqual(sold['benchmarkFinalEquity'], 1000 * 0.99 / 1.01)
        self.assertAlmostEqual(marked['benchmarkFinalEquity'], 1000 / 1.01)
        self.assertEqual((sold['tradeCount'], marked['tradeCount']), (8, 7))
        self.assertEqual(source, before)

    def test_no_trades_does_not_demonstrate_cost_resilience(self):
        for bps in (0, 10, 20, 100):
            for terminal in (True, False):
                result = account_trials(trials(False), bps, terminal_liquidation=terminal)
                self.assertEqual(result['netReturn'], 0)
                self.assertEqual(result['tradeCount'], 0)
                self.assertEqual(result['executionAuthority'], 'NONE')

    def test_only_final_exit_can_be_suppressed(self):
        source = trials(); source[-1]['long'] = False
        self.assertEqual(account_trials(source, 100)['strategyFinalEquity'],
                         account_trials(source, 100, terminal_liquidation=False)['strategyFinalEquity'])

    def test_invalid_inputs_and_failed_trials_rejected(self):
        for value in (None, True, -1, float('nan'), float('inf'), 10000):
            with self.assertRaises(ValueError): account_trials(trials(), value)
        for key, value in [('entryOpen', 0), ('actualClose', None), ('long', 1),
                           ('status', 'BLOCKED'), ('start', '2026-10-01T00:00:00Z')]:
            source = trials(); source[0][key] = value
            with self.assertRaises(ValueError): account_trials(source, 10)
        with self.assertRaises(ValueError): account_trials(trials()[:3], 10)

    def test_future_outcome_data_is_validated_before_scoring(self):
        bars = [{'time': f'2026-10-{i+2:02}T16:00:00Z', 'open': 100,
                 'high': 101, 'low': 99, 'close': 100, 'volume': 10} for i in range(5)]
        validate_outcomes(bars, '2026-10-01T16:00:00Z')
        for key, value in [('open', None), ('close', float('nan')), ('high', 98),
                           ('low', 102), ('volume', -1), ('close', True),
                           ('time', '2026-10-01T16:00:00Z')]:
            invalid = copy.deepcopy(bars); invalid[0][key] = value
            with self.assertRaises(ValueError): validate_outcomes(invalid, '2026-10-01T16:00:00Z')


if __name__ == '__main__':
    unittest.main()

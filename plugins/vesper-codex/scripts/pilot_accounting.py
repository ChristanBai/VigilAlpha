"""Offline accounting for frozen five-session trials; no forecasts or orders."""
import datetime as dt
import math


def number(value, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Finite numeric value required')
    if value < 0 or (positive and value == 0):
        raise ValueError('Invalid negative or zero value')
    return value


def instant(value):
    if not isinstance(value, str):
        raise ValueError('Timestamp required')
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timezone required')
    return result


def validate_outcomes(bars, signal_time):
    """Calendar completeness is checked separately by the pilot runner."""
    if len(bars) != 5:
        raise ValueError('Exactly five outcome bars required')
    previous = instant(signal_time)
    for bar in bars:
        current = instant(bar['time'])
        if current <= previous:
            raise ValueError('Outcomes must follow signal and increase')
        previous = current
        for key in ('open', 'high', 'low', 'close'):
            number(bar[key], positive=True)
        number(bar['volume'])
        if bar['high'] < max(bar['open'], bar['close']) or bar['low'] > min(bar['open'], bar['close']):
            raise ValueError('Incoherent outcome OHLCV')


def account_trials(trials, cost_bps, initial_cash=1000, terminal_liquidation=True):
    """Mark mode suppresses only the final exit; earlier frozen exits remain.

    This is an accounting sensitivity, not a replacement for the frozen rule.
    Source outcome OHLCV and the exchange calendar need separate validation.
    """
    number(initial_cash, positive=True)
    number(cost_bps)
    if cost_bps >= 10000 or type(terminal_liquidation) is not bool:
        raise ValueError('Invalid cost or terminal policy')
    if len(trials) != 4:
        raise ValueError('Exactly four trials required; do not drop failures')
    previous_end = None
    for trial in trials:
        if trial.get('status') != 'COMPUTED' or type(trial.get('long')) is not bool:
            raise ValueError('All trial results and boolean signals required')
        for key in ('entryOpen', 'actualClose'):
            number(trial[key], positive=True)
        signal, start, end = (instant(trial[key]) for key in ('signalTime', 'start', 'end'))
        if not signal < start <= end or (previous_end and signal < previous_end):
            raise ValueError('Invalid or overlapping trial chronology')
        previous_end = end
    rate = cost_bps / 10000
    equity = initial_cash
    trades = 0
    for index, trial in enumerate(trials):
        if trial['long']:
            units = equity / (trial['entryOpen'] * (1 + rate))
            equity = units * trial['actualClose']
            sell = index < len(trials) - 1 or terminal_liquidation
            if sell:
                equity *= 1 - rate
            trades += 1 + int(sell)
    passive = initial_cash / (trials[0]['entryOpen'] * (1 + rate)) * trials[-1]['actualClose']
    if terminal_liquidation:
        passive *= 1 - rate
    if not all(math.isfinite(x) for x in (equity, passive)):
        raise ValueError('Nonfinite accounting result')
    return {'strategyFinalEquity': equity, 'benchmarkFinalEquity': passive,
            'netReturn': equity / initial_cash - 1,
            'benchmarkNetReturn': passive / initial_cash - 1,
            'excessReturn': (equity - passive) / initial_cash,
            'tradeCount': trades, 'terminalLiquidation': terminal_liquidation,
            'executionAuthority': 'NONE'}

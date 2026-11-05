#!/usr/bin/env python3
"""Four fixed historical five-session trials; keeps all failures, no tuning.
Raw source remains local. This is exploratory replay, never broker trading.
"""
import argparse, datetime as dt, hashlib, json, pathlib, subprocess, sys
import pandas as pd
import exchange_calendars as xc
from pilot_accounting import account_trials, validate_outcomes

parser=argparse.ArgumentParser()
parser.add_argument('snapshot');parser.add_argument('destination');parser.add_argument('--model-dir',required=True);parser.add_argument('--tokenizer-dir',required=True)
args=parser.parse_args();raw=pathlib.Path(args.snapshot).read_bytes();chart=json.loads(raw)['chart']['result'][0]
if chart['meta']['currency']!='GBP' or chart['meta']['symbol']!='VWRP.L': raise ValueError('This fixed pilot is VWRP.L GBP only')
if chart.get('events'): raise ValueError('Reported corporate actions require a supported ledger')
cal=xc.get_calendar('XLON',start='2020-01-01',end='2027-12-31');quote=chart['indicators']['quote'][0]
rows=[]
for i,t in enumerate(chart['timestamp']):
    day=dt.datetime.fromtimestamp(t,dt.timezone.utc).date().isoformat()
    rows.append({'time':cal.schedule.loc[day]['close'].isoformat(),**{k:quote[k][i] for k in ['open','high','low','close','volume']}})
recorded=dt.datetime.now(dt.timezone.utc).isoformat()
spec={'rule':'forecast fifth close / prior close - 1 > 0.002 => long; otherwise cash',
 'universe':'VWRP.L / ISIN IE00BK5BQT80','lookback':128,'horizon':5,'folds':4,'seed':1729,'sampleCount':3,
 'costBps':10,'stressCostBps':20,'entry':'next session open','exit':'fifth session close, assumed fill',
 'initialCash':1000,'historicalNotProspective':True,'trainingOverlap':'UNKNOWN'}
dest=pathlib.Path(args.destination);dest.mkdir(parents=True,exist_ok=True)
with (dest/'spec.json').open('x') as f: json.dump({'recordedAt':recorded,**spec},f,indent=2)
trials=[];runner=pathlib.Path(__file__).with_name('kronos-forecast.py')
for fold in range(4):
    start=len(rows)-20+fold*5;context=rows[start-128:start];outcomes=rows[start:start+5]
    payload={'instrumentId':'ISIN:IE00BK5BQT80','bars':context,'futureSessions':[b['time'] for b in outcomes],'seed':1729,'sampleCount':3}
    expected=cal.sessions_in_range(context[0]['time'][:10],outcomes[-1]['time'][:10]).strftime('%Y-%m-%d').tolist()
    if [b['time'][:10] for b in context+outcomes] != expected:
        trials.append({'fold':fold+1,'status':'BLOCKED_CALENDAR_GAPS'});continue
    try:
        validate_outcomes(outcomes, context[-1]['time'])
    except (ValueError, KeyError, TypeError):
        trials.append({'fold':fold+1,'status':'BLOCKED_INVALID_OUTCOMES'});continue
    completed=subprocess.run([sys.executable,str(runner),'--model-dir',args.model_dir,'--tokenizer-dir',args.tokenizer_dir],input=json.dumps(payload),text=True,capture_output=True,timeout=60)
    result=json.loads(completed.stdout)
    with (dest/f'fold-{fold+1}.json').open('x') as f: json.dump({'input':payload,'model':result,'actual':outcomes},f,indent=2)
    if result['status']!='FORECAST_ONLY_UNVALIDATED': trials.append({'fold':fold+1,'status':result['status']});continue
    prior=context[-1]['close'];predicted=result['predictions'][-1]['close'];end=outcomes[-1]['close'];entry=outcomes[0]['open']
    trials.append({'fold':fold+1,'status':'COMPUTED','signalTime':context[-1]['time'],'start':outcomes[0]['time'],'end':outcomes[-1]['time'],
      'priorClose':prior,'predictedClose':predicted,'actualClose':end,'entryOpen':entry,
      'long':predicted/prior-1>0.002,'predictedReturn':predicted/prior-1,'actualCloseReturn':end/prior-1,
      'modelAbsoluteError':abs(predicted-end),'noChangeAbsoluteError':abs(prior-end)})
result={'version':'vigilalpha.kronos-pilot.v2','status':'EXPLORATORY_NOT_VALIDATED','recordedAt':recorded,'spec':spec,
 'rawSha256':hashlib.sha256(raw).hexdigest(),'trials':trials,'brokerOrders':0,'executionAuthority':'NONE','autoPromotion':False,
 'limitations':['Four historical trials only; no statistical inference or independent out-of-sample claim.',
  'Historical model training overlap and public source permissions are not established.',
  'Fixed-price fills and 10/20bps costs are assumptions; not observed spreads, liquidity, taxes or broker execution.',
  'One ETF selected for platform fit; does not establish performance across markets or regimes.',
  'No corporate actions reported by source; completeness not independently verified.']}
if len(trials)==4 and all(t['status']=='COMPUTED' for t in trials):
    for label,bps in [('base',10),('doubleCost',20)]:
        accounting=account_trials(trials,bps)
        result[label]={**accounting,'strategyFinalCash':accounting['strategyFinalEquity'],'benchmarkFinalCash':accounting['benchmarkFinalEquity']}
    result['terminalMarkSensitivity']={
        'interpretation':'Accounting sensitivity only; suppress final exit, retain earlier frozen exits. Not a new strategy or forward result.',
        'base':account_trials(trials,10,terminal_liquidation=False),
        'doubleCost':account_trials(trials,20,terminal_liquidation=False)}
    result['forecastError']={'modelMeanAbsoluteError':sum(t['modelAbsoluteError'] for t in trials)/4,
       'noChangeMeanAbsoluteError':sum(t['noChangeAbsoluteError'] for t in trials)/4}
with (dest/'report.json').open('x') as f: json.dump(result,f,indent=2)
print(json.dumps({k:result[k] for k in ['status','trials','base','doubleCost','forecastError'] if k in result}))

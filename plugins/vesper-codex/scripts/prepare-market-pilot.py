#!/usr/bin/env python3
"""Normalize a local Yahoo chart snapshot for informational diagnostics only.
No network; never creates assertions of data-use rights or formal admission.
"""
import argparse, datetime as dt, hashlib, json, math, pathlib
import pandas as pd
import exchange_calendars as xc

parser=argparse.ArgumentParser()
parser.add_argument('snapshot');parser.add_argument('destination');parser.add_argument('--instrument-id',required=True)
args=parser.parse_args()
raw=pathlib.Path(args.snapshot).read_bytes(); result=json.loads(raw)['chart']['result'][0]
if result['meta']['exchangeTimezoneName']!='Europe/London' or result['meta']['currency']!='GBP': raise ValueError('This pilot supports GBP London listings only')
calendar=xc.get_calendar('XLON',start='2020-01-01',end='2027-12-31')
quote=result['indicators']['quote'][0]; bars=[]; problems=[]
def iso(t): return t.isoformat().replace('+00:00','Z')
for i,timestamp in enumerate(result['timestamp']):
    date=dt.datetime.fromtimestamp(timestamp,dt.timezone.utc).astimezone(__import__('zoneinfo').ZoneInfo('Europe/London')).date().isoformat()
    if date not in calendar.schedule.index: problems.append({'date':date,'reason':'NOT_IN_CALENDAR'});continue
    row={k:quote[k][i] for k in ['open','high','low','close','volume']}
    if any(v is None or not math.isfinite(v) for v in row.values()): problems.append({'date':date,'reason':'MISSING_OHLCV'});continue
    if min(row[k] for k in ['open','high','low','close'])<=0 or row['high']<max(row['open'],row['close']) or row['low']>min(row['open'],row['close']) or row['volume']<0: problems.append({'date':date,'reason':'INCOHERENT_OHLCV'});continue
    session=calendar.schedule.loc[date]
    bars.append({**row,'openTime':iso(session['open']),'closeTime':iso(session['close']),
      'availableAt':iso(session['close']+pd.Timedelta(minutes=5)),
      'openFx':1,'closeFx':1,'openFxAvailableAt':iso(session['open']),'closeFxAvailableAt':iso(session['close'])})
if not bars: raise ValueError('No usable bars')
expected=calendar.sessions_in_range(bars[0]['openTime'][:10],bars[-1]['openTime'][:10]).strftime('%Y-%m-%d').tolist()
observed={b['openTime'][:10] for b in bars}
missing=[d for d in expected if d not in observed]
history_ok=not (missing or problems)
recent_expected=expected[-128:]
if len(bars)<128 or [b['openTime'][:10] for b in bars[-128:]] != recent_expected:
    raise ValueError(json.dumps({'reason':'INCOMPLETE_RECENT_MODEL_CONTEXT','missingSessions':missing,'problems':problems}))
month_last={}
for date,session in calendar.schedule.iterrows(): month_last[date.strftime('%Y-%m')]=iso(session['close'])
month_ends=[b['closeTime'] for b in bars if b['closeTime']==month_last.get(b['closeTime'][:7])]
future_schedule=calendar.schedule.loc[calendar.schedule.index>pd.Timestamp(bars[-1]['closeTime'][:10])].iloc[:5]
actions=[{'type':kind,**event} for kind,events in result.get('events',{}).items() for event in events.values()]
diagnostic={'bars':bars,'monthEndCloses':month_ends,'instrumentId':args.instrument_id,'baseCurrency':'GBP','initialCash':1000,'costBps':10,'reportedActions':actions}
forecast={'instrumentId':args.instrument_id,'bars':[{'time':b['closeTime'],**{k:b[k] for k in ['open','high','low','close','volume']}} for b in bars[-128:]],
  'futureSessions':[iso(t) for t in future_schedule['close']],'seed':1729,'sampleCount':3}
metadata={'source':'Yahoo Finance chart snapshot; unofficial endpoint','symbol':result['meta']['symbol'],'currency':'GBP',
  'rawSha256':hashlib.sha256(raw).hexdigest(),'bars':len(bars),'firstSession':expected[0],'lastSession':expected[-1],
  'calendar':'exchange_calendars XLON '+xc.__version__,'missingSessions':missing,'problems':problems,'reportedActions':actions,
  'historyStatus':'READY_FOR_DIAGNOSTIC' if history_ok else 'BLOCKED_DATA_QUALITY',
  'forecastContext':'Last 128 consecutive sessions only; not a repair of failed historical data.',
  'recordedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
  'availability':'Assumed close + 5 minutes; not verified historical provider publication time.',
  'usage':'Private informational exploratory research; no commercial redistribution rights established.',
  'costs':'10 bps per side spread/slippage assumption; same-currency GBP, zero commission/FX/taxes assumed; not broker-verified.',
  'fundCharges':'Ongoing fund expenses embedded in traded fund price are not subtracted again.',
  'eligibility':'Public Trading 212 listing only; actual account and historical availability not verified.'}
destination=pathlib.Path(args.destination);destination.mkdir(parents=True,exist_ok=True)
outputs=[('forecast-input.json',forecast),('source-metadata.json',metadata)]
if history_ok: outputs.append(('diagnostic-input.json',diagnostic))
for name,content in outputs:
    with (destination/name).open('x') as f: json.dump(content,f,indent=2);f.write('\n')
print(json.dumps(metadata))

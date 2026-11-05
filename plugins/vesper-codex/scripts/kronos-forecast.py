#!/usr/bin/env python3
"""Optional, offline CPU model adapter. Reads JSON stdin, writes one JSON result.
No downloads, broker credentials or orders. Models must already exist locally.
"""
import argparse, contextlib, hashlib, json, math, os, pathlib, random, sys, time


def validate(payload):
    import datetime as dt
    def instant(value):
        if not isinstance(value, str): raise ValueError('Timestamp required')
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None: raise ValueError('Timezone required')
        return parsed
    bars, future = payload.get('bars', []), payload.get('futureSessions', [])
    if not 32 <= len(bars) <= 512 or not 1 <= len(future) <= 20: raise ValueError('Need 32-512 bars and 1-20 future sessions')
    if not isinstance(payload.get('instrumentId'), str) or not payload['instrumentId'].strip(): raise ValueError('Instrument identity required')
    times = []
    for b in bars:
        values = [b.get(k) for k in ['open','high','low','close','volume']]
        if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in values): raise ValueError('Finite OHLCV required')
        if min(values[:4]) <= 0 or values[4] < 0 or b['high'] < max(b['open'],b['close']) or b['low'] > min(b['open'],b['close']): raise ValueError('Incoherent OHLCV')
        if 'amount' in b and (isinstance(b['amount'],bool) or not isinstance(b['amount'],(int,float)) or not math.isfinite(b['amount']) or b['amount'] < 0): raise ValueError('Invalid amount')
        times.append(instant(b['time']))
    if any(a>=b for a,b in zip(times,times[1:])): raise ValueError('Bars must increase without duplicates')
    target = [instant(t) for t in future]
    if target[0] <= times[-1] or any(a>=b for a,b in zip(target,target[1:])): raise ValueError('Future sessions must follow input')
    for key,low,high,default in [('seed',0,2**32-1,1729),('sampleCount',1,10,3)]:
        v=payload.get(key,default)
        if isinstance(v,bool) or not isinstance(v,int) or not low<=v<=high: raise ValueError('Invalid '+key)
    return bars,future


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--tokenizer-dir', required=True)
    args=parser.parse_args()
    payload=json.load(sys.stdin)
    bars,future=validate(payload)
    for folder in [args.model_dir,args.tokenizer_dir]:
        if not all((pathlib.Path(folder)/f).is_file() for f in ['config.json','model.safetensors']): raise ValueError('Local model files unavailable')
    os.environ['HF_HUB_OFFLINE']='1'
    import numpy as np
    import pandas as pd
    import torch
    sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'vendor'))
    from kronos.model import Kronos,KronosTokenizer,KronosPredictor
    seed=payload.get('seed',1729); samples=payload.get('sampleCount',3)
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    torch.set_num_threads(2)
    torch.use_deterministic_algorithms(True)
    started=time.monotonic()
    with contextlib.redirect_stdout(sys.stderr):
        tokenizer=KronosTokenizer.from_pretrained(args.tokenizer_dir, local_files_only=True)
        model=Kronos.from_pretrained(args.model_dir, local_files_only=True)
    tokenizer.eval(); model.eval()
    predictor=KronosPredictor(model,tokenizer,device='cpu',max_context=512)
    df=pd.DataFrame(bars)
    # Keep upstream's amount proxy explicit. It is not observed traded turnover.
    if 'amount' not in df: df['amount']=df['volume']*df[['open','high','low','close']].mean(axis=1)
    timestamps=pd.Series(pd.to_datetime(df['time'],utc=True).dt.tz_localize(None))
    targets=pd.Series(pd.to_datetime(future,utc=True).tz_localize(None))
    with torch.inference_mode():
        prediction=predictor.predict(df,timestamps,targets,len(future),T=1.0,top_p=0.9,sample_count=samples,verbose=False)
    rows=[]; invalid=False
    for i,(_,row) in enumerate(prediction.iterrows()):
        record={k:float(row[k]) for k in ['open','high','low','close','volume','amount']}
        if not all(math.isfinite(v) for v in record.values()): raise ValueError('Nonfinite model output')
        if min(record[k] for k in ['open','high','low','close'])<=0 or record['high']<max(record['open'],record['close']) or record['low']>min(record['open'],record['close']) or record['volume']<0: invalid=True
        rows.append({'time':future[i],**record})
    def fingerprint(folder):
        return {f:hashlib.sha256((pathlib.Path(folder)/f).read_bytes()).hexdigest() for f in ['config.json','model.safetensors']}
    result={'version':'vigilalpha.kronos-forecast.v1','status':'INVALID_MODEL_OUTPUT' if invalid else 'FORECAST_ONLY_UNVALIDATED',
      'instrumentId':payload['instrumentId'],'dataCutoff':bars[-1]['time'],'inputSha256':hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
      'sourceCommit':'67b630e67f6a18c9e9be918d9b4337c960db1e9a','modelHashes':fingerprint(args.model_dir),'tokenizerHashes':fingerprint(args.tokenizer_dir),
      'seed':seed,'sampleCount':samples,'temperature':1.0,'topP':0.9,'device':'cpu','torchVersion':torch.__version__,
      'predictions':rows,'inferenceSeconds':time.monotonic()-started,'executionAuthority':'NONE','autoPromotion':False,
      'limitations':['Sample paths are averaged; not calibrated probability or confidence bounds.',
        'Training cutoff and historical contamination have not been independently verified.',
        'Source rights, future-session calendar, point-in-time availability and price adjustments require caller verification.',
        'Missing turnover is approximated by OHLC mean times volume; not observed turnover.',
        'No strategy, fees, FX or actual execution in this forecast.']}
    print(json.dumps(result,allow_nan=False))


if __name__=='__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'status':'UNAVAILABLE','reason':str(error),'executionAuthority':'NONE'}))
        sys.exit(2)

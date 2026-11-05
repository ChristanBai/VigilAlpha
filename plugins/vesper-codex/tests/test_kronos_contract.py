import copy, datetime as dt, importlib.util, pathlib, unittest

path=pathlib.Path(__file__).resolve().parents[1]/'scripts'/'kronos-forecast.py'
spec=importlib.util.spec_from_file_location('kronos_contract',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def payload():
    start=dt.datetime(2026,1,1,16,30,tzinfo=dt.timezone.utc)
    bars=[{'time':(start+dt.timedelta(days=i)).isoformat(),'open':100,'high':101,'low':99,'close':100,'volume':1000} for i in range(32)]
    return {'instrumentId':'SYNTHETIC','bars':bars,'futureSessions':[(start+dt.timedelta(days=32)).isoformat()],'seed':1729,'sampleCount':3}

class ModelContract(unittest.TestCase):
    def test_valid_contract_without_torch_or_weights(self):
        p=payload();before=copy.deepcopy(p);bars,future=module.validate(p)
        self.assertEqual(len(bars),32);self.assertEqual(len(future),1);self.assertEqual(p,before)
    def test_invalid_market_data(self):
        for key,value in [('close',None),('volume',-1),('open',True),('high',99),('low',101),('close',float('inf')),('amount',-1)]:
            with self.subTest(key=key,value=value):
                p=payload();p['bars'][0][key]=value
                with self.assertRaises(ValueError):module.validate(p)
    def test_time_order_and_future_isolation(self):
        p=payload();p['futureSessions']=[p['bars'][-1]['time']]
        with self.assertRaises(ValueError):module.validate(p)
        p=payload();p['bars'][1]['time']=p['bars'][0]['time']
        with self.assertRaises(ValueError):module.validate(p)
        p=payload();p['bars'][0]['time']='2026-01-01T16:30:00'
        with self.assertRaises(ValueError):module.validate(p)
    def test_limits_and_seeds(self):
        for key,value in [('bars',[]),('futureSessions',[]),('sampleCount',100),('seed',True),('seed',-1)]:
            p=payload();p[key]=value
            with self.assertRaises(ValueError):module.validate(p)

if __name__=='__main__':unittest.main()

"""Integration checks against an isolated SQLAlchemy SQLite database.
PostgreSQL deployment must separately be exercised with compose.
"""
import os,secrets,tempfile
from pathlib import Path
tmp=Path(tempfile.gettempdir())/('radar-check-'+secrets.token_hex(5)+'.db')
os.environ['DATABASE_URL']='sqlite:///'+tmp.as_posix()
os.environ['JWT_SECRET']=secrets.token_hex(32)
os.environ['DEMO_PASSWORD']=secrets.token_urlsafe(20)
from fastapi.testclient import TestClient
from .seed import main
from .api import app,engine,SessionLocal,Prediction,PredictionRelease,Intervention,Order
from .serving import published_snapshot, score_request, UnavailableRelease, LEGACY_VERSION
from .prediction_store import install_predictions
from sqlalchemy import delete, select, update, func
main()
client=TestClient(app)
assert client.get('/api/health').status_code==200
assert client.get('/api/customers').status_code in (401,403)
assert client.post('/api/auth/login',json={'email':'manager@radar.demo','password':'wrong'}).status_code==401
def login(name):
 r=client.post('/api/auth/login',json={'email':name+'@radar.demo','password':os.environ['DEMO_PASSWORD']});assert r.status_code==200,r.text
 return {'Authorization':'Bearer '+r.json()['access_token']}
manager=login('manager');analyst=login('analyst')
r=client.get('/api/customers?q=MM-14795',headers=manager);assert r.status_code==200 and r.json()['total']==1
assert client.get('/api/customers?page_size=500',headers=manager).status_code==422
data=client.get('/api/workspace',headers=manager).json();assert len(data['customers'])==5000 and len(data['orders'])>10000
assert client.get('/api/customers/4794',headers=manager).json()['orders']
payload={'customer_id':4794,'action':'Offer support','deadline':'2026-11-04','status':'Assigned','assignee':'Priya Nair','notes':'Test follow-up','outcome':'Not observed'}
assert client.post('/api/interventions',json=payload,headers=analyst).status_code==403
r=client.post('/api/interventions',json=payload,headers=manager);assert r.status_code==201,r.text
iid=r.json()['id'];payload.update(status='Contacted',notes='Customer response recorded')
assert client.put('/api/interventions/'+str(iid),json=payload,headers=manager).status_code==200
assert next(i for i in client.get('/api/interventions',headers=manager).json() if i['id']==iid)['notes']=='Customer response recorded'
payload['status']='Invalid';assert client.put('/api/interventions/'+str(iid),json=payload,headers=manager).status_code==422
cp=client.post('/api/campaigns',json={'name':'Synthetic check','type':'Reminder','risk':'High'},headers=manager);assert cp.status_code==201
r=client.post('/api/campaigns/'+str(cp.json()['id'])+'/simulate',headers=manager);assert r.status_code==200 and r.json()['simulated']
assert client.get('/api/reports/customers.csv',headers=manager).text.startswith('synthetic,')
legacy = client.post('/api/predict',headers=manager,json={'values':[1,3,30,3,0,0,0,2,-1,1800,600,90,.1,1]})
assert legacy.status_code == 200 and legacy.json()['model_version']==LEGACY_VERSION
assert 'API_MODE=true' in client.get('/config.js').text
assert client.post('/api/analytics/query',headers=manager,json={'metric':'product_inactivity','window':90}).json()['population']==1177
assert client.post('/api/analytics/query',headers=manager,json={'metric':'DROP TABLE customers','window':90}).status_code==422
snapshot = published_snapshot()
model = snapshot['model']
version = model['version']
assert version in {run['version'] for run in client.get('/api/training/runs',headers=analyst).json()}
assert client.get('/api/model',headers=analyst).json()==model

if model.get('schema_version') == 3:
 import numpy as np
 from .prediction import predict_probabilities
 from .serving import _artifact
 published = {c['id']:c for c in snapshot['customers']}
 eligible = [c for c in data['customers'] if c['probability'] is not None]
 for c in data['customers']:
  saved = published[c['id']]
  for key in ('features','score_reason','coverage_end','coverage_days','probability','model_version','contributions'):
   assert c[key]==saved[key], (c['id'],key)
 # Re-run the immutable model over every published eligible feature vector.
 names = model['features']
 predictions = predict_probabilities(_artifact(version,model['artifact_sha256']),
                                    [[c['features'][k] for k in names] for c in eligible])
 assert np.allclose(predictions,[c['probability'] for c in eligible], atol=.000006,rtol=0)
 for reason in ('model','covered_through_horizon'):
  record = next(c for c in eligible if c['score_reason']==reason)
  response = client.post('/api/predict',headers=manager,json={'features':record['features']})
  assert response.status_code==200,response.text
  assert response.json()['model_version']==version
  assert abs(response.json()['probability']-record['probability'])<.000006
  vector = [record['features'][k] for k in names]
  assert client.post('/api/predict',headers=manager,json={'values':vector,'model_version':version}).json()==response.json()
  assert client.post('/api/predict',headers=manager,json={'values':vector}).status_code==422
 assert client.post('/api/predict',headers=manager,json={'features':{}}).status_code==422
 assert client.post('/api/predict',headers=manager,json={'features':record['features'],'model_version':'unknown'}).status_code==422
 assert client.post('/api/predict',headers=manager,json={'features':{**record['features'],'coverage_days':-1}}).status_code==422
 try:
  score_request({**model,'artifact_sha256':'0'*64},features=record['features'])
 except UnavailableRelease:
  pass
 else:
  raise AssertionError('Artifact/report checksum mismatch accepted')

# A previously seeded database stores the old display name on score rows.
# Preserve its history and operator records, then install a snapshot exactly once.
with SessionLocal() as session:
 session.execute(delete(PredictionRelease))
 session.execute(update(Prediction).values(model='older deployment', probability=.125))
 session.commit()
 intervention_count = session.scalar(select(func.count()).select_from(Intervention))
 order = session.scalar(select(Order).limit(1))
 order.status = 'inconsistent'
 try:
  install_predictions(session,snapshot)
 except UnavailableRelease:
  session.rollback()
 else:
  raise AssertionError('Installing predictions on changed source data should fail')
 assert not session.scalars(select(PredictionRelease)).first()

active = client.get('/api/customers?page_size=1',headers=manager)
assert active.status_code==200,active.text
assert active.json()['total']==len(snapshot['customers'])
assert active.json()['items'][0]['prediction']['model']==version
detail = client.get('/api/customers/4794',headers=manager).json()
assert detail['current_prediction']['model']==version
assert {p['model'] for p in detail['predictions']}=={'older deployment',version}
assert next(i for i in client.get('/api/interventions',headers=manager).json() if i['id']==iid)['notes']=='Customer response recorded'
main()
with SessionLocal() as session:
 assert session.scalar(select(func.count()).select_from(Intervention))==intervention_count
 assert session.scalar(select(func.count()).select_from(Prediction))==2*len(snapshot['customers'])
 assert session.scalar(select(func.count()).select_from(PredictionRelease))==1
engine.dispose();tmp.unlink()
print('PASS: auth, operational workflows, model parity, legacy inference, provenance, idempotent score migration and preserved prediction history.')


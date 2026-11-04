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
from .api import app,engine
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
assert client.post('/api/predict',headers=manager,json={'values':[1,3,30,3,0,0,0,2,-1,1800,600,90,.1,1]}).status_code==200
assert 'API_MODE=true' in client.get('/config.js').text
assert client.post('/api/analytics/query',headers=manager,json={'metric':'product_inactivity','window':90}).json()['population']==1177
assert client.post('/api/analytics/query',headers=manager,json={'metric':'DROP TABLE customers','window':90}).status_code==422
assert client.get('/api/training/runs',headers=analyst).json()[0]['version'].startswith('rr2-')
engine.dispose();tmp.unlink()
print('PASS: login, auth denial, RBAC, filters, pagination validation, 5000 relational customers, histories, intervention create/update, campaign simulation, CSV and model prediction.')


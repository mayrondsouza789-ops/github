"""PostgreSQL-backed FastAPI API. Run `python -m backend.seed` before serving."""
import os, json, secrets, hashlib, hmac, pickle, csv, io
from datetime import datetime, timedelta, timezone, date
from pathlib import Path
from typing import Literal
import jwt
import numpy as np
from fastapi import FastAPI, Depends, HTTPException, Query, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey, Date, Text, Boolean, select, func
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

DATABASE_URL=os.environ.get('DATABASE_URL','postgresql+psycopg://radar:radar@localhost:5432/radar')
SECRET=os.environ.get('JWT_SECRET')
engine=create_engine(DATABASE_URL,pool_pre_ping=True)
SessionLocal=sessionmaker(engine,expire_on_commit=False)
class Base(DeclarativeBase): pass
class User(Base):
 __tablename__='users'
 id=Column(Integer,primary_key=True); email=Column(String,unique=True,nullable=False); password=Column(String,nullable=False); role=Column(String,nullable=False)
class Customer(Base):
 __tablename__='customers'
 id=Column(Integer,primary_key=True); code=Column(String,unique=True); name=Column(String); age=Column(String); channel=Column(String); registered=Column(Date); first=Column(Date); product_id=Column(ForeignKey('products.id')); synthetic=Column(Boolean,default=True)
class Product(Base):
 __tablename__='products'
 id=Column(Integer,primary_key=True); name=Column(String); cycle=Column(Integer); price=Column(Float)
class Order(Base):
 __tablename__='orders'
 id=Column(Integer,primary_key=True); customer_id=Column(ForeignKey('customers.id'),index=True); date=Column(Date); status=Column(String); amount=Column(Float)
class OrderItem(Base):
 __tablename__='order_items'
 id=Column(Integer,primary_key=True); order_id=Column(ForeignKey('orders.id')); product_id=Column(ForeignKey('products.id')); quantity=Column(Integer,default=1); unit_price=Column(Float)
class Engagement(Base):
 __tablename__='customer_engagement'
 id=Column(Integer,primary_key=True); customer_id=Column(ForeignKey('customers.id'),index=True); date=Column(Date); type=Column(String)
class Ticket(Base):
 __tablename__='support_tickets'
 id=Column(Integer,primary_key=True); customer_id=Column(ForeignKey('customers.id'),index=True); date=Column(Date); status=Column(String); subject=Column(String)
class Prediction(Base):
 __tablename__='churn_predictions'
 id=Column(Integer,primary_key=True); customer_id=Column(ForeignKey('customers.id'),index=True); date=Column(Date); probability=Column(Float,nullable=True); risk=Column(String); details=Column(Text); model=Column(String)
class Segment(Base):
 __tablename__='customer_segments'
 id=Column(Integer,primary_key=True); customer_id=Column(ForeignKey('customers.id')); segment=Column(String)
class Intervention(Base):
 __tablename__='retention_interventions'
 id=Column(Integer,primary_key=True); customer_id=Column(ForeignKey('customers.id')); action=Column(Text); assignee=Column(String); deadline=Column(Date); status=Column(String); notes=Column(Text); history=Column(Text,default='[]')
class Outcome(Base):
 __tablename__='intervention_outcomes'
 id=Column(Integer,primary_key=True); intervention_id=Column(ForeignKey('retention_interventions.id')); outcome=Column(String); recorded=Column(Date); observational=Column(Boolean,default=True)
class Campaign(Base):
 __tablename__='campaigns'
 id=Column(Integer,primary_key=True); name=Column(String); type=Column(String); risk=Column(String); simulated=Column(Boolean,default=True); results=Column(Text,default='{}')

app=FastAPI(title='Retention Radar',description='Synthetic customer retention demo. Not actual Man Matters intelligence.',version='1.0.0')
auth=HTTPBearer()
def db():
 with SessionLocal() as session: yield session
def password_hash(password,salt=None):
 salt=salt or secrets.token_hex(16)
 return salt+':'+hashlib.pbkdf2_hmac('sha256',password.encode(),salt.encode(),300000).hex()
def principal(cred:HTTPAuthorizationCredentials=Depends(auth),session:Session=Depends(db)):
 if not SECRET or len(SECRET)<32: raise HTTPException(503,'Set JWT_SECRET to at least 32 characters before enabling authentication.')
 try:
  payload=jwt.decode(cred.credentials,SECRET,algorithms=['HS256'],issuer='retention-radar',options={'require':['exp','sub','iss']}); user=session.get(User,int(payload['sub']))
  if user is None: raise ValueError()
  return user
 except (jwt.InvalidTokenError,ValueError): raise HTTPException(401,'Invalid or expired authentication token')
def editor(user:User=Depends(principal)):
 if user.role not in ['Retention Manager','Customer Success Executive']: raise HTTPException(403,'Role cannot modify interventions')
 return user
def serialize(obj): return {col.name:getattr(obj,col.name) for col in obj.__table__.columns}
class Login(BaseModel): email:str=Field(max_length=200); password:str=Field(max_length=200)
@app.post('/api/auth/login')
def login(body:Login,session:Session=Depends(db)):
 if not SECRET or len(SECRET)<32: raise HTTPException(503,'JWT_SECRET must contain at least 32 characters')
 user=session.scalar(select(User).where(User.email==body.email))
 if not user or not hmac.compare_digest(password_hash(body.password,user.password.split(':')[0]),user.password): raise HTTPException(401,'Invalid credentials')
 return {'access_token':jwt.encode({'sub':str(user.id),'iss':'retention-radar','exp':datetime.now(timezone.utc)+timedelta(hours=4)},SECRET,algorithm='HS256'),'token_type':'bearer','role':user.role}
@app.get('/api/health')
def health(): return {'status':'ok','synthetic':True}
@app.get('/config.js')
def config(): return Response('window.API_MODE=true;',media_type='application/javascript')
@app.get('/api/workspace')
def workspace(session:Session=Depends(db),user:User=Depends(principal)):
 metadata=json.loads((Path(__file__).parents[1]/'dist/data.json').read_text())
 predictions={p.customer_id:p for p in session.scalars(select(Prediction))}
 cs=[]
 for c in session.scalars(select(Customer).order_by(Customer.id)):
  p=predictions.get(c.id)
  cs.append(dict(id=c.id,code=c.code,name=c.name,age=c.age,channel=c.channel,registered=str(c.registered),first=str(c.first),product=c.product_id,probability=p.probability if p else None,risk=p.risk if p else 'Unscored',contributions=json.loads(p.details) if p else []))
 items={i.order_id:i for i in session.scalars(select(OrderItem))}
 metadata.update(customers=cs,products=[serialize(p) for p in session.scalars(select(Product).order_by(Product.id))],orders=[dict(id=o.id,customer=o.customer_id,product=items[o.id].product_id,date=str(o.date),status=o.status,amount=o.amount) for o in session.scalars(select(Order).order_by(Order.date,Order.id))],tickets=[dict(id=t.id,customer=t.customer_id,date=str(t.date),status=t.status,subject=t.subject) for t in session.scalars(select(Ticket))],engagements=[dict(customer=e.customer_id,date=str(e.date),type=e.type) for e in session.scalars(select(Engagement))])
 return metadata
@app.get('/api/me')
def me(user:User=Depends(principal)):return {'email':user.email,'role':user.role}
@app.get('/api/customers')
def list_customers(q:str='',risk:str|None=None,product:int|None=None,channel:str|None=None,page:int=Query(1,ge=1),page_size:int=Query(25,ge=1,le=100),session:Session=Depends(db),user:User=Depends(principal)):
 stmt=select(Customer,Prediction).join(Prediction,Prediction.customer_id==Customer.id)
 if q: stmt=stmt.where((Customer.name.ilike('%'+q+'%'))|(Customer.code.ilike('%'+q+'%')))
 if risk: stmt=stmt.where(Prediction.risk==risk)
 if product is not None: stmt=stmt.where(Customer.product_id==product)
 if channel: stmt=stmt.where(Customer.channel==channel)
 total=session.scalar(select(func.count()).select_from(stmt.subquery()))
 return {'synthetic':True,'page':page,'total':total,'items':[dict(**serialize(c),prediction=serialize(p)) for c,p in session.execute(stmt.order_by(Prediction.probability.desc()).offset((page-1)*page_size).limit(page_size))]}
@app.get('/api/customers/{cid}')
def customer(cid:int,session:Session=Depends(db),user:User=Depends(principal)):
 c=session.get(Customer,cid)
 if c is None: raise HTTPException(404,'Customer not found')
 result=serialize(c)
 for name,cls in [('orders',Order),('engagement',Engagement),('support',Ticket),('predictions',Prediction),('interventions',Intervention),('segments',Segment)]: result[name]=[serialize(x) for x in session.scalars(select(cls).where(cls.customer_id==cid))]
 return result
class InterventionBody(BaseModel):
 customer_id:int
 action:str=Field(min_length=1,max_length=2000)
 assignee:str=Field(default='Unassigned',max_length=100)
 deadline:date
 status:Literal['Pending','Assigned','In Progress','Contacted','Resolved','Unsuccessful']='Pending'
 notes:str=Field(default='',max_length=4000)
 outcome:Literal['Not observed','Resumed purchasing','Remained active','Churned','Customer responded','Customer opted out','Remained inactive']='Not observed'
def write_intervention(body,session,user,existing=None):
 if not session.get(Customer,body.customer_id): raise HTTPException(404,'Customer not found')
 obj=existing or Intervention();history=json.loads(obj.history or '[]');history.append({'at':datetime.now(timezone.utc).isoformat(),'by':user.email,'status':body.status,'notes':body.notes})
 for k,v in body.model_dump(exclude={'outcome'}).items(): setattr(obj,k,v)
 obj.history=json.dumps(history);session.add(obj);session.flush();session.add(Outcome(intervention_id=obj.id,outcome=body.outcome,recorded=date.today(),observational=True));session.commit();return serialize(obj)
@app.get('/api/interventions')
def interventions(session:Session=Depends(db),user:User=Depends(principal)):
 results=[]
 for i in session.scalars(select(Intervention).order_by(Intervention.id.desc()).limit(500)):
  out=session.scalar(select(Outcome).where(Outcome.intervention_id==i.id).order_by(Outcome.id.desc()))
  results.append(dict(**serialize(i),outcome=out.outcome if out else 'Not observed'))
 return results
class CampaignBody(BaseModel):
 name:str=Field(min_length=1,max_length=100)
 type:str=Field(max_length=100)
 risk:Literal['Low','Medium','High','Critical']
@app.get('/api/campaigns')
def campaign_list(session:Session=Depends(db),user:User=Depends(principal)):
 return [dict(id=c.id,name=c.name,type=c.type,risk=c.risk,created='2026-11-01',status='Simulated' if c.results!='{}' else 'Draft',**json.loads(c.results)) for c in session.scalars(select(Campaign))]
@app.post('/api/campaigns',status_code=201)
def campaign_create(body:CampaignBody,session:Session=Depends(db),user:User=Depends(editor)):
 c=Campaign(**body.model_dump(),simulated=True,results='{}');session.add(c);session.commit();return {'id':c.id}
@app.post('/api/campaigns/{cid}/simulate')
def campaign_simulate(cid:int,session:Session=Depends(db),user:User=Depends(editor)):
 c=session.get(Campaign,cid)
 if c is None:raise HTTPException(404,'Campaign not found')
 cs=list(session.scalars(select(Customer).join(Prediction,Prediction.customer_id==Customer.id).where(Prediction.risk==c.risk)))
 contacted=[x for x in cs if x.id%10];delivered=[x for x in contacted if x.id%13];clicked=[x for x in delivered if x.id%4==0];converted=[x for x in clicked if x.id%3==0]
 prices={p.id:p.price for p in session.scalars(select(Product))}
 c.results=json.dumps(dict(targeted=len(cs),contacted=len(contacted),delivered=len(delivered),clicks=len(clicked),conversions=len(converted),revenue=sum(prices[x.product_id] for x in converted),cost=len(contacted)*.75));session.commit();return {'simulated':True,**json.loads(c.results)}
@app.post('/api/interventions',status_code=201)
def create_intervention(body:InterventionBody,session:Session=Depends(db),user:User=Depends(editor)):return write_intervention(body,session,user)
@app.put('/api/interventions/{iid}')
def update_intervention(iid:int,body:InterventionBody,session:Session=Depends(db),user:User=Depends(editor)):
 obj=session.get(Intervention,iid)
 if obj is None: raise HTTPException(404,'Intervention not found')
 return write_intervention(body,session,user,obj)
@app.get('/api/model')
def model(user:User=Depends(principal)):return json.loads((Path(__file__).parents[1]/'dist/data.json').read_text())['model']
class FeatureBody(BaseModel):
 values:list[float]=Field(min_length=14,max_length=14)
@app.post('/api/predict')
def predict(body:FeatureBody,user:User=Depends(editor)):
 if not all(np.isfinite(body.values)):raise HTTPException(422,'All feature values must be finite')
 with (Path(__file__).parent/'model.pkl').open('rb') as f: artifact=pickle.load(f)
 return {'synthetic':True,'probability':float(artifact['calibrator'].predict_proba(artifact['model'].predict_proba([body.values])[:,1,None])[0,1]),'horizon':artifact.get('horizon',30),'feature_order':artifact['features']}
@app.get('/api/reports/customers.csv')
def report(session:Session=Depends(db),user:User=Depends(principal)):
 stream=io.StringIO();writer=csv.writer(stream);writer.writerow(['synthetic','id','name','probability','risk'])
 for c,p in session.execute(select(Customer,Prediction).join(Prediction,Prediction.customer_id==Customer.id)):
  safe=c.name if not c.name.startswith(('=','+','-','@')) else "'"+c.name
  writer.writerow([True,c.code,safe,p.probability,p.risk])
 return Response(stream.getvalue(),media_type='text/csv',headers={'Content-Disposition':'attachment; filename=synthetic-customers.csv'})

# Restricted analytics and background candidate training.
from fastapi import BackgroundTasks
import subprocess, sys, threading, logging
from .analytics import query as analytical_query
training_lock=threading.Lock()
class AnalyticsRequest(BaseModel):
 metric:Literal['product_inactivity','prioritise','monthly_orders']
 window:int=Field(default=90,ge=1,le=365)
@app.post('/api/analytics/query')
def analytics_query(body:AnalyticsRequest,session:Session=Depends(db),user:User=Depends(principal)):
 return analytical_query(workspace(session,user),body.metric,body.window)
@app.get('/api/training/runs')
def training_runs(user:User=Depends(principal)):
 return [json.loads(p.read_text()) for p in sorted((Path(__file__).parent/'runs').glob('*/report.json'),reverse=True)]
def train_candidate():
 try:
  result=subprocess.run([sys.executable,'-m','backend.train_v2'],cwd=Path(__file__).parents[1],capture_output=True,text=True,timeout=600)
  logging.getLogger('retention-radar').info('Candidate training exit status %s',result.returncode)
 finally:training_lock.release()
@app.post('/api/training/runs',status_code=202)
def start_training(background:BackgroundTasks,user:User=Depends(principal)):
 if user.role not in ['Retention Manager','Business Analyst']:raise HTTPException(403,'Role cannot train models')
 if not training_lock.acquire(blocking=False):raise HTTPException(409,'A training run is already active')
 background.add_task(train_candidate)
 return {'status':'queued','promotion':'manual only; active model unchanged'}

# Serve the same frontend through FastAPI. It remains browser-local unless adapted
# to the authenticated API endpoints; no hosted role selector is treated as auth.
from fastapi.staticfiles import StaticFiles
app.mount('/',StaticFiles(directory=Path(__file__).parents[1]/'dist',html=True),name='frontend')

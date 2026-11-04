"""Reproducible synthetic longitudinal data and leakage-aware churn experiment."""
import json, random, math
from pathlib import Path
from datetime import date, timedelta
import numpy as np
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import precision_score, recall_score, f1_score, roc_auc_score, average_precision_score, confusion_matrix, brier_score_loss
from sklearn.calibration import calibration_curve
import pickle
import argparse

parser=argparse.ArgumentParser()
parser.add_argument('--horizon',type=int,choices=[30,60,90],default=30)
parser.add_argument('--grace',type=int,default=14)
args=parser.parse_args()
if not 0<=args.grace<=90: parser.error('grace must be 0–90 days')

ROOT=Path(__file__).resolve().parents[1]
ASOF=date(2026,11,1)
random.seed(42)
rng=np.random.default_rng(42)
products=[dict(id=i,name=n,cycle=c,price=p) for i,(n,c,p) in enumerate([('Minoxidil',30,699),('Hair gummies',30,599),('DHT shampoo',45,399),('Haircare kit',60,1499),('Scalp treatment',40,899),('Hair serum',50,799)])]
customers=[]; orders=[]; tickets=[]; engagements=[]
names=['Aarav','Vivaan','Aditya','Arjun','Ishaan','Kabir','Rohan','Rahul','Dev','Karan','Nikhil','Siddharth','Varun','Amit','Ankit','Pranav','Rishabh','Vikram','Sahil','Yash']
lastnames=['Sharma','Mehta','Patel','Rao','Singh','Shah','Iyer','Gupta','Verma','Joshi','Nair','Kapoor']
for i in range(5000):
 p=products[random.randrange(6)]; first=ASOF-timedelta(days=random.randint(7,364)); loyalty=random.betavariate(3,2); t=first; ix=[]
 while t<ASOF:
  status=random.choices(['completed','cancelled','refunded'],[92,5,3])[0]
  o=dict(id=len(orders)+1,customer=i,product=p['id'],date=str(t),status=status,amount=round(p['price']*random.choice([1,1,.9,.85])))
  orders.append(o); ix.append(o)
  if random.random()>loyalty*.8+.15: break
  t+=timedelta(days=max(10,int(p['cycle']*random.uniform(.75,1.65))))
 complaint=random.random()<.16
 if complaint: tickets.append(dict(id=len(tickets)+1,customer=i,date=str(min(ASOF-timedelta(days=1),first+timedelta(days=random.randint(1,40)))),status=random.choice(['Open','Resolved']),subject=random.choice(['Delivery delay','Usage difficulty','Product dissatisfaction'])))
 for _ in range(random.randint(1,7)):
  engagements.append(dict(customer=i,date=str(first+timedelta(days=random.randint(0,(ASOF-first).days-1))),type=random.choice(['Website visit','Email opened','Education clicked'])))
 customers.append(dict(id=i,code=f'MM-{10001+i}',name=f'{random.choice(names)} {random.choice(lastnames)}',age=random.choice(['18–24','25–34','35–44','45+']),registered=str(first-timedelta(days=random.randint(0,5))),first=str(first),product=p['id'],channel=random.choice(['Organic','Meta Ads','Google Ads','Referral','Influencer'])))

byorders={i:[] for i in range(5000)}; bytickets={i:[] for i in range(5000)}; byevents={i:[] for i in range(5000)}
for o in orders: byorders[o['customer']].append(o)
for t in tickets: bytickets[t['customer']].append(t)
for e in engagements: byevents[e['customer']].append(e)
FEATURES=['overdue_ratio','order_count','frequency_ratio','cancellations','refunds','open_tickets','engagement_30d','spend','tenure']
def features(c,when):
 os=[o for o in byorders[c['id']] if o['date']<str(when)]; completed=[o for o in os if o['status']=='completed']
 if not completed: return None
 cycle=products[c['product']]['cycle']; last=date.fromisoformat(completed[-1]['date']); gaps=[(date.fromisoformat(b['date'])-date.fromisoformat(a['date'])).days for a,b in zip(completed,completed[1:])]
 return [(when-last).days/cycle-1,len(completed),np.mean(gaps)/cycle if gaps else 1,sum(o['status']=='cancelled' for o in os),sum(o['status']=='refunded' for o in os),sum(t['date']<str(when) and t['status']=='Open' for t in bytickets[c['id']]),sum(str(when-timedelta(days=30))<=e['date']<str(when) for e in byevents[c['id']]),sum(o['amount'] for o in completed),(when-date.fromisoformat(c['first'])).days]

# Disjoint calendar blocks and customer groups. All labels mature before next split.
# Churn at horizon = no repeat by expected refill + grace, observed at cutoff+30.
blocks=[(date(2026,3,1),date(2026,5,1),0,3000),(date(2026,6,1),date(2026,7,1),3000,4000),(date(2026,8,1),date(2026,9,1),4000,5000)]
if args.horizon!=30:
 blocks=[(date(2026,1,15),date(2026,1,15),0,3000),(date(2026,4,20),date(2026,4,20),3000,4000),(date(2026,7,25),date(2026,7,25),4000,5000)]
splits=[]
for start,end,lo,hi in blocks:
 rows=[]; labels=[]
 for c in customers[lo:hi]:
  when=start+timedelta(days=c['id']%((end-start).days+1)); f=features(c,when)
  if f is None: continue
  last=max(date.fromisoformat(o['date']) for o in byorders[c['id']] if o['date']<str(when) and o['status']=='completed')
  deadline=last+timedelta(days=products[c['product']]['cycle']+args.grace)
  horizon=when+timedelta(days=args.horizon)
  if deadline>horizon: continue # not eligible to miss a refill within horizon
  repeat=any(str(when)<=o['date']<=str(horizon) and o['status']=='completed' for o in byorders[c['id']])
  rows.append(f); labels.append(int(not repeat))
 splits.append((np.array(rows),np.array(labels)))
(xt,yt),(xv,yv),(xs,ys)=splits
models={'Logistic regression':make_pipeline(SimpleImputer(),StandardScaler(),LogisticRegression(max_iter=1000,class_weight='balanced')),'Random forest':make_pipeline(SimpleImputer(),RandomForestClassifier(n_estimators=100,max_depth=7,min_samples_leaf=15,class_weight='balanced',random_state=42))}
for model in models.values(): model.fit(xt,yt)
best=max(models,key=lambda k:average_precision_score(yv,models[k].predict_proba(xv)[:,1])); model=models[best]
vp=model.predict_proba(xv)[:,1]; threshold=max(np.arange(.15,.8,.025),key=lambda t:f1_score(yv,vp>=t))
def evaluate(m):
 prob=m.predict_proba(xs)[:,1]; pred=prob>=threshold; obs,forecast=calibration_curve(ys,prob,n_bins=7)
 return dict(precision=precision_score(ys,pred,zero_division=0),recall=recall_score(ys,pred),f1=f1_score(ys,pred),roc_auc=roc_auc_score(ys,prob),pr_auc=average_precision_score(ys,prob),brier=brier_score_loss(ys,prob),confusion=confusion_matrix(ys,pred).tolist(),calibration=list(zip(forecast.tolist(),obs.tolist())))
metrics={k:evaluate(m) for k,m in models.items()}
fallback=np.median(xt,axis=0)
current_features=[features(c,ASOF) for c in customers]
scorable=[i for i,f in enumerate(current_features) if f is not None]
matrix=np.array([current_features[i] for i in scorable]); probabilities=model.predict_proba(matrix)[:,1]
sensitivities=[]
for j in range(len(FEATURES)):
 altered=matrix.copy(); altered[:,j]=fallback[j];sensitivities.append(probabilities-model.predict_proba(altered)[:,1])
for c in customers:c.update(probability=None,contributions=[],risk='Unscored')
for row,i in enumerate(scorable):
 c=customers[i];f=current_features[i];p=float(probabilities[row]);effects=[dict(feature=FEATURES[j],effect=round(float(sensitivities[j][row]),4),value=round(float(f[j]),2)) for j in range(len(FEATURES))]
 c.update(probability=round(p,4),features=dict(zip(FEATURES,[round(float(v),3) for v in f])),contributions=sorted(effects,key=lambda e:e['effect'],reverse=True),risk='Critical' if p>=.8 else 'High' if p>=.6 else 'Medium' if p>=.35 else 'Low')
data=dict(asOf=str(ASOF),synthetic=True,customers=customers,products=products,orders=orders,tickets=tickets,engagements=engagements,model=dict(selected=best,trained=str(date.today()),horizon=args.horizon,grace=args.grace,threshold=round(float(threshold),3),metrics=metrics,features=FEATURES,unavailable=['App activity','Review sentiment','Subscription cancellations','Discount dependency'],splitCounts=[len(y) for _,y in splits],splitDates=['Mar–May 2026','Jun–Jul 2026','Aug–Sep 2026'],explanation='One-feature replacement sensitivity against training medians; correlated features may share effects. These are model associations, not causes.',target=f'No completed repeat purchase by the {args.horizon}-day horizon for customers whose product-specific refill date plus {args.grace}-day grace falls within that horizon.'))
(ROOT/'dist'/'data.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
with (ROOT/'backend'/'model.pkl').open('wb') as out: pickle.dump(dict(model=model,features=FEATURES,median=fallback),out)
print(json.dumps(dict(customers=len(customers),orders=len(orders),splitCounts=data['model']['splitCounts'],selected=best,metrics=metrics)))

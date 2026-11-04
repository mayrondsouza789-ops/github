"""Candidate-only incident inactivity training. Explicit promotion; immutable run registry."""
import json, pickle, argparse, hashlib
from pathlib import Path
from datetime import date, timedelta, datetime, timezone
from collections import defaultdict
import numpy as np
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.calibration import calibration_curve
from sklearn.metrics import precision_score,recall_score,f1_score,roc_auc_score,average_precision_score,confusion_matrix,brier_score_loss

ROOT=Path(__file__).resolve().parents[1]
FEATURES=['recency_ratio','order_count','average_interval','interval_variability','cancellations','refund_rate','ticket_count','engagement_30d','engagement_change','spend','average_order_value','tenure','discount_fraction','category_diversity']
def build(data):
 orders=defaultdict(list);events=defaultdict(list);tickets=defaultdict(list)
 for o in data['orders']:orders[o['customer']].append(o)
 for e in data['engagements']:events[e['customer']].append(e)
 for t in data['tickets']:tickets[t['customer']].append(t)
 for os in orders.values():os.sort(key=lambda o:o['date'])
 return orders,events,tickets,{p['id']:p for p in data['products']}
def validate(d):
 ids={c['id'] for c in d['customers']};products={p['id'] for p in d['products']};seen=set();issues=[]
 if len(ids)!=len(d['customers']):issues.append('Duplicate customer identifiers')
 for o in d['orders']:
  if o['id'] in seen:issues.append('Duplicate order identifier')
  seen.add(o['id'])
  if o['customer'] not in ids or o['product'] not in products:issues.append('Broken order reference')
  if o['status'] not in ['completed','cancelled','refunded']:issues.append('Invalid order status')
  try:
   if date.fromisoformat(o['date'])>=date.fromisoformat(d['asOf']):issues.append('Order outside observation window')
  except ValueError:issues.append('Invalid timestamp')
  if o['amount']<0:issues.append('Negative order amount')
 if any(p['cycle']<=0 for p in d['products']):issues.append('Invalid product cycle')
 return sorted(set(issues))
def snapshot(c,when,index,grace=14):
 orders,events,tickets,products=index;os=[o for o in orders[c['id']] if o['date']<str(when)];done=[o for o in os if o['status']=='completed']
 if not done:return None,None
 last=done[-1];cycle=products[last['product']]['cycle'];recency=(when-date.fromisoformat(last['date'])).days
 deadline=date.fromisoformat(last['date'])+timedelta(days=cycle+grace)
 gaps=np.array([(date.fromisoformat(b['date'])-date.fromisoformat(a['date'])).days for a,b in zip(done,done[1:])])
 recent=sum(str(when-timedelta(days=30))<=e['date']<str(when) for e in events[c['id']]);previous=sum(str(when-timedelta(days=60))<=e['date']<str(when-timedelta(days=30)) for e in events[c['id']]);spend=sum(o['amount'] for o in done)
 return [recency/cycle,len(done),float(gaps.mean()) if len(gaps) else np.nan,float(gaps.std()) if len(gaps) else np.nan,sum(o['status']=='cancelled' for o in os),sum(o['status']=='refunded' for o in os)/len(os),sum(t['date']<str(when) for t in tickets[c['id']]),recent,recent-previous,spend,spend/len(done),(when-date.fromisoformat(done[0]['date'])).days,np.mean([1-o['amount']/products[o['product']]['price'] for o in done]),len({o['product'] for o in done})],deadline
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--promote',action='store_true');parser.add_argument('--horizon',type=int,choices=[30,60,90],default=30);args=parser.parse_args()
 d=json.loads((ROOT/'dist/data.json').read_text());issues=validate(d)
 if issues:raise ValueError('Data validation failed: '+', '.join(issues))
 idx=build(d);asof=date.fromisoformat(d['asOf']);splits=[];meta=[]
 dates=[date(2026,1,15),date(2026,4,20),date(2026,7,25)] if args.horizon>30 else [date(2026,4,1),date(2026,6,15),date(2026,9,1)]
 for k,when in enumerate(dates):
  rows=[];ys=[];groups=[]
  for c in d['customers']:
   if c['id']%5 not in ([0,1,2] if k==0 else [3] if k==1 else [4]):continue
   f,deadline=snapshot(c,when,idx)
   if f is None or deadline<when:continue # incident risk only, not already inactive
   end=when+timedelta(days=args.horizon)
   future=[o for o in idx[0][c['id']] if str(when)<=o['date']<=str(end) and o['status']=='completed']
   inactive=False;coverage=deadline
   for o in future:
    od=date.fromisoformat(o['date'])
    if od>coverage:inactive=True
    coverage=max(coverage,od+timedelta(days=idx[3][o['product']]['cycle']+14))
   inactive=inactive or coverage<end
   rows.append(f);ys.append(int(inactive));groups.append(c['product'])
  splits.append((np.array(rows),np.array(ys)));meta.append(groups)
 (xt,yt),(xv,yv),(xs,ys)=splits
 models={'Logistic regression':make_pipeline(SimpleImputer(add_indicator=True),StandardScaler(),LogisticRegression(class_weight='balanced',max_iter=1500)),'Random forest':make_pipeline(SimpleImputer(add_indicator=True),RandomForestClassifier(n_estimators=150,max_depth=6,min_samples_leaf=12,class_weight='balanced',random_state=42)),'Gradient boosting':make_pipeline(SimpleImputer(add_indicator=True),GradientBoostingClassifier(n_estimators=80,max_depth=2,random_state=42))}
 validation={}
 for name,m in models.items():m.fit(xt,yt);validation[name]=float(average_precision_score(yv,m.predict_proba(xv)[:,1]))
 best=max(validation,key=validation.get);model=models[best]
 # Platt calibration fitted only to validation predictions; held-out test remains untouched.
 calibrator=LogisticRegression(C=1);calibrator.fit(model.predict_proba(xv)[:,1,None],yv)
 def probability(x):return calibrator.predict_proba(model.predict_proba(x)[:,1,None])[:,1]
 threshold=.5
 def score(p,y):
  pred=p>=threshold;obs,forecast=calibration_curve(y,p,n_bins=6);n=max(1,int(len(y)*.2));top=np.argsort(-p)[:n];base=float(np.mean(y))
  return dict(precision=float(precision_score(y,pred,zero_division=0)),recall=float(recall_score(y,pred,zero_division=0)),f1=float(f1_score(y,pred,zero_division=0)),roc_auc=float(roc_auc_score(y,p)) if len(set(y))>1 else None,pr_auc=float(average_precision_score(y,p)),brier=float(brier_score_loss(y,p)),confusion=confusion_matrix(y,pred,labels=[0,1]).tolist(),calibration=list(zip(forecast.tolist(),obs.tolist())),precision_at_k=float(y[top].mean()),recall_at_k=float(y[top].sum()/max(1,y.sum())),lift=float(y[top].mean()/max(.001,base)),capacity=n,population=len(y))
 ptest=probability(xs);metrics={name:score(m.predict_proba(xs)[:,1],ys) for name,m in models.items()};metrics[best]=score(ptest,ys)
 gate=metrics[best]['brier']<=float(np.mean((ys-yt.mean())**2)) and metrics[best]['pr_auc']>=float(ys.mean())
 version='rr2-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');run=ROOT/'backend/runs'/version;run.mkdir(parents=True)
 report=dict(version=version,selected=best,trained=datetime.now(timezone.utc).isoformat(),dataset_version=hashlib.sha256((ROOT/'dist/data.json').read_bytes()).hexdigest()[:12],horizon=args.horizon,grace=14,threshold=threshold,features=FEATURES,metrics=metrics,validation=validation,splitCounts=[len(y) for _,y in splits],splitDates=[str(x) for x in dates],target=f'First commercial inactivity episode within {args.horizon} days among currently active purchasers. Product-specific refill date plus 14-day grace; future orders extend coverage.',explanation='Signed one-feature replacement sensitivity against training medians, through the calibrated model. Associations are not causes.',unavailable=['SKU and pack size','Multi-item orders','Subscriptions','App activity','Timestamped support resolution','Confirmed treatment discontinuation'],accepted=gate,quality={'issues':issues,'orders':len(d['orders']),'customers':len(d['customers'])},subgroups=[])
 for product in d['products']:
  mask=np.array(meta[2])==product['id']
  if mask.sum():report['subgroups'].append(dict(product=product['name'],**score(ptest[mask],ys[mask])))
 med=np.nanmedian(xt,axis=0);current=[];eligible=[]
 for c in d['customers']:
  f,deadline=snapshot(c,asof,idx);c['commercial_status']='No completed orders' if f is None else 'Inactive' if deadline<asof else 'Active';c['probability']=None;c['contributions']=[];c['risk']='Unscored';c['prediction_timestamp']=str(asof);c['model_version']=version
  if f is not None and deadline>=asof:current.append(f);eligible.append(c)
 matrix=np.array(current);ps=probability(matrix);effects=[]
 for j in range(len(FEATURES)):
  alt=matrix.copy();alt[:,j]=med[j];effects.append(ps-probability(alt))
 for i,c in enumerate(eligible):
  p=float(ps[i]);c['probability']=round(p,5);c['risk']='Critical' if p>=.8 else 'High' if p>=.6 else 'Medium' if p>=.35 else 'Low';c['contributions']=sorted([dict(feature=f,effect=round(float(effects[j][i]),5),value=None if np.isnan(matrix[i,j]) else float(matrix[i,j])) for j,f in enumerate(FEATURES)],key=lambda e:abs(e['effect']),reverse=True)
 report['monitoring']=[dict(feature=f,missing_rate=float(np.isnan(matrix[:,j]).mean()),standardised_shift=float(abs(np.nanmean(matrix[:,j])-np.nanmean(xt[:,j]))/max(.01,np.nanstd(xt[:,j])))) for j,f in enumerate(FEATURES)]
 report['scored']=len(eligible);report['forecast']={'expected':float(ps.sum()),'lower':float(np.quantile(np.random.default_rng(42).binomial(1,ps,(1500,len(ps))).sum(axis=1),.025)),'upper':float(np.quantile(np.random.default_rng(42).binomial(1,ps,(1500,len(ps))).sum(axis=1),.975)),'method':'95% conditional Poisson-binomial simulation interval; assumes independent customers and fixed calibrated probabilities. Excludes parameter uncertainty and domain shift.'}
 (run/'report.json').write_text(json.dumps(report,indent=2));artifact=dict(model=model,calibrator=calibrator,features=FEATURES,median=med,horizon=args.horizon,version=version)
 with (run/'model.pkl').open('wb') as f:pickle.dump(artifact,f)
 if args.promote:
  if not gate:raise RuntimeError('Candidate failed baseline PR-AUC/Brier acceptance gates; active model unchanged.')
  d['model']=report;(ROOT/'dist/data.json').write_text(json.dumps(d,separators=(',',':')))
  with (ROOT/'backend/model.pkl').open('wb') as f:pickle.dump(artifact,f)
 print(json.dumps({'version':version,'accepted':gate,'promoted':args.promote,'test':metrics[best],'scored':len(eligible)}))
if __name__=='__main__':main()

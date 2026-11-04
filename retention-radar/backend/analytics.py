"""Approved analytical query catalogue. No SQL or model-generated code is accepted."""
from datetime import date,timedelta
from collections import defaultdict

CATALOGUE={'product_inactivity','prioritise','monthly_orders'}
def query(data,metric,window=90):
 if metric not in CATALOGUE:raise ValueError('Metric is not in the approved catalogue')
 asof=date.fromisoformat(data['asOf']);start=asof-timedelta(days=window);products={p['id']:p for p in data['products']};orders=defaultdict(list)
 for o in data['orders']:
  if o['status']=='completed':orders[o['customer']].append(o)
 population=[c for c in data['customers'] if date.fromisoformat(c['first'])>=start];rows=[]
 if metric=='product_inactivity':
  for pid,p in products.items():
   cs=[c for c in population if c['product']==pid];eligible=[c for c in cs if orders[c['id']]]
   inactive=sum((asof-max(date.fromisoformat(o['date']) for o in orders[c['id']])).days>p['cycle']+14 for c in eligible)
   rows.append({'product':p['name'],'customers':len(cs),'purchasers':len(eligible),'inactive':inactive,'rate':inactive/max(1,len(eligible))})
  definition='Purchasers beyond product-specific consumption cycle plus 14-day grace.'
 elif metric=='prioritise':
  for c in population:
   if c['probability'] is not None:rows.append({'customer':c['code'],'probability':c['probability'],'historical_exposure':sum(o['amount'] for o in orders[c['id']])*c['probability']})
  rows=sorted(rows,key=lambda r:r['historical_exposure'],reverse=True)[:50];definition='Probability × completed historical revenue; not expected intervention benefit.'
 else:
  months=defaultdict(int)
  for o in data['orders']:
   if o['status']=='completed' and str(start)<=o['date']<str(asof):months[o['date'][:7]]+=1
  rows=[{'month':m,'orders':n} for m,n in sorted(months.items())];definition='Completed orders by calendar month within observation range.'
 return {'synthetic':True,'metric':metric,'from':str(start),'to':str(asof),'population':len(population),'definition':definition,'rows':rows}

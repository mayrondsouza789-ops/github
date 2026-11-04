import os,json
from datetime import date
from pathlib import Path
from sqlalchemy import select
from .api import Base,engine,SessionLocal,User,Product,Customer,Order,OrderItem,Ticket,Engagement,Prediction,Segment,Intervention,Campaign,password_hash
def main():
 Base.metadata.create_all(engine)
 data=json.loads((Path(__file__).parents[1]/'dist/data.json').read_text())
 with SessionLocal() as s:
  if s.scalar(select(Customer.id).limit(1)) is not None: print('Database already seeded; no records changed.');return
  password=os.environ.get('DEMO_PASSWORD')
  if not password or len(password)<12:raise RuntimeError('Set DEMO_PASSWORD to at least 12 characters')
  for i,role in enumerate(['Retention Manager','Business Analyst','Customer Success Executive']):s.add(User(email=['manager','analyst','success'][i]+'@radar.demo',password=password_hash(password),role=role))
  s.add_all([Product(**p) for p in data['products']]);s.flush()
  for c in data['customers']:s.add(Customer(id=c['id'],code=c['code'],name=c['name'],age=c['age'],channel=c['channel'],registered=date.fromisoformat(c['registered']),first=date.fromisoformat(c['first']),product_id=c['product']))
  s.flush()
  for o in data['orders']:s.add(Order(id=o['id'],customer_id=o['customer'],date=date.fromisoformat(o['date']),status=o['status'],amount=o['amount']))
  s.flush()
  s.add_all([OrderItem(order_id=o['id'],product_id=o['product'],quantity=1,unit_price=o['amount']) for o in data['orders']])
  s.add_all([Ticket(id=t['id'],customer_id=t['customer'],date=date.fromisoformat(t['date']),status=t['status'],subject=t['subject']) for t in data['tickets']])
  s.add_all([Engagement(customer_id=e['customer'],date=date.fromisoformat(e['date']),type=e['type']) for e in data['engagements']])
  for c in data['customers']:
   s.add(Prediction(customer_id=c['id'],date=date.fromisoformat(data['asOf']),probability=c['probability'],risk=c['risk'],details=json.dumps(c.get('contributions',[])),model=data['model']['selected']))
   s.add(Segment(customer_id=c['id'],segment='At-Risk' if c['risk'] in ['High','Critical'] else 'Active'))
  for c in sorted(data['customers'],key=lambda c:c['probability'] or 0,reverse=True)[:14]:s.add(Intervention(customer_id=c['id'],action='Review missed refill and offer support',assignee='Unassigned',deadline=date(2026,11,4),status='Pending',notes='Synthetic demonstration record',history='[]'))
  s.add(Campaign(name='Refill reminder demonstration',type='Replenishment reminder',risk='High',simulated=True))
  s.commit()
 print('Seeded 5,000 synthetic customers and relational histories.')
if __name__=='__main__':main()

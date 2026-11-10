"""Install an immutable score snapshot onto its matching demo database."""
from collections import Counter
from datetime import date
import json

from sqlalchemy import insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .serving import UnavailableRelease


def _verify_source(session, data):
    from .api import Customer, Product, Order, OrderItem, Ticket, Engagement

    def compare(name, actual, expected):
        if Counter(actual) != Counter(expected):
            raise UnavailableRelease(f'Database {name} differ from the released synthetic snapshot. '
                                     'Restore its matching histories or score the changed data first.')

    compare('customers', ((c.id, c.code, c.product_id, str(c.first), c.channel, c.synthetic)
                          for c in session.scalars(select(Customer))),
            ((c['id'], c['code'], c['product'], c['first'], c['channel'], True) for c in data['customers']))
    compare('products', session.execute(select(Product.id, Product.cycle, Product.price)).tuples(),
            ((p['id'], p['cycle'], p['price']) for p in data['products']))
    order_rows = session.execute(select(Order.id, Order.customer_id, Order.date, Order.status,
                                        Order.amount, OrderItem.product_id)
                                 .outerjoin(OrderItem, OrderItem.order_id == Order.id))
    compare('orders', ((i, c, str(day), status, amount, pid) for i, c, day, status, amount, pid in order_rows),
            ((o['id'], o['customer'], o['date'], o['status'], o['amount'], o['product']) for o in data['orders']))
    compare('support events', ((t.id, t.customer_id, str(t.date)) for t in session.scalars(select(Ticket))),
            ((t['id'], t['customer'], t['date']) for t in data['tickets']))
    compare('engagement events', ((e.customer_id, str(e.date), e.type) for e in session.scalars(select(Engagement))),
            ((e['customer'], e['date'], e['type']) for e in data['engagements']))


def install_predictions(session, data):
    """The caller commits the score rows and the publication marker together."""
    from .api import Prediction, PredictionRelease

    version = data['model']['version']
    as_of = date.fromisoformat(data['asOf'])
    if session.get(PredictionRelease, (version, as_of)) is not None:
        return False
    dialect = session.get_bind().dialect.name
    claim = {'postgresql': pg_insert, 'sqlite': sqlite_insert}[dialect](PredictionRelease)
    claim = (claim.values(model=version, as_of=as_of)
             .on_conflict_do_nothing(index_elements=['model','as_of']).returning(PredictionRelease.model))
    if session.scalar(claim) is None:
        return False
    _verify_source(session, data)
    rows = []
    for customer in data['customers']:
        if customer.get('model_version') != version or customer.get('prediction_timestamp') != data['asOf']:
            raise UnavailableRelease('One or more released scores have inconsistent provenance.')
        rows.append(dict(customer_id=customer['id'], date=as_of, probability=customer['probability'],
                         risk=customer['risk'], model=version, details=json.dumps(customer['contributions'])))
    session.execute(insert(Prediction).execution_options(render_nulls=True), rows)
    return True

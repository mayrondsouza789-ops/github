"""Synthetic demo dataset generator for Retention Radar.

EVERYTHING produced here is SYNTHETIC. It does not represent real Man Matters customers.

Customers have hidden latent traits (loyalty, satisfaction, price sensitivity, engagement) that drive
purchase timing, dropout, cancellations, refunds, complaints and engagement. The traits are never
stored in the database, so the churn model has to infer risk from observable behaviour only.
"""
import bisect
import hashlib
import sys
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
from app.config import AS_OF, DATA_START, SEED, N_CUSTOMERS, DEFAULT_SETTINGS  # noqa: E402

GRACE = DEFAULT_SETTINGS["grace_days"]
SIM_END = AS_OF + timedelta(days=140)   # simulate past "today" so precursors before today can be shaped

PRODUCTS = [  # sku, name, category, price (INR), days_supply
    ("MNX-1M", "Minoxidil 5% Solution, 1 month", "Minoxidil Treatment", 699, 30),
    ("MNX-3M", "Minoxidil 5% Solution, 3 month pack", "Minoxidil Treatment", 1799, 90),
    ("GUM-1M", "Hair Fall Gummies, 30 day", "Hair Fall Gummies", 849, 30),
    ("GUM-3M", "Hair Fall Gummies, 90 day pack", "Hair Fall Gummies", 2199, 90),
    ("DHT-1", "DHT Blocker Shampoo, 250 ml", "DHT Shampoo", 449, 45),
    ("DHT-2", "DHT Blocker Shampoo, 2 bottle bundle", "DHT Shampoo", 799, 90),
    ("KIT-1", "Hair Growth Kit, 60 day", "Haircare Kit", 1599, 60),
    ("KIT-P", "Hair Growth Kit Plus, 60 day", "Haircare Kit", 2499, 60),
    ("SCP-1", "Scalp Serum, 30 ml", "Scalp Treatment", 599, 45),
    ("SCP-2", "Scalp Exfoliating Scrub", "Scalp Treatment", 499, 45),
    ("OTH-1", "Hair Oil", "Other Haircare", 399, 60),
    ("OTH-2", "Styling Wax", "Other Haircare", 349, 90),
]
CATS = ["Minoxidil Treatment", "Hair Fall Gummies", "DHT Shampoo", "Haircare Kit", "Scalp Treatment", "Other Haircare"]
CAT_W = [0.30, 0.22, 0.18, 0.12, 0.10, 0.08]
CAT_BIAS = {"Minoxidil Treatment": 0.10, "Hair Fall Gummies": 0.05, "DHT Shampoo": 0.0,
            "Haircare Kit": -0.30, "Scalp Treatment": 0.12, "Other Haircare": 0.35}
CAT_SKUS = {c: [i for i, p in enumerate(PRODUCTS) if p[2] == c] for c in CATS}

CHANNELS = ["Instagram Ads", "Google Search", "Influencer", "Organic", "Referral", "Marketplace"]
CH_W = [0.24, 0.22, 0.14, 0.16, 0.08, 0.16]
CH_LOYALTY = {"Instagram Ads": -0.02, "Google Search": 0.0, "Influencer": -0.05, "Organic": 0.06,
              "Referral": 0.12, "Marketplace": -0.10}
CH_PRICE = {"Instagram Ads": 0.02, "Google Search": 0.0, "Influencer": 0.06, "Organic": -0.04,
            "Referral": -0.03, "Marketplace": 0.12}
AGE_GROUPS = ["18-24", "25-34", "35-44", "45+"]
AGE_W = [0.24, 0.40, 0.23, 0.13]

FIRST = ["Aarav", "Vihaan", "Arjun", "Rohan", "Kabir", "Ishaan", "Aditya", "Karan", "Rahul", "Siddharth",
         "Nikhil", "Varun", "Manish", "Pranav", "Harsh", "Tanmay", "Yash", "Dev", "Rishi", "Ankit",
         "Gaurav", "Vikram", "Sahil", "Mohit", "Akash", "Neeraj", "Farhan", "Imran", "Joseph", "Sanjay",
         "Deepak", "Abhishek", "Naveen", "Kiran", "Suresh", "Prakash", "Mayank", "Tushar", "Rajat", "Zaid"]
LAST_INIT = list("ABCDGHJKMNPRSTVY")

EXECS = [("Aisha Khan", "exec1@retentionradar.demo"), ("Rohit Nair", "exec2@retentionradar.demo"),
         ("Meera Iyer", "exec3@retentionradar.demo"), ("Dev Sharma", "exec4@retentionradar.demo")]


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


class Gen:
    def __init__(self, seed=SEED):
        self.rng = np.random.default_rng(seed)
        self.pyrng = np.random.RandomState(seed)

    # ------------------------------------------------------------------ customers
    def build_customers(self, n):
        r = self.rng
        total_days = (AS_OF - DATA_START).days - 3
        first_off = np.floor(total_days * r.beta(1.0, 1.15, n)).astype(int)
        channel = r.choice(CHANNELS, n, p=CH_W)
        cat = r.choice(CATS, n, p=CAT_W)
        age = r.choice(AGE_GROUPS, n, p=AGE_W)
        E = np.clip(r.beta(2.5, 2.5, n), 0.03, 0.97)
        L = np.clip(r.beta(2.3, 2.3, n) + np.array([CH_LOYALTY[c] for c in channel]) + 0.22 * (E - 0.5)
                    - np.array([CAT_BIAS[c] for c in cat]) * 0.25, 0.03, 0.97)
        S = np.clip(r.beta(3.2, 2.0, n) + 0.08 * (L - 0.5), 0.03, 0.97)
        PS = np.clip(r.beta(2.0, 3.0, n) + np.array([CH_PRICE[c] for c in channel]), 0.02, 0.98)
        has_app = r.random(n) < 0.55
        reg_back = np.minimum(np.floor(r.exponential(4.0, n)).astype(int), 25)
        df = pd.DataFrame({
            "id": np.arange(1, n + 1), "first_date": [DATA_START + timedelta(days=int(o)) for o in first_off],
            "channel": channel, "cat": cat, "age_group": age, "E": E, "L": L, "S": S, "PS": PS, "has_app": has_app,
        })
        df["registered_at"] = [d - timedelta(days=int(b)) for d, b in zip(df["first_date"], reg_back)]
        return df

    # ------------------------------------------------------------------ order simulation
    def hazard(self, c, k):
        stage = {1: 0.6, 2: 0.35, 3: 0.15, 4: 0.0}.get(k, -0.35 if k < 8 else -0.6)
        z = (-1.60 + 2.4 * (0.5 - c["L"]) + 1.7 * (0.6 - c["S"]) + 1.1 * (c["PS"] - 0.4)
             + CAT_BIAS[c["cat"]] + stage)
        return float(sigmoid(z))

    def make_items(self, c, sku, first):
        items = [(sku, 1)]
        if self.rng.random() < (0.17 if not first else 0.10):
            other = int(self.rng.integers(0, len(PRODUCTS)))
            if other != sku:
                items.append((other, 1))
        return items

    def sim_run(self, c, t, k0, orders, sku, first_in_life):
        """Simulate one continuous run of orders starting with a delivered order at date t."""
        r = self.rng
        n = 1
        k = k0
        while r.random() > self.hazard(c, k) and n < 40:
            n += 1
            k += 1
        pc = 0.02 + 0.10 * (1 - c["L"]) + 0.03 * c["PS"]
        for j in range(n):
            if t > SIM_END:
                return
            p_sku = PRODUCTS[sku]
            w = p_sku[4]
            first = first_in_life and j == 0
            coupon = r.random() < (0.45 if first else 0.12 + 0.55 * c["PS"])
            orders.append(self._order(c, t, sku, w, coupon, first, k0 + j, prec=r.random()))
            last = j == n - 1
            if last:
                # dropout: sometimes a cancelled re-order attempt precedes the silence
                if r.random() < 0.18 + 0.30 * (1 - c["L"]):
                    for _ in range(int(r.integers(1, 3))):
                        td = t + timedelta(days=int(w * r.uniform(0.7, 1.15)))
                        if td <= SIM_END:
                            orders.append(self._cancelled(c, td, sku, w))
                if r.random() < 0.10 + 0.16 * c["E"]:   # win-back
                    t2 = t + timedelta(days=int(w * r.uniform(2.0, 5.5)))
                    if t2 <= SIM_END:
                        self.sim_run(c, t2, 2, orders, sku if r.random() < 0.8 else self._same_cat_sku(sku), False)
                return
            m = 0.99 + 0.20 * (1 - c["L"])
            sd = 0.05 + 0.10 * (1 - c["L"])
            if j >= n - 3:                       # slowing down before dropout
                m += 0.07 * (3 - (n - 1 - j))
            lag = float(np.clip(r.normal(m, sd), 0.65, (w + GRACE - 1) / w))
            if r.random() < 0.035:               # late but returns
                lag = r.uniform(1.6, 2.6)
            tn = t + timedelta(days=max(5, int(round(w * lag))))
            # cancelled attempts before delivery
            tries = 0
            while r.random() < pc * (1.5 if tries else 1.0) and tries < 2:
                if tn <= SIM_END:
                    orders.append(self._cancelled(c, tn, sku, w))
                tn += timedelta(days=int(r.integers(2, 9)))
                tries += 1
            t = tn
            if r.random() < 0.10:
                sku = self._same_cat_sku(sku)
            elif r.random() < 0.04:
                sku = int(self.rng.choice(CAT_SKUS[self.rng.choice(CATS)]))

    def _same_cat_sku(self, sku):
        cat = PRODUCTS[sku][2]
        return int(self.rng.choice(CAT_SKUS[cat]))

    def _order(self, c, t, sku, w, coupon, first, k, prec):
        r = self.rng
        items = self.make_items(c, sku, first)
        gross = sum(PRODUCTS[i][3] * q for i, q in items)
        disc_frac = r.uniform(0.10, 0.30) if coupon else 0.0
        disc = round(gross * disc_frac, 2)
        net = round(gross - disc, 2)
        p_ref = 0.015 + 0.09 * (1 - c["S"]) + (0.03 if k <= 1 else 0)
        refund = 0.0
        rdate = None
        if r.random() < p_ref:
            refund = net if r.random() < 0.75 else round(net * 0.5, 2)
            rdate = t + timedelta(days=int(r.integers(3, 15)))
        return {"date": t, "status": "delivered", "items": items, "gross": gross, "disc": disc, "net": net,
                "refund": refund, "refund_date": rdate, "coupon": coupon, "window": w, "prec": prec}

    def _cancelled(self, c, t, sku, w):
        gross = PRODUCTS[sku][3]
        return {"date": t, "status": "cancelled", "items": [(sku, 1)], "gross": gross, "disc": 0.0, "net": gross,
                "refund": 0.0, "refund_date": None, "coupon": False, "window": w, "prec": 0.5}

    def simulate_orders(self, cust):
        all_orders = {}
        for c in cust.to_dict("records"):
            sku = int(self.rng.choice(CAT_SKUS[c["cat"]], p=self._sku_p(c["cat"])))
            orders = []
            self.sim_run(c, c["first_date"], 1, orders, sku, True)
            orders.sort(key=lambda o: (o["date"], o["status"] != "delivered"))
            all_orders[c["id"]] = orders
        return all_orders

    def _sku_p(self, cat):
        n = len(CAT_SKUS[cat])
        return [0.75, 0.25][:n] if n == 2 else [1.0]

    # ------------------------------------------------------------------ campaigns + interventions
    def apply_outreach(self, cust, orders, campaign_defs, exec_ids):
        """Campaign sends (with 10% control groups) and manual interventions. May insert recovery orders."""
        r = self.rng
        cmap = cust.set_index("id").to_dict("index")

        def delivered_dates(cid):
            return [o["date"] for o in orders[cid] if o["status"] == "delivered"]

        # candidate events: (customer, expected_date, next_delivered_date_or_None, window, k)
        events = []
        for cid, ords in orders.items():
            dl = [o for o in ords if o["status"] == "delivered" and o["date"] <= AS_OF]
            for i, o in enumerate(dl):
                exp = o["date"] + timedelta(days=o["window"])
                nxt = dl[i + 1]["date"] if i + 1 < len(dl) else None
                events.append((cid, exp, nxt, o["window"], i + 1))
        ev = pd.DataFrame(events, columns=["cid", "exp", "nxt", "window", "k"])
        ev["exp_n"] = ev["exp"].map(lambda d: d.toordinal())
        ev["nxt_n"] = ev["nxt"].map(lambda d: d.toordinal() if d is not None else 10 ** 9)

        targets, interventions, ivents = [], [], []
        used_cust_dates = {}
        for camp in campaign_defs:
            d = camp["start"]
            while d <= camp["end"]:
                dn = d.toordinal()
                cand = ev[(ev["exp_n"] + camp["lo"] <= dn) & (dn <= ev["exp_n"] + camp["hi"]) & (ev["nxt_n"] > dn)]
                for row in cand.itertuples():
                    c = cmap[row.cid]
                    if camp["filter"] and not camp["filter"](c):
                        continue
                    if r.random() > camp["coverage"]:
                        continue
                    key = used_cust_dates.get(row.cid)
                    if key and abs((d - key).days) < 21:
                        continue
                    used_cust_dates[row.cid] = d
                    ctrl = r.random() < 0.10
                    delivered = (not ctrl) and r.random() < camp["deliver_p"]
                    clicked = delivered and r.random() < camp["click_base"] + 0.25 * c["E"]
                    induced = False
                    if delivered and r.random() < camp["uplift"] * (0.5 + c["L"]) * (0.7 + 0.6 * c["S"]):
                        if not any(0 <= (x - d).days <= 14 for x in delivered_dates(row.cid)):
                            induced = True
                    if induced:
                        t2 = d + timedelta(days=int(r.integers(1, 11)))
                        self._recover(cmap[row.cid], row.cid, t2, orders)
                    ds = [x for x in delivered_dates(row.cid) if 0 <= (x - d).days <= 14]
                    rev = sum(o["net"] - o["refund"] for o in orders[row.cid]
                              if o["status"] == "delivered" and 0 <= (o["date"] - d).days <= 14)
                    targets.append({"campaign_id": camp["id"], "customer_id": row.cid, "send_date": d,
                                    "grp": "control" if ctrl else "treatment", "delivered": bool(delivered),
                                    "clicked": bool(clicked), "reordered": bool(ds), "revenue_14d": round(rev, 2)})
                d += timedelta(days=7)

        # manual interventions by customer-success executives
        hist_lo, hist_hi = AS_OF - timedelta(days=170), AS_OF - timedelta(days=12)
        cand = ev[(ev["exp"] + timedelta(days=2) >= hist_lo) & (ev["exp"] + timedelta(days=2) <= hist_hi)]
        cand = cand.sample(frac=0.12, random_state=7)
        for row in cand.itertuples():
            cid = row.cid
            c = cmap[cid]
            d = row.exp + timedelta(days=int(r.integers(2, 9)))
            if used_cust_dates.get(cid) and abs((d - used_cust_dates[cid]).days) < 21:
                continue
            if any(0 <= (x - d).days <= 1 for x in delivered_dates(cid)):
                continue
            scen = self._hist_scenario(c, row.k)
            up = {"Product dissatisfaction": 0.30, "High-value recovery": 0.32, "Repeated cancellations": 0.16,
                  "Low engagement": 0.14, "Missed replenishment": 0.20}[scen]
            induced = False
            if r.random() < up * (0.5 + c["L"]) * (0.6 + 0.8 * c["S"]):
                if not any(0 <= (x - d).days <= 14 for x in delivered_dates(cid)):
                    induced = True
            if induced:
                self._recover(c, cid, d + timedelta(days=int(r.integers(2, 12))), orders)
            interventions.append({"cid": cid, "date": d, "scen": scen, "k": row.k, "exp": row.exp,
                                  "window": row.window, "assignee": int(r.choice(exec_ids))})
        return targets, interventions

    def _hist_scenario(self, c, k):
        r = self.rng
        if c["S"] < 0.33:
            return "Product dissatisfaction"
        if c["L"] > 0.6 and c["PS"] < 0.5 and r.random() < 0.35:
            return "High-value recovery"
        if (1 - c["L"]) * c["PS"] > 0.30:
            return "Repeated cancellations"
        if c["E"] < 0.35:
            return "Low engagement"
        return "Missed replenishment"

    def _recover(self, c, cid, t2, orders):
        """Insert a recovery order and regenerate the continuation (customer may or may not stay)."""
        ords = orders[cid]
        keep = [o for o in ords if o["date"] < t2]
        last_deliv = [o for o in keep if o["status"] == "delivered"]
        sku = self._pick_sku_from(last_deliv[-1]) if last_deliv else int(CAT_SKUS[c["cat"]][0])
        c2 = dict(c)
        c2["L"] = float(np.clip(c["L"] * 0.8, 0.03, 0.97))   # recovered customers are a bit less sticky
        new = []
        self.sim_run(c2, t2, 3, new, sku, False)
        orders[cid] = sorted(keep + new, key=lambda o: (o["date"], o["status"] != "delivered"))

    def _pick_sku_from(self, order):
        return int(order["items"][0][0])

    # ------------------------------------------------------------------ tickets + engagement
    TICKET_TYPES = [
        ("Delivery delay", "neutral", False, "Delivery took longer than expected"),
        ("Product dissatisfaction", "negative", False, "Customer unhappy with product experience"),
        ("Treatment concern", "negative", True, "Customer reported scalp or shedding concern during treatment"),
        ("Billing or refund", "neutral", False, "Question about charge or refund status"),
        ("Usage guidance", "neutral", False, "Asked how to use the product"),
        ("Order issue", "negative", False, "Wrong or damaged item received"),
    ]

    def tickets_for(self, c, orders):
        r = self.rng
        rows = []
        deliv = [o for o in orders if o["status"] == "delivered"]
        S = c["S"]
        for o in deliv:
            if r.random() < 0.035 + 0.20 * (1 - S) ** 2:
                rows.append(self._ticket(c, o["date"] + timedelta(days=int(r.integers(1, 13))), low_s=S < 0.45))
        # precursor complaints before a lapse
        for i, o in enumerate(deliv):
            nxt = deliv[i + 1]["date"] if i + 1 < len(deliv) else None
            lapse = nxt is None or (nxt - o["date"]).days > o["window"] + GRACE
            if lapse and r.random() < 0.10 + 0.50 * (1 - S):
                td = o["date"] + timedelta(days=int(r.integers(3, max(5, o["window"]))))
                t = self._ticket(c, td, low_s=True)
                if r.random() < 0.30:
                    t["unresolved"] = True
                if nxt is not None and r.random() < 0.45:   # support-led recovery: resolved quickly before return
                    t["unresolved"] = False
                    t["created"] = nxt - timedelta(days=int(r.integers(3, 12)))
                rows.append(t)
        out = []
        for t in rows:
            if t["created"] > AS_OF or t["created"] < DATA_START:
                continue
            res = None if t.get("unresolved") else t["created"] + timedelta(days=int(r.exponential(3.0)) + 1)
            if res is not None and res > AS_OF:
                res = None
            out.append({"created_at": t["created"], "category": t["cat"], "sentiment": t["sent"],
                        "status": "open" if res is None else "resolved", "resolved_at": res,
                        "medical_concern": t["med"], "summary": t["summary"]})
        return out

    def _ticket(self, c, d, low_s):
        r = self.rng
        weights = np.array([0.14, 0.22, 0.12, 0.12, 0.28, 0.12]) if not low_s else np.array([0.12, 0.34, 0.20, 0.08, 0.06, 0.20])
        i = int(r.choice(len(self.TICKET_TYPES), p=weights / weights.sum()))
        cat, sent, med, summ = self.TICKET_TYPES[i]
        return {"created": d, "cat": cat, "sent": sent, "med": med, "summary": summ,
                "unresolved": r.random() < 0.03}

    def engagement_for(self, c, orders):
        r = self.rng
        deliv = [o for o in orders if o["status"] == "delivered"]
        if not deliv:
            return []
        od = np.array([o["date"].toordinal() for o in deliv])
        win = np.array([o["window"] for o in deliv], dtype=float)
        prec = np.array([o["prec"] for o in deliv])
        reg = c["registered_at"]
        wk0 = reg - timedelta(days=reg.weekday())
        weeks = []
        d = max(wk0, DATA_START - timedelta(days=21))
        while d + timedelta(days=6) <= AS_OF:
            weeks.append(d)
            d += timedelta(days=7)
        if not weeks:
            return []
        wd = np.array([w.toordinal() + 3 for w in weeks])
        idx = np.searchsorted(od, wd, side="right") - 1
        has_prev = idx >= 0
        i0 = np.clip(idx, 0, None)
        prev = od[i0]
        nxt = np.where(idx + 1 < len(od), od[np.minimum(idx + 1, len(od) - 1)], 10 ** 7)
        wprev = win[i0]
        gap = nxt - prev
        lapse = has_prev & (gap > wprev + GRACE)
        since = wd - prev
        pflag = prec[i0]
        dec_s = 0.25 * wprev
        dec_e = wprev + GRACE
        prog = np.clip((since - dec_s) / (dec_e - dec_s), 0, 1)
        f = np.ones(len(wd))
        f = np.where(lapse & (pflag < 0.75), 1 - 0.75 * prog, f)
        f = np.where(lapse & (since > dec_e), np.where(pflag < 0.75, 0.2, 0.5), f)
        f = np.where(has_prev & ~lapse & (pflag > 0.90), 1 - 0.40 * prog, f)
        ramp = lapse & (nxt < 10 ** 7) & ((nxt - wd) <= 10) & ((nxt - wd) >= 0)
        f = np.where(ramp, np.maximum(f, 1 - (nxt - wd) / 10 * 0.8), f)
        eff = np.clip(c["E"] * f * (0.8 + 0.4 * r.random(len(wd))), 0.0, 1.0)
        sent = r.poisson(1.3, len(wd))
        opens = r.binomial(sent, np.clip(0.12 + 0.60 * eff, 0, 0.95))
        clicks = r.binomial(opens, np.clip(0.08 + 0.35 * eff, 0, 0.9))
        visits = r.poisson(0.10 + 1.5 * eff)
        content = r.poisson(0.05 + 1.0 * eff)
        app = r.poisson(0.05 + 1.6 * eff) if c["has_app"] else np.full(len(wd), -1)
        reviews = np.zeros(len(wd), dtype=int)
        for o in deliv:
            if r.random() < 0.03 + 0.12 * c["S"]:
                j = (o["date"] + timedelta(days=int(r.integers(4, 12))) - weeks[0]).days // 7
                if 0 <= j < len(weeks):
                    reviews[j] += 1
        rows = []
        for j, w in enumerate(weeks):
            if sent[j] or visits[j] or content[j] or reviews[j] or (app[j] > 0):
                rows.append((w, int(sent[j]), int(opens[j]), int(clicks[j]), int(visits[j]),
                             None if app[j] < 0 else int(app[j]), int(content[j]), int(reviews[j])))
        return rows


def build_history_interventions(data):
    """Historical interventions by customer-success execs, with statuses derived from what happened next."""
    from app.recommend import SCENARIOS
    rng = np.random.default_rng(SEED + 5)
    o = data["orders"]
    dl = o[o.status == "delivered"]
    by = {cid: sorted(g["order_date"].tolist()) for cid, g in dl.groupby("customer_id")}
    code = dict(zip(data["customers"]["id"], data["customers"]["customer_code"]))
    users = {3 + i: n for i, (n, _) in enumerate(EXECS)}
    notes_ok = ["Customer confirmed the reminder helped and reordered.", "Customer had forgotten; placed an order after the call.",
                "Delivery address updated, order placed."]
    notes_no = ["No answer after two attempts.", "Customer said they are pausing for now.",
                "Customer prefers a different product; shared options.", "Customer reported price concern."]
    rows, events = [], []
    ivs = sorted(data["interventions_seed"], key=lambda x: x["date"])
    for i, iv in enumerate(ivs, start=1):
        d = iv["date"]
        nxt = [x for x in by.get(iv["cid"], []) if x > d]
        nd = nxt[0] if nxt else None
        age = (AS_OF - d).days
        if nd is not None and (nd - d).days <= 30:
            status = "Resolved"
        elif age >= 30:
            status = "Unsuccessful"
        else:
            status = str(rng.choice(["Contacted", "In Progress", "Contacted"]))
        sc = iv["scen"]
        rows.append({"id": i, "customer_id": iv["cid"], "created_at": d, "created_by": "Retention rules (history)",
                     "risk_category": None, "churn_probability": None,
                     "reason": f"{sc}: refill expected {iv['exp'].isoformat()}", "scenario": sc,
                     "recommended_action": "; ".join(SCENARIOS[sc][:2]),
                     "rationale": "Created by an executive after the expected refill date passed without an order.",
                     "assigned_to": iv["assignee"], "due_date": d + timedelta(days=5), "status": status,
                     "source": "history", "campaign_id": None})
        who = users[iv["assignee"]]
        t0 = datetime(d.year, d.month, d.day, 10, 0)
        events.append({"intervention_id": i, "event_at": t0, "actor": "System", "event_type": "created",
                       "detail": f"Intervention opened: {sc}"})
        events.append({"intervention_id": i, "event_at": t0 + timedelta(hours=1), "actor": "System",
                       "event_type": "assigned", "detail": f"Assigned to {who}"})
        if status != "Pending":
            ok = status == "Resolved"
            events.append({"intervention_id": i, "event_at": t0 + timedelta(days=1, hours=2), "actor": who,
                           "event_type": "customer_response", "detail": str(rng.choice(notes_ok if ok else notes_no))})
            events.append({"intervention_id": i, "event_at": t0 + timedelta(days=1, hours=3), "actor": who,
                           "event_type": "status_change", "detail": f"Status set to {status}"})
    return pd.DataFrame(rows), pd.DataFrame(events)


def pw_hash(pw: str) -> str:
    salt = hashlib.sha256(b"retention-radar-demo-salt").hexdigest()[:16]
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
    return f"pbkdf2${salt}${dk.hex()}"


def build_all():
    g = Gen()
    rng = g.rng
    cust = g.build_customers(N_CUSTOMERS)
    print("simulating orders ...")
    orders = g.simulate_orders(cust)

    exec_ids = [3, 4, 5, 6]
    campaign_defs = [
        dict(id=1, name="Replenishment reminder: WhatsApp and email", ctype="Replenishment reminder", channel="WhatsApp + Email",
             start=date(2026, 5, 4), end=date(2026, 7, 20), lo=2, hi=9, coverage=0.55, deliver_p=0.94, click_base=0.10,
             uplift=0.20, unit_cost=1.4, filter=None, desc="Personalised reorder reminder with one-tap reorder link."),
        dict(id=2, name="Replenishment reminder: SMS nudge", ctype="Replenishment reminder", channel="SMS",
             start=date(2026, 8, 3), end=date(2026, 10, 12), lo=2, hi=9, coverage=0.45, deliver_p=0.91, click_base=0.07,
             uplift=0.12, unit_cost=0.35, filter=None, desc="Short SMS reminder when a refill is overdue."),
        dict(id=3, name="Usage education series", ctype="Educational campaign", channel="Email",
             start=date(2026, 6, 1), end=date(2026, 8, 24), lo=3, hi=14, coverage=0.50, deliver_p=0.97, click_base=0.09,
             uplift=0.07, unit_cost=0.10, filter=lambda c: c["E"] < 0.45,
             desc="Company-approved usage guidance for customers with low content engagement."),
        dict(id=4, name="Post-purchase feedback request", ctype="Feedback request", channel="Email + App",
             start=date(2026, 7, 6), end=date(2026, 9, 28), lo=4, hi=14, coverage=0.45, deliver_p=0.96, click_base=0.06,
             uplift=0.06, unit_cost=0.20, filter=lambda c: (1 - c["L"]) * c["PS"] > 0.22,
             desc="Short survey on affordability, delivery and product experience."),
        dict(id=5, name="Support callback: unhappy customers", ctype="Support follow-up", channel="Phone",
             start=date(2026, 6, 15), end=date(2026, 9, 14), lo=3, hi=12, coverage=0.40, deliver_p=0.80, click_base=0.30,
             uplift=0.32, unit_cost=48.0, filter=lambda c: c["S"] < 0.42,
             desc="Customer-success callback for customers with weaker experience. Treatment concerns are escalated."),
        dict(id=6, name="Win-back: lapsed customers", ctype="Re-engagement campaign", channel="WhatsApp + Email",
             start=date(2026, 7, 13), end=date(2026, 10, 5), lo=20, hi=45, coverage=0.40, deliver_p=0.93, click_base=0.05,
             uplift=0.07, unit_cost=1.4, filter=None, desc="Re-engagement offer to customers 20 to 45 days past their expected refill."),
    ]
    print("applying campaigns and interventions ...")
    targets, ivs = g.apply_outreach(cust, orders, campaign_defs, exec_ids)

    # --- tidy tables
    cust_rows, ord_rows, item_rows, tk_rows, eng_rows = [], [], [], [], []
    oid = 0
    print("tickets and engagement ...")
    cust_dicts = cust.to_dict("records")
    for c in cust_dicts:
        ords = orders[c["id"]]
        fdel = next(o for o in ords if o["status"] == "delivered")
        first_cat = PRODUCTS[fdel["items"][0][0]][2]
        code = f"SYN-{1000 + c['id']}"
        name = f"{FIRST[rng.integers(0, len(FIRST))]} {LAST_INIT[rng.integers(0, len(LAST_INIT))]}."
        cust_rows.append({"id": c["id"], "customer_code": code, "display_name": name,
                          "email_masked": f"{name[0].lower()}***@example.invalid", "age_group": c["age_group"],
                          "channel": c["channel"], "registered_at": c["registered_at"],
                          "first_purchase_date": fdel["date"], "acquisition_category": first_cat,
                          "has_app": bool(c["has_app"]), "is_synthetic": True})
        vis = [o for o in ords if o["date"] <= AS_OF]
        for o in vis:
            oid += 1
            ord_rows.append({"id": oid, "customer_id": c["id"], "order_date": o["date"], "status": o["status"],
                             "gross_amount": o["gross"], "discount_amount": o["disc"], "net_amount": o["net"],
                             "refund_amount": o["refund"] if o["refund_date"] and o["refund_date"] <= AS_OF else 0.0,
                             "refund_date": o["refund_date"] if o["refund_date"] and o["refund_date"] <= AS_OF else None,
                             "coupon_used": o["coupon"], "window_days": o["window"]})
            share = o["disc"] / max(o["gross"], 1)
            for sku, q in o["items"]:
                item_rows.append({"order_id": oid, "product_id": sku + 1, "quantity": q,
                                  "unit_price": PRODUCTS[sku][3], "discount_amount": round(PRODUCTS[sku][3] * q * share, 2)})
        for t in g.tickets_for(c, ords):
            t["customer_id"] = c["id"]
            tk_rows.append(t)
        for w in g.engagement_for(c, ords):
            eng_rows.append({"customer_id": c["id"], "week_start": w[0], "emails_sent": w[1], "emails_opened": w[2],
                             "email_clicks": w[3], "site_visits": w[4], "app_sessions": w[5],
                             "content_views": w[6], "reviews": w[7]})

    orders_df = pd.DataFrame(ord_rows)
    return {
        "cust": cust, "customers": pd.DataFrame(cust_rows), "orders": orders_df,
        "order_items": pd.DataFrame(item_rows), "tickets": pd.DataFrame(tk_rows),
        "engagement": pd.DataFrame(eng_rows), "targets": pd.DataFrame(targets),
        "campaign_defs": campaign_defs, "interventions_seed": ivs, "exec_ids": exec_ids,
        "latents": cust[["id", "E", "L", "S", "PS"]],
    }


def write_db(data):
    from sqlalchemy import text
    from app.db import engine
    from app import schema as S

    S.metadata.drop_all(engine)
    S.metadata.create_all(engine)
    ts = datetime(2026, 10, 31, 9, 0)
    users = [
        {"id": 1, "email": "manager@retentionradar.demo", "name": "Priya Menon", "role": "retention_manager"},
        {"id": 2, "email": "analyst@retentionradar.demo", "name": "Sameer Rao", "role": "analyst"},
    ] + [{"id": 3 + i, "email": e, "name": n, "role": "success_exec"} for i, (n, e) in enumerate(EXECS)]
    for u in users:
        u["password_hash"] = pw_hash("demo1234")
        u["is_active"] = True
    prod = pd.DataFrame([{"id": i + 1, "sku": p[0], "name": p[1], "category": p[2], "price": p[3], "days_supply": p[4]}
                         for i, p in enumerate(PRODUCTS)])
    camp = pd.DataFrame([{"id": c["id"], "name": c["name"], "campaign_type": c["ctype"], "channel": c["channel"],
                          "start_date": c["start"], "end_date": c["end"], "unit_cost": c["unit_cost"],
                          "description": c["desc"], "is_simulated": True} for c in data["campaign_defs"]])
    kw = dict(if_exists="append", index=False, method="multi", chunksize=4000)
    pd.DataFrame(users).to_sql("users", engine, **kw)
    prod.to_sql("products", engine, **kw)
    data["customers"].to_sql("customers", engine, **kw)
    data["orders"].to_sql("orders", engine, **kw)
    data["order_items"].to_sql("order_items", engine, **kw)
    data["engagement"].to_sql("customer_engagement", engine, **kw)
    data["tickets"].to_sql("support_tickets", engine, **kw)
    camp.to_sql("campaigns", engine, **kw)
    data["targets"].to_sql("campaign_targets", engine, **kw)
    iv_df, ev_df = build_history_interventions(data)
    iv_df.to_sql("retention_interventions", engine, **kw)
    ev_df.to_sql("intervention_events", engine, **kw)
    with engine.begin() as cx:
        for tbl in ["users", "products", "customers", "orders", "order_items", "customer_engagement",
                    "support_tickets", "campaigns", "campaign_targets", "retention_interventions", "intervention_events"]:
            cx.execute(text(f"SELECT setval(pg_get_serial_sequence('{tbl}','id'), (SELECT COALESCE(MAX(id),1) FROM {tbl}))")) \
                if tbl not in ("users",) else None
    print("loaded:", {k: len(v) for k, v in data.items() if hasattr(v, "__len__") and k in
                      ("customers", "orders", "order_items", "tickets", "engagement", "targets")})


if __name__ == "__main__":
    d = build_all()
    write_db(d)
    import pickle
    pickle.dump({"interventions_seed": d["interventions_seed"], "latents": d["latents"]},
                open("/tmp/rr_seed_extras.pkl", "wb"))

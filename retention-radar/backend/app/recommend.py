"""Retention recommendation engine: maps observed risk indicators to an intervention with a rationale.

Rules are transparent and deliberately conservative. Nothing here prescribes treatment, changes a
medication routine, or promises hair regrowth. Treatment-related concerns are escalated to qualified
professionals.
"""

SCENARIOS = {
    "Missed replenishment": [
        "Send a personalised replenishment reminder",
        "Include a one-tap reorder link",
        "Ask whether the customer needs any help with their routine or delivery",
    ],
    "Product dissatisfaction": [
        "Prioritise a customer-support follow-up call",
        "Understand the issue in the customer's own words before offering anything",
        "Escalate any treatment or medical concern to qualified professionals; do not give treatment advice",
    ],
    "Low engagement": [
        "Send company-approved product education and usage guidance",
        "Invite the customer to reply with questions",
        "Re-check engagement in two weeks before further outreach",
    ],
    "Repeated cancellations": [
        "Request feedback on why orders were cancelled",
        "Check affordability, delivery and product-related concerns",
        "Offer an appropriate alternative pack size or product where available",
    ],
    "High-value recovery": [
        "Assign a named executive for personalised outreach",
        "Review the customer's previous orders, tickets and refunds before contact",
        "Offer an appropriate recovery step agreed by the retention manager",
    ],
    "Monitor": [
        "No outreach needed now",
        "Keep in the weekly scoring run",
    ],
}

SCENARIO_ORDER = ["Product dissatisfaction", "High-value recovery", "Repeated cancellations",
                  "Missed replenishment", "Low engagement", "Monitor"]


def choose_scenario(f: dict) -> str:
    """f: facts about the customer at the prediction date."""
    risk = f.get("risk_category", "Low")
    at_risk = risk in ("High", "Critical")
    if f.get("open_negative_tickets", 0) > 0 or f.get("treatment_concerns", 0) > 0 and f.get("open_tickets", 0) > 0:
        return "Product dissatisfaction"
    if at_risk and f.get("high_value"):
        return "High-value recovery"
    if f.get("cancels_recent", 0) >= 2 or f.get("cancel_rate", 0) >= 0.30:
        return "Repeated cancellations"
    if f.get("days_overdue", -999) > 0:
        return "Missed replenishment"
    if f.get("engagement_drop") or f.get("engagement_score", 100) < 25:
        return "Low engagement"
    if risk in ("Medium", "High", "Critical"):
        return "Missed replenishment" if f.get("days_overdue", -999) > -10 else "Low engagement"
    return "Monitor"


def build_rationale(scenario: str, f: dict) -> str:
    bits = []
    if scenario == "Missed replenishment":
        bits.append(f"Expected refill date passed {int(f.get('days_overdue', 0))} days ago with no new order")
    if scenario == "Product dissatisfaction":
        if f.get("treatment_concerns", 0) > 0:
            bits.append("Customer raised a treatment-related concern; clinical questions go to qualified professionals")
        bits.append(f"{int(f.get('open_negative_tickets', 0))} unresolved negative support ticket(s)")
    if scenario == "Repeated cancellations":
        bits.append(f"{int(f.get('cancels_recent', 0))} cancelled order attempts recently "
                    f"({f.get('cancel_rate', 0):.0%} of all attempts)")
    if scenario == "Low engagement":
        bits.append(f"Engagement score {f.get('engagement_score', 0):.0f}/100 and falling content, email and visit activity")
    if scenario == "High-value recovery":
        bits.append(f"Lifetime spend of about Rs {f.get('ltv', 0):,.0f} is in the top 20% of customers and risk is {f.get('risk_category')}")
    if scenario == "Monitor":
        bits.append("No strong risk indicators at this time")
    return ". ".join(bits) + ". Associations come from model factors and are not proof of cause."


def build_recommendation(f: dict) -> dict:
    sc = choose_scenario(f)
    return {"scenario": sc, "actions": SCENARIOS[sc], "rationale": build_rationale(sc, f)}

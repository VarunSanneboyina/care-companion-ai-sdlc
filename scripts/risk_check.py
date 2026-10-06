#!/usr/bin/env python3
"""Risk-check agent runner.

Reads a change request from environment variables, applies the rules layer
(keywords) and, if ANTHROPIC_API_KEY is set, the judgement layer (a model).
The STRICTER result wins. Writes result.json and comment.md.

Instructions for the model live in agents/risk-check-agent.md.
Uses only the Python standard library.
"""
import json, os, re, sys, urllib.request

RULES = {
    "PAYMENTS": r"\b(pay|payment|billing|bill|invoice|refund|fee|price|charge|card|subscription|checkout|wallet|upi)\b",
    "SECURITY": r"\b(login|log in|sign in|password|otp|2fa|token|role|permission|access|admin|auth|session|encrypt)\b",
    "PERSONAL_DATA": r"\b(blood pressure|bp|diagnos|prescription|medication|phone|email|address|aadhaar|dob|date of birth|export|share|upload|photo|image|record|consent)\b",
    "CLINICAL_LOGIC": r"\b(threshold|target|alert|risk score|dose|dosing|advice|recommend|above target|below target|critical|normal range)\b",
}
TOUCH_MAP = {
    "Payments": "PAYMENTS",
    "Login or permissions": "SECURITY",
    "Personal or health data": "PERSONAL_DATA",
    "Clinical thresholds or advice": "CLINICAL_LOGIC",
}
PROMPT = open(os.path.join(os.path.dirname(__file__), "..", "agents", "risk-check-agent.md")).read()


def section(body, heading):
    m = re.search(r"### " + re.escape(heading) + r"\s*\n+(.*?)(?=\n### |\Z)", body, re.S)
    return m.group(1).strip() if m else ""


def rules_layer(text, ticked):
    cats = {c for c, rx in RULES.items() if re.search(rx, text, re.I)}
    cats |= {TOUCH_MAP[t.strip()] for t in ticked.split(",") if t.strip() in TOUCH_MAP}
    return sorted(cats)


def model_layer(text):
    key = os.environ.get("ANTHROPIC_API_KEY")
    mock = os.environ.get("RISK_MOCK_RESPONSE")
    if mock:
        return json.loads(mock)
    if not key:
        return None
    system = (
        "You are the Risk-check agent for Care Companion, a sample healthcare product. "
        "Decide whether the change request needs a human engineer. "
        "Send to HUMAN_REVIEW if it touches ANY of: PAYMENTS, SECURITY, PERSONAL_DATA, CLINICAL_LOGIC. "
        "Changes that only filter or reorder data already shown, or only change appearance, are AUTO. "
        "When unsure, choose HUMAN_REVIEW. "
        'Reply with ONLY JSON: {"verdict":"AUTO"|"HUMAN_REVIEW","categories":[...],"reason":"one sentence","checklist":["..."]}'
    )
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps({
            "model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
            "max_tokens": 600,
            "system": system,
            "messages": [{"role": "user", "content": text}],
        }).encode(),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            out = json.load(r)["content"][0]["text"]
        m = re.search(r"\{.*\}", out, re.S)
        return json.loads(m.group(0))
    except Exception as e:  # model failure must never lower safety
        print("model layer unavailable:", e, file=sys.stderr)
        return {"error": str(e)}


def main():
    title = os.environ.get("ISSUE_TITLE", "")
    body = os.environ.get("ISSUE_BODY", "")
    ticked = section(body, "Does it touch any of these?")
    text = title + "\n" + body
    cats = rules_layer(text, ticked)
    model = model_layer(text)

    verdict = "HUMAN_REVIEW" if cats else "AUTO"
    reason = "Rules layer matched: " + ", ".join(cats) if cats else "No risk keywords and nothing ticked."
    checklist = []
    layer = "rules only"
    if model and "verdict" in model:
        layer = "rules + model"
        if model["verdict"] == "HUMAN_REVIEW":
            verdict = "HUMAN_REVIEW"
        cats = sorted(set(cats) | set(model.get("categories", [])))
        reason = model.get("reason", reason) if verdict == model["verdict"] else reason + " (model said AUTO; stricter rules result kept)"
        checklist = model.get("checklist", [])
    elif model and "error" in model:
        layer = "rules only (model call failed)"

    undecided = section(body, "What is still undecided?")
    if undecided and undecided != "_No response_":
        checklist.append("Product owner: resolve undecided items before approving: " + undecided.replace("\n", " "))

    result = {"verdict": verdict, "categories": cats, "reason": reason, "checklist": checklist, "layer": layer}
    json.dump(result, open("result.json", "w"), indent=2)

    lane = "ENGINEER REVIEW REQUIRED" if verdict == "HUMAN_REVIEW" else "Fast lane"
    lines = ["## Risk-check agent result", "", f"**{lane}**", "",
             f"- Categories: {', '.join(cats) or 'none'}",
             f"- Reason: {reason}",
             f"- Checked by: {layer}", ""]
    if checklist:
        lines += ["**Checklist for the reviewer**"] + [f"- [ ] {c}" for c in checklist] + [""]
    lines += ["_Next: the product owner reviews and adds the label `po:approved` to release this to the code agent._"]
    open("comment.md", "w").write("\n".join(lines))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

# Engineer Review Checklist

Used when the Risk-check agent labels a change `risk:engineer`.
The engineer is a person. The agent only prepares the page they read.

## What the engineer receives
1. The change request in plain language
2. The risk categories and the reason they were flagged
3. The agent-generated checklist (specific to this request)
4. The diff and the test results (once the code agent has run)

## What the engineer checks
### Always
- [ ] The change matches `intent.md` and the spec was updated BEFORE the code
- [ ] Tests exist for the new behaviour and pass
- [ ] No real patient data, keys, or tokens in the diff
- [ ] The change can be switched off or reverted quickly

### If PAYMENTS
- [ ] Amounts, rounding and currency handled in code, not by the model
- [ ] No card data stored; a payment provider handles it
- [ ] Refund and failure paths covered

### If SECURITY
- [ ] Who can see or do what is checked in code on every request
- [ ] No secrets in the client; sessions expire
- [ ] Failed logins and abuse limited and logged

### If PERSONAL_DATA
- [ ] Data collected is the minimum needed
- [ ] Where it is stored, who can read it, how long it is kept
- [ ] Consent and audit trail considered

### If CLINICAL_LOGIC
- [ ] The threshold or rule has a named clinical owner and a recorded sign-off
- [ ] Thresholds live in configuration, not scattered in code
- [ ] The product shows data and status, never advice

## Outcomes
- **Approve**: comment "Approved by engineer" and approve the pull request
- **Request changes**: list what is missing
- **Escalate**: tag the clinical lead or security owner

## Rules
- The author of a change never approves it.
- CODEOWNERS enforces this: protected files require the engineer team.
- Approval is recorded in the pull request, which is the audit trail.

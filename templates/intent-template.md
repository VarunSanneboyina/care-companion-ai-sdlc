# Change request template (the shape every request must fill)

Title: <short, in plain words>

## Why is this needed?
The business or patient reason, and what happens if we do not do it.

## Who will benefit, and how?

## Problem (what happens today)
A real example.

## Outcome (what should be different)

## How it will work
Step by step, from the user's point of view.

## Acceptance (how we will know)
- A check a non-engineer could do
- A second check

## Touches (tick all that apply)
- [ ] Payments
- [ ] Login or permissions
- [ ] Personal or health data
- [ ] Clinical thresholds or advice
- [ ] None of these

## Out of scope (optional)

## Undecided (question | who decides)
- Example: Who approves the numbers? | Clinical lead

## Why the template looks like this
- **Why** and **Who benefits** let the product owner prioritise the backlog; without them a request cannot be ranked.
- **Problem** and **Outcome** stop people jumping to solutions.
- **How it will work** is what engineers and designers build from.
- **Acceptance** makes the request testable. No acceptance means no test, and no test means no safe automation.
- **Touches** is asked directly because people rarely volunteer risk.
- **Undecided** becomes rows in the Decisions table of `intent.md`. An Open row blocks the merge (Definition of Ready).

## How this template was made
1. Listed what a product owner always has to ask after receiving a vague request.
2. Kept only the questions whose missing answer caused rework or made prioritising impossible.
3. Matched the fields to `.github/ISSUE_TEMPLATE/change-request.yml` and to the checks in `app/lib/fields.js`, so a form, an agent and the code all collect and verify the same thing.
4. Matched the risk fields to the categories in `agents/risk-check-agent.md`.

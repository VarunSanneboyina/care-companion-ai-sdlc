# Working agreements for agents on Care Companion

## Always
- Read `intent.md` before changing anything. It is the source of truth.
- Change `intent.md` first, then the code and tests that follow from it.
- If a rule is not in `intent.md`, stop and list a question. Do not assume.
- Write or update a test for every behaviour change.
- Explain each change in plain language for a non-engineer.
- Keep changes small and show what changed.

## Never
- Use real patient data. Sample data only.
- Give medical or dosing advice in the product.
- Merge your own pull request. A human merges.
- Commit passwords, keys or tokens.

## Needs a human engineer before merge
Any change that touches:
- payments or billing
- login, passwords, roles or permissions
- a new kind of personal or health data, or who can see it
- clinical logic such as thresholds, alerts or advice

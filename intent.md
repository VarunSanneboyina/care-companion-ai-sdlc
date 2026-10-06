# Care Companion: intent.md (v1.0)

## Purpose
Help patients with diabetes log HbA1c readings, and let care coordinators see who needs follow-up.

## Users
- Patients with diabetes
- Care coordinators

## Capabilities
- Patient list with latest HbA1c and reading date.
- A reading can be submitted with a value and a date.
- Each reading shows a status against a clinician-set target.

## Rules and limits
- Sample data only. No real patient data.
- The app never gives medical or dosing advice.
- Targets are set by clinicians in configuration.

## Out of scope
- Payments, messaging, medication changes.

## Acceptance criteria
- A submitted reading appears in the list immediately.
- HbA1c values outside 3.0 to 20.0 are rejected.

## Decisions

| # | Decision | Owner | Status | Resolution |
| --- | --- | --- | --- | --- |
| D1 | Demo uses sample data only | Product owner | Resolved | Yes, no real patient data |

# Care Companion: an AI SDLC demo

**Two parts.** (1) The repository itself, with agent instruction files, the spec, tests and a GitHub pipeline. (2) A small platform in `app/`: a Control Room, a Request Workspace and a Patient Portal, each on its own URL, backed by one API that uses Claude. **Start with `GETTING-STARTED.md`** (accounts, files, Claude key, Render, testing). `ARCHITECTURE.md` explains how it fits together, `TEST-CASES.md` lists every test, and `SETUP.md` has the GitHub-only demo script.

The Request Workspace has one job: make sure the requester gives every detail needed to write the requirement (why, who benefits, how it works, how we will know it works, risk areas). Completeness is checked in code. The result is a new `intent.md` that the product owner approves and pushes to GitHub as a pull request.

A small healthcare app (sample patients only) built to show how a change travels from a business request to a live release, with AI agents doing the routine work and humans keeping the decisions that matter.

## The flow

```
Business person -> Change request (issue form)
                -> Risk-check agent (rules + model)  -> label risk:auto or risk:engineer
                -> Product owner reviews              -> label po:approved
                -> Code agent opens a pull request    (spec first, then code, then tests)
                -> Checks: tests + Definition of Ready
                -> Engineer reviews (only if risk:engineer)
                -> Human merges -> app redeploys on GitHub Pages
```

## Where each piece lives

| Question | File |
| --- | --- |
| What is the product supposed to do? | `intent.md` |
| What rules must every agent follow? | `CLAUDE.md` |
| How does a request get written? | `.github/ISSUE_TEMPLATE/change-request.yml`, `templates/intent-template.md`, `agents/requirement-interviewer.md` |
| How is risk decided? | `agents/risk-check-agent.md`, `scripts/risk_check.py`, `.github/workflows/risk-check.yml` |
| What does the engineer check? | `agents/engineer-review-checklist.md` |
| How does the product owner get it? | assigned + label `po:review` (see `risk-check.yml`), approval label triggers `handoff.yml` |
| What builds and tests? | `agents/design-agent.md`, `agents/code-agent.md`, `agents/test-agent.md`, `tests/` |
| What blocks a half-decided spec? | `.github/workflows/definition-of-ready.yml` |
| Who must approve changes to the agents themselves? | `.github/CODEOWNERS` |
| The simple spec-demo app | `docs/` (published by `.github/workflows/pages.yml`) |
| The platform: API and Claude agents | `app/server.js`, `app/lib/` |
| Control Room, Request Workspace, Patient Portal | `app/web/control-room`, `app/web/workspace`, `app/web/patient` |
| Deploying the platform on Render | `render.yaml`, `app/build-site.sh` |
| Spec drafter and photo reader instructions | `agents/spec-drafter.md`, `agents/vision-reader.md` |
| A prepared change to rehearse with | `rehearsed/v1.1-hypertension.patch` |

## What is real and what is not

Real in the platform: requests are captured by a Claude interviewer, drafted into intent.md sections by Claude, risk-checked (rules plus Claude), routed to a product owner and engineer with enforced roles, and patients can add readings and photos that Claude reads and code validates. Needs `ANTHROPIC_API_KEY`; without it the app runs in clearly labelled scripted mode.

Real in the repository: the issue form, the risk-check agent (rules always; model if you add an API key), labels, assignment, comments, tests, the Definition of Ready check, the deployment.
Not automated here: the requirement interviewer and design agent are instruction files you run in Claude (chat or Claude Code); the code agent is run by you with Claude Code. Wiring those to run on a label is a documented next step, not part of this demo.
All patients are invented. Blood pressure targets in the rehearsed change are placeholders pending sign-off (decision D2), not clinical guidance.

See `SETUP.md` to put this on GitHub and `SETUP.md` section 6 for the demo script.

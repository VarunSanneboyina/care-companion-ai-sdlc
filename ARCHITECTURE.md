# How Care Companion is built: architecture and languages

Written for a product person. Read top to bottom once; the last section is what to say if asked.

## 1. The picture

```
 THREE INTERFACES (what people see, each hosted on its own URL)
 ┌────────────────┐  ┌────────────────────┐  ┌────────────────┐
 │  Control Room  │  │ Request Workspace  │  │ Patient Portal │
 │ watch requests │  │ write a requirement│  │ add readings,  │
 │ flow, audit log│  │ draft intent.md,   │  │ photo of result│
 │ kill switch    │  │ review & approve   │  │                │
 └───────┬────────┘  └─────────┬──────────┘  └───────┬────────┘
         │   HTTPS + JSON      │                     │
         └─────────────────────┼─────────────────────┘
                               ▼
 ONE BACKEND (the API) ── Node.js server
 ┌───────────────────────────────────────────────────────────┐
 │  Rules in CODE: who may do what, number validation,       │
 │  routing, Definition of Ready, decision numbering,        │
 │  merging intent.md, audit log                             │
 │                                                           │
 │  AGENTS (each = instruction file + a model call):         │
 │   interviewer · spec drafter · risk-check · vision reader │
 └───────┬───────────────────┬──────────────────┬────────────┘
         ▼                   ▼                  ▼
   Claude (Anthropic    Data store         GitHub (optional)
   API): language       (JSON file today,  creates the issue that
   and judgement        a database later)  starts the repo pipeline

 THE REPOSITORY (GitHub) holds the instruction files, the spec, the tests
 and the pipeline that checks every change before it goes live.
```

## 2. What each language is for

| Language / format | Where it is used | Plain-English role |
| --- | --- | --- |
| HTML | `app/web/*/index.html` | The structure of each screen: headings, forms, buttons |
| CSS | `app/web/shared/style.css` | How it looks: colours, spacing, dark mode, phone layout |
| JavaScript (in the browser) | the `<script>` in each page, `shared.js` | What happens when someone clicks: sends requests to the API, redraws the screen |
| JavaScript (Node.js, on the server) | `app/server.js`, `app/lib/*.js` | The backend: receives requests, enforces rules, calls Claude, saves data. Same language as the browser, so one language end to end |
| JSON | API messages, `state.json`, model replies | The format programs use to pass structured data to each other |
| Markdown (`.md`) | `agents/*.md`, `intent.md`, `CLAUDE.md` | Instructions and specs written in plain text that humans and models both read |
| YAML (`.yml`) | `.github/workflows/*`, issue form, `render.yaml` | Configuration: "when this happens, run these steps" |
| Python | `scripts/risk_check.py` | A small script the GitHub pipeline runs for the risk check (the app has the same rules in JavaScript) |

No framework (React, Express, a database) is used on purpose. The code is small enough to read in an afternoon, and nothing needs installing. In a real product you would likely add a framework and a database; the shape stays the same.

## 3. How the pieces talk

- **Browser to backend**: the page calls the API with `fetch`, sending and receiving JSON over HTTPS. Example: the Workspace sends `POST /api/requests/R-001/draft`. The server replies with the updated request.
- **Why separate sites work**: each site is only static files. They find the API through `config.js` (`API_BASE`). The backend lists which sites may call it (CORS). That is why the three interfaces can live on three URLs and still share one set of data.
- **Backend to Claude**: an HTTPS call to the Anthropic Messages API with the agent's instruction file as the system prompt, plus the conversation. The reply is JSON. For photos, the image is sent as part of the message.
- **Backend to GitHub**: one call to GitHub's API to create an issue in the issue-form format, which wakes up the repository pipeline.

## 4. Model versus code (the most important design idea)

| The model does (language) | The code does (must be exact) |
| --- | --- |
| Asks the next good question | Decides who is allowed to approve |
| Turns answers into a spec section | Numbers decisions D2, D3 and merges sections into intent.md |
| Judges whether a request sounds risky | Keyword risk rules; the stricter of rules and model wins |
| Reads digits from a photo | Rejects values outside the allowed range |
| | Blocks approval while a decision is Open |
| | Writes the audit log, applies the kill switch |

Anything that must be right every time is code. Anything that is about wording or judgement is the model, and the code checks its answer.

## 5. A request, step by step

1. Requester opens the **Workspace**, types a wish. Backend creates the request and the **interviewer** asks question one.
2. Each answer goes to the backend; the interviewer (model) returns the next question and the fields it has filled.
3. Requester reviews the filled template, ticks what it touches.
4. **Spec drafter** (model) writes the intent.md section, a screen description and the decisions to settle. Code assigns numbers later.
5. Requester submits. **Risk-check** runs: rules in code, then the model; the stricter result sets the lane.
6. The **Control Room** shows the request move to Product owner. The audit log records each step.
7. Product owner resolves decisions and approves. Code refuses approval while any decision is Open.
8. If the lane is engineer, the engineer reviews the checklist and approves.
9. The approved request becomes a **build brief** (for Claude Code) or a **GitHub issue**; the repository's pipeline, tests and review take over.
10. After merge the engineer marks it released. The **kill switch** can switch a feature off without a new release.

## 6. Where everything is hosted

| Piece | Host | Why |
| --- | --- | --- |
| API | Render web service | Needs to run code and keep your secret key private |
| Control Room, Workspace, Patient Portal | Render static sites (three URLs) | Only files, so cheap and fast |
| Repository, pipeline, tests, the simple spec-demo app | GitHub and GitHub Pages | The record of every change and who approved it |
| Claude | Anthropic API | The model; your key stays on the API service, never in the browser |

## 7. What this demo is not (say it before you are asked)

- Roles are a menu, not real login. The access code and role codes keep casual visitors out, but a production system needs proper sign-in and per-user permissions.
- Data is a JSON file. On Render's free plan it resets when the service restarts. Production needs a database, backups and encryption.
- Sample patients only. Real patient data would need a compliance review, a data agreement with the model provider, and audit controls.
- The code agent is not triggered automatically; a human runs it with Claude Code from the build brief.
- The risk check reads text, not code. Tests and human review remain the safety net.
- The free Render API sleeps when idle; the first request after a pause takes about a minute.

## 8. If Lohi asks "what stack is this and why?"

"Plain JavaScript front to back, so one language and no framework to maintain in a demo. The interesting part is not the stack, it is the split: language work goes to the model, anything that must be exact is code, and every agent's instructions are files in the repository that people can review like any other change. I would swap in a framework and a database for production; the architecture would not change."

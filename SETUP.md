# SETUP: GitHub-only demo

> For the full step-by-step (accounts, Claude key, Render, testing), start with `GETTING-STARTED.md`. This file covers the GitHub repository demo and its script.

There are two deployments. **Part A (sections 1 to 5)**: the GitHub repository and pipeline. **Part B (section 9)**: the platform on Render with three interfaces on three URLs. Do Part A first; Part B uses the same repository.

Time: about 30 minutes. Do it the day before, then rehearse once.

## 1. Create the repository
1. github.com -> New repository. Name: `care-companion-ai-sdlc`. Public is simplest (Pages is free on public repos; private needs a paid plan). It is all sample data.
2. Click "uploading an existing file". Upload the CONTENTS of this folder, including the hidden `.github` folder. Dragging the folder from Finder or Explorer works if hidden files are shown (Mac: Cmd+Shift+. ; Windows: View -> Show hidden items).
3. Commit to `main`.
4. Check: Code tab shows `.github`, `agents`, `docs`, `scripts`, `templates`, `tests`.

## 2. Make the owner file yours
Edit `.github/CODEOWNERS`. Replace every `@YOUR-USERNAME` with your GitHub username. Commit.

## 3. Turn on the app (GitHub Pages)
Settings -> Pages -> Source: **GitHub Actions**. Then Actions tab -> "Deploy app" -> Run workflow. After about a minute the app URL appears on that run. Open it. This is the "actual tool deployed".

## 4. Labels, variable and the optional model key
- Settings -> Secrets and variables -> Actions -> **Variables** -> New: name `PRODUCT_OWNER`, value your username (so requests get assigned to the product owner).
- **Optional but better for the demo**: Secrets -> New: `ANTHROPIC_API_KEY` with a key from console.anthropic.com. Without it the agent runs rules-only and says so in its comment. With it, the comment says "rules + model".
- Settings -> Actions -> General -> Workflow permissions: allow read and write. (Needed so the workflow can comment and label.)

## 5. Test it before Lohi sees it
1. Issues -> New issue -> "Change request". Fill it with: "Add sort by latest HbA1c", tick "None of these". Submit.
2. Within a minute: a comment from the Risk-check agent, label `risk:auto`, label `po:review`. 
3. Create a second request: "Let patients keep a card on file". Expect `risk:engineer`.
4. Add label `po:approved` to either. Expect the handoff comment.
5. Rehearse the pull request: create branch `spec-v1-1`, apply the rehearsed change (see below). Expect the **Definition of Ready** check to FAIL, then pass once D2 is Resolved.

Applying `rehearsed/v1.1-hypertension.patch` without a terminal: open `intent.md`, `docs/logic.js`, `docs/index.html` and `tests/logic.test.js` on the branch and copy in the changes from the patch (lines starting with +). Or on a computer with Git: `git checkout -b spec-v1-1 && git apply rehearsed/v1.1-hypertension.patch && git commit -am "Spec v1.1: hypertension tracking" && git push -u origin spec-v1-1`, then open the pull request.

If an Action fails, open it and read the red step; nothing here is hidden. Not tested on real GitHub by me: the workflows, issue form and Pages deployment. The scripts, logic, tests, app and patch were tested locally. Expect to fix small things on first run, which is why you rehearse.

## 6. Demo script (10 minutes)
1. **Show the product**: the Pages URL. "Sample data, invented patients."
2. **Intent**: open `intent.md`. "This is the product in plain words, plus a Decisions table. Open decisions block a merge."
3. **Rules for agents**: `CLAUDE.md`. "Always, Never, and what needs an engineer."
4. **Intake**: Issues -> New -> the form. "This form is the requirement agent's output format; the interviewer instructions are in `agents/requirement-interviewer.md`." Submit the hypertension request, ticking Personal data and Clinical thresholds.
5. **Risk agent**: show the comment and `risk:engineer` label. Open `agents/risk-check-agent.md` and `scripts/risk_check.py`. "Rules in code plus model judgement; stricter wins."
6. **Product owner**: show the assignment and `po:review`. Add `po:approved`. Show the handoff comment.
7. **Build**: show `agents/code-agent.md`; open the rehearsed pull request. Show the Definition of Ready failing, then resolving D2.
8. **Engineer**: show `agents/engineer-review-checklist.md` and CODEOWNERS forcing a human. Merge. Pages redeploys; refresh the app to see blood pressure.
9. **Limits (say these first, do not wait to be asked)**: the interviewer and code agents are run by me with Claude, not yet triggered automatically; the risk check reads text, not code, and engineers sample the fast lane; sample data only.

## 7. Questions Lohi may ask, and honest answers
- **How did you create the intent.md template?** I listed what engineers always have to ask after a vague request, kept only the questions whose missing answer caused rework, and matched the fields to the issue form and risk categories. Reasoning is at the bottom of `templates/intent-template.md`. I drafted it with Claude and edited it myself.
- **What instructions does the requirement agent have, and how does it act?** `agents/requirement-interviewer.md`: reads intent.md first, asks one question at a time, maximum 8, never invents thresholds, logs unknowns as open decisions.
- **How does a satisfied request reach the product owner?** The risk-check workflow assigns the issue to the product owner and labels it `po:review`; approval is the `po:approved` label, which triggers the handoff.
- **What goes to the risk agent and to the engineer?** Risk agent: the request, intent.md, CLAUDE.md. Engineer: the request, risk categories, a specific checklist, the diff and the tests.
- **What if the model is wrong?** Rules run first and the stricter result wins; the model can only escalate. Engineers sample fast-lane changes.
- **Why GitHub?** Every step leaves a record: who requested, who approved, what changed, which checks passed. That is the audit trail.
- **What would you do next?** Trigger the code agent from the approval label with the Claude Code GitHub Action, add evals for the risk agent on a labelled set of past requests, and a feature switch for staged rollout.

## 8. Cost and safety
The model call is one short message per request; cost is negligible. Never put real patient data in an issue. Never commit your API key; it lives only in Actions secrets.

## 9. Part B: deploy the platform on Render (three interfaces, three URLs)

You need a Render account (render.com, sign in with GitHub) and an Anthropic API key (console.anthropic.com, add a few dollars of credit; the demo costs cents).

1. Render dashboard -> New -> **Blueprint** -> choose your `care-companion-ai-sdlc` repository. Render reads `render.yaml` and proposes four services: `care-companion-api`, `care-companion-control-room`, `care-companion-workspace`, `care-companion-patient`. Apply.
2. When asked for values on the API service, set `ANTHROPIC_API_KEY` (your key) and `ACCESS_CODE` (a word you will give Lohi, for example `lohi-demo-2026`). Leave the rest blank for now.
3. Wait for the API to go live. Open its URL plus `/api/health`; you should see `{"ok":true}`.
4. Note the four URLs (they look like `https://care-companion-api.onrender.com`). On each of the **three static sites**, open Environment and set:
   - `API_URL` = the API URL
   - `CONTROL_ROOM_URL`, `WORKSPACE_URL`, `PATIENT_URL` = the three site URLs
   Then Manual Deploy -> Deploy latest commit on each site (this writes the addresses into the pages).
5. Open the Workspace URL. The badge at the top should say **Claude connected**. If it says "Scripted mode", the API has no key; if "API unreachable", the API URL in step 4 is wrong or the API is still waking up.
6. Optional "Send to GitHub": create a GitHub token (Settings -> Developer settings -> Fine-grained tokens, repository access only to this repo, permission Issues: read and write). On the API service set `GITHUB_TOKEN` and `GITHUB_REPO` (`yourname/care-companion-ai-sdlc`). The request then becomes a real issue that triggers the risk-check workflow from Part A.
7. Optional hardening: set `PO_CODE` and `ENGINEER_CODE` on the API so only people who know them can act as product owner or engineer, and `CORS_ORIGINS` to the three site URLs.
8. Custom domain, if you want one: Render -> the site -> Settings -> Custom Domains. A free `onrender.com` address is fine for the demo.

Free plan notes: the API sleeps after about 15 idle minutes and takes up to a minute to wake, so open the Workspace once before the call. Data resets when the API restarts; reset or reseed before the demo with a quick request.

### Try it locally first (optional, needs Node 20+)
`cd app && ANTHROPIC_API_KEY=your-key node server.js`, then open http://localhost:3000. All three interfaces run from this one command. Without a key it starts in scripted mode. Tests: `cd app && npm test`.

### Platform demo script (about 10 minutes)
1. **Control Room**: "Everything flows through here. Each button is an agent; click one to see its exact instructions." Open the risk-check agent.
2. **Workspace**: act as Requester. Create "Hypertension tracking" with a rough wish. Let the interviewer ask questions. Show tab 2 (the filled template) and the template file.
3. Tab 3: **Draft with Claude**. Show the intent.md section, the screen description and the decisions it raised. Open the spec drafter instructions.
4. Tab 4: **Submit**. Show the risk result and the lane. Switch the Control Room to see it move.
5. Switch "Acting as" to **Product owner**. Try Approve with an open decision: it is refused (Definition of Ready). Resolve the decision, approve.
6. Switch to **Engineer**. Show the checklist, approve, show the build brief.
7. **Compose intent.md** from two requests to show a merged spec with decisions.
8. **Patient Portal** on your phone: upload a photo, confirm the number, save. Back in the Control Room, flip the **kill switch** and show the field disappear.
9. State the limits from ARCHITECTURE.md section 7 first, not last.

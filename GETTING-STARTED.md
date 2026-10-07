# Getting started: from this folder to a live, working demo

Read this top to bottom once, then do it step by step. Allow about 90 minutes the first time, longer if you are creating accounts. Do it a day before the call.

## What you are building

```
Requester ──► REQUEST WORKSPACE ──► completeness check (code) ──► Claude drafts a new intent.md
                                                                     │
                                                                     ▼
                         risk check (rules + Claude): payments, login, customer/health data, clinical rules
                                                                     │
                                                                     ▼
                  PRODUCT OWNER reviews, resolves open decisions, approves  ──► engineer too, if flagged
                                                                     │
                                                                     ▼
                         PRODUCT OWNER pushes ──► GitHub pull request with the new intent.md
                                                                     │
                                                                     ▼
                        checks run (Definition of Ready, tests) ──► human merges ──► live
```

The Workspace has one job: **make sure the requester gives you everything you need to draft the requirement** (why it is needed, who benefits, what happens today, what should change, how it will work, how we will know it works, and whether it touches payments, login, health data or clinical rules). The app checks this in code. Claude cannot mark a request complete while a detail is missing.

The product owner stays in charge of the backlog: nothing reaches GitHub until the product owner approves it and presses Push. Risky requests (payments, login, personal or health data, clinical rules) are flagged and also need an engineer.

## The order of work

1. Create three accounts (GitHub, Anthropic, Render).
2. Put the files in GitHub.
3. Get a Claude API key.
4. Get a GitHub token (so the app can open the pull request).
5. Deploy on Render.
6. Connect everything (environment variables).
7. Test, with the exact examples below.

---

## Step 1: Accounts

| Account | Where | Cost | Needed for |
| --- | --- | --- | --- |
| GitHub | github.com | Free | Holds the files, runs the checks, receives the pull request |
| Anthropic Console | console.anthropic.com | Pay as you go. Add about 5 USD of credit; the demo uses cents | The Claude API key |
| Render | render.com (sign up with "GitHub") | Free plan is enough | Hosts the API and the three interfaces |

Important: a Claude.ai chat subscription is **not** the same as API credit. The API is billed separately in the Console.

**You do not need a Render API key.** Render deploys by reading your GitHub repository. (Render has its own API key under Account Settings, but nothing in this project uses it.)

---

## Step 2: Put the files in GitHub

### 2.1 Create the repository
1. github.com, click **+** (top right), **New repository**.
2. Name: `care-companion-ai-sdlc`.
3. **Public** is simplest, because everything is sample data and Pages is free for public repositories. Private also works for the Render part.
4. Tick **Add a README**? No. Leave it empty. Click **Create repository**.

### 2.2 Upload the files
1. Unzip `care-companion-ai-sdlc.zip` on your computer. You get one folder with the files below.
2. In the new repository, click **uploading an existing file**.
3. Drag the **contents** of the unzipped folder (not the folder itself) into the page.
4. **Hidden folder warning**: the folder `.github` starts with a dot, so your computer hides it. Show hidden files first: Mac, press Cmd+Shift+. in Finder; Windows, File Explorer, View, Show, Hidden items. If `.github` is missing in the repository afterwards, none of the GitHub checks will work.
5. GitHub's web upload accepts about 100 files at a time. This project has about 70, so one batch should work. If it complains, upload in two batches (first `.github`, `agents`, `app`, then the rest).
6. Commit message: "Add Care Companion". Commit to **main**.

### 2.3 What should be in the repository
Check each line against the repository's file list.

| Path | What it is | Required? |
| --- | --- | --- |
| `app/server.js`, `app/lib/` | The backend: API, Claude agents, risk rules, GitHub push | Yes |
| `app/web/control-room/`, `app/web/workspace/`, `app/web/patient/`, `app/web/shared/` | The three interfaces and their shared styling | Yes |
| `app/build-site.sh` | Writes each site's settings at deploy time | Yes |
| `app/test/` | Automated tests for the platform | Recommended |
| `render.yaml` | Tells Render what to create (4 services) | Yes |
| `agents/*.md` | The instruction files each agent is given (interviewer, spec drafter, risk check, engineer checklist, design, code, test, photo reader) | Yes. The app reads these at runtime |
| `templates/intent-template.md` | The request template | Yes |
| `intent.md` | The current spec. The new intent.md is built from this | Yes |
| `CLAUDE.md` | Working agreements every agent follows | Yes |
| `docs/` | A tiny stand-alone app (published with GitHub Pages) and its rules | Yes. The backend reuses `docs/logic.js` |
| `tests/` | Tests for `docs/logic.js` | Recommended |
| `.github/workflows/` | Checks: Definition of Ready, risk check on issues, tests, Pages deploy | Recommended |
| `.github/ISSUE_TEMPLATE/change-request.yml` | The issue form (the second way in) | Recommended |
| `.github/CODEOWNERS` | Who must approve changes to agents, spec and rules | Recommended |
| `scripts/risk_check.py` | The risk check that the GitHub workflow runs | Recommended |
| `rehearsed/v1.1-hypertension.patch` | A prepared change for the demo | Optional |
| `README.md`, `ARCHITECTURE.md`, `SETUP.md`, `GETTING-STARTED.md`, `TEST-CASES.md` | Documentation | Optional |

### 2.4 Make the owner file yours
1. Open `.github/CODEOWNERS`, click the pencil.
2. Replace every `@YOUR-USERNAME` with your GitHub username.
3. Commit.

### 2.5 Allow the workflows to write comments
Repository **Settings**, **Actions**, **General**, **Workflow permissions**: choose **Read and write permissions**, Save.

### 2.6 Check the checks work
Click the **Actions** tab. After a minute you should see "Tests" run on your commit and go green. If it is red, open it and read the failing step; see Troubleshooting.

---

## Step 3: Get the Claude API key

1. Go to **console.anthropic.com** and sign up or sign in.
2. Add credit: **Settings** (or **Plans and billing**), **Buy credits**, 5 USD is plenty. Without credit, every Claude call fails.
3. Optional but wise: set a monthly **spend limit** (Settings, Limits) of 10 USD.
4. **Settings**, **API Keys**, **Create Key**. Name it `care-companion-render`.
5. Copy the key immediately (it starts with `sk-ant-`). You cannot view it again. Paste it into a private note for now.
6. Never put the key in GitHub, a chat, or a screenshot. It goes only into Render's environment settings (Step 5).

Which model: the app defaults to `claude-sonnet-4-5`. If the Console says that name is retired or not found, open the Console's model list, copy the current Sonnet name, and put it in the `CLAUDE_MODEL` variable on Render. No code change is needed.

---

## Step 4: Get a GitHub token (so the product owner's Push button works)

This lets the app open the pull request in your repository, and only in that repository.

1. GitHub, your profile picture, **Settings**, **Developer settings** (bottom of the left menu), **Personal access tokens**, **Fine-grained tokens**, **Generate new token**.
2. Name: `care-companion-push`. Expiration: 30 days is fine.
3. **Repository access**: **Only select repositories**, choose `care-companion-ai-sdlc`.
4. **Permissions**, **Repository permissions**: set **Contents: Read and write**, **Pull requests: Read and write**, **Issues: Read and write** (needed to label the pull request). Metadata is added automatically.
5. **Generate token**, copy it (starts with `github_pat_`). Keep it private like the Claude key.

---

## Step 5: Deploy on Render

### 5.1 Create the four services from one file
1. render.com, sign in with GitHub. Authorise Render to see your `care-companion-ai-sdlc` repository.
2. **New**, **Blueprint**, choose the repository, branch `main`. Render reads `render.yaml` and lists four services:
   - `care-companion-api` (the backend)
   - `care-companion-control-room`
   - `care-companion-workspace`
   - `care-companion-patient`
3. It asks for the values marked "sync: false". For the **API** fill in:
   - `ANTHROPIC_API_KEY`: the Claude key from Step 3
   - `ACCESS_CODE`: a passcode you choose, for example `lohi-demo-2026`. You will give this to Lohi
   - `GITHUB_TOKEN`: the token from Step 4
   - `GITHUB_REPO`: `your-github-username/care-companion-ai-sdlc`
   - Leave `PO_CODE`, `ENGINEER_CODE` and `CORS_ORIGINS` empty for now
   For the three sites you can leave the URL fields empty; you fill them in 5.3.
4. Click **Apply** (or Deploy Blueprint). The first build takes a few minutes.

### 5.2 Check the API
1. Click `care-companion-api`. At the top is its address, like `https://care-companion-api-xxxx.onrender.com`.
2. Open that address plus `/api/health` in a browser. You should see `{"ok":true}`.
3. Open `/api/config`. You should see `"live":true` and the model name. If `live` is `false`, the Claude key was not saved.

### 5.3 Tell each site where the API and its neighbours are
Each of the three sites is only static files. They learn the addresses when they are built. For **each of the three sites**:
1. Open the site in Render, **Environment**.
2. Set:
   - `API_URL` = the API address from 5.2
   - `CONTROL_ROOM_URL`, `WORKSPACE_URL`, `PATIENT_URL` = the three site addresses
3. **Manual Deploy**, **Deploy latest commit**.

### 5.4 Open the three interfaces
Open each address. At the top right each should show a green badge: **Claude connected**. When asked, type your access code.

If a badge says **Scripted mode**, the API has no Claude key. If it says **API unreachable**, the `API_URL` in 5.3 is wrong, or the free API is still waking up (wait a minute and refresh).

Free plan note: the API sleeps when idle and takes up to a minute to wake. Open the Workspace once before any demo.

---

## Step 5b: Switch on the code agent (so the merged spec becomes code)

After the product owner's `intent.md` pull request is merged, a GitHub Action called **Code agent** reads the change, asks Claude to write the code and tests, runs the tests, and opens a second pull request. You review and merge that one.

1. GitHub, your repo, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**. Name: `ANTHROPIC_API_KEY`. Value: your Claude key (typed here, never in chat). Save.
2. **Settings**, **Actions**, **General**, scroll to **Workflow permissions**, choose **Read and write permissions**, tick **Allow GitHub Actions to create and approve pull requests**, Save.
3. Done. Nothing else to deploy.

How to know it is ready: **Actions** tab shows a workflow named **Code agent**.

---

## Step 6: How everything connects (one table)

| Setting | Set on | Value comes from | What it does |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Render, API service | console.anthropic.com | Lets the backend call Claude |
| `CLAUDE_MODEL` | Render, API service | Console model list | Which Claude model |
| `ACCESS_CODE` | Render, API service | You choose | Keeps strangers off your demo and your Claude credit |
| `GITHUB_TOKEN`, `GITHUB_REPO` | Render, API service | Step 4 | Lets Push open a pull request |
| `PO_CODE`, `ENGINEER_CODE` | Render, API service (optional) | You choose | Extra codes to act as product owner or engineer |
| `API_URL` | Render, each site | The API address | Where the sites send their requests |
| `CONTROL_ROOM_URL`, `WORKSPACE_URL`, `PATIENT_URL` | Render, each site | The three site addresses | The links between the interfaces |
| Pages source = GitHub Actions | GitHub, Settings, Pages (optional) | n/a | Publishes the small `docs/` app |

---

## Step 7: Test it

Do these in order. Tests 1 to 3 take ten minutes. The full list with expected results is in `TEST-CASES.md`.

### Test 1: smoke test
1. API `/api/health` shows `{"ok":true}`.
2. All three interfaces show **Claude connected**.

### Test 2: the main flow (use these exact words)
Open the **Workspace**. Leave "Acting as" on **Requester**.

1. New request. Title: `Hypertension tracking`. What do you want: `We want patients to log blood pressure too, not just HbA1c`. Your name: `Lohi`. Click **Start**.
2. Claude asks questions one at a time. Answer roughly:
   - Why: `Care coordinators manage diabetes and hypertension patients and need one view; today they switch between two systems and miss follow-ups.`
   - Who benefits: `Care coordinators save time; patients with both conditions get fewer missed follow-ups.`
   - Today: `A coordinator has to open a second tool to see blood pressure.`
   - Different: `Blood pressure shown next to HbA1c in the patient list.`
   - How: `The patient enters two numbers with their HbA1c. The list shows the latest reading with an Above target flag.`
   - Checks: `Impossible values are rejected. A valid reading appears straight away.`
   - Touches: `Personal or health data, and clinical thresholds.`
   - Undecided: `Who approves the Above target numbers? The clinical lead.`
3. **Expected**: the completeness box counts up to "7 of 7" and says every required detail is in. Try stopping early: the **Draft with Claude** button stays disabled while any detail is missing.
4. Tab **3 Spec and screen**, click **Draft with Claude**. **Expected**: a section for intent.md that opens with Why, Who benefits and How it works, a screen description, and one open decision.
5. Tab **4 Risk and review**, click **Submit for review**. **Expected**: "Engineer review required", categories `PERSONAL_DATA` and `CLINICAL_LOGIC`, "Checked by: rules + model".
6. Switch **Acting as** to **Product owner**. Tab 3: type a resolution for the open decision (`Clinical lead signs off before release`), Save. Tab 4: click **Approve**. **Expected**: status becomes Engineer review. (Try approving first, before resolving the decision: it must refuse.)
7. Switch to **Engineer**, tab 4, **Approve**. **Expected**: status Approved.
8. Switch back to **Product owner**, tab 4. Click **Preview new intent.md**. **Expected**: version 1.1, your section added, decisions D2 present and Resolved, "Definition of Ready: passes".
9. Click **Push to GitHub as pull request**.
10. In GitHub, open **Pull requests**. **Expected**: a new pull request "Spec v1.1: Hypertension tracking" from a branch named `intent/r-001-...`, changing only `intent.md`, labelled `risk:engineer`, with the Definition of Ready check running and passing. Merging is your decision.

The Control Room, open in another tab, shows the request move across the board and every step in the activity log.

**Then the code agent (the new part).**
11. Merge the `intent.md` pull request. Open the **Actions** tab. **Expected**: a **Code agent** run starts within a minute and takes 2 to 5 minutes.
12. **Expected**: a new pull request titled by the agent, from a branch `agent/code-...`, listing the files changed, the test result, the risk lane and how to switch it off. Anything touching health data is labelled `risk:engineer`.
13. Read the pull request like a reviewer. Merge it. Render redeploys the API and sites (a few minutes). Open the Patient Portal: the enhancement is there.
14. If the agent cannot build without guessing (the spec lacks a number or rule), it opens an **issue** with its questions instead of a pull request. That is the intended behaviour: answer by changing the spec.

If the Code agent run fails: open it, read the summary at the top. Typical causes: the `ANTHROPIC_API_KEY` secret is missing, the "create pull requests" setting is off, or the agent could not get tests to pass in 3 attempts (no pull request is opened in that case).

### Test 3: the Patient Portal
1. Open the Patient Portal on your phone.
2. Choose a patient. Add an HbA1c of `25`. **Expected**: refused (range is 3.0 to 20.0).
3. Add `7.2`. **Expected**: appears at the top of the history with a status against the target.
4. Photo test: on paper or a screen write `HbA1c 7.4 %` in large print, photograph it, and upload it. **Expected**: the box fills with 7.4 and asks you to confirm before saving. Photos that are not results (a table, a face) should return "could not read", never a made-up number.
5. In the Control Room, switch to **Product owner** and tick the **Blood pressure tracking** switch. Refresh the Patient Portal: the blood pressure fields appear. Untick: they disappear without a deployment (the kill switch).

### Test 4: try to break it
Run the negative cases in `TEST-CASES.md` (wrong role, vague answers, unresolved decisions, bad numbers, no access code).

### Test 5: automated tests
These run by themselves on every change (GitHub, Actions tab, "Tests"). To run them on your computer you need Node 20 or newer:
```
node --test tests/*.test.js
cd app && npm test
```
Expect 14 and 29 passing.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Badge says **Scripted mode** | No Claude key on the API | Render, API, Environment, add `ANTHROPIC_API_KEY`, save (it redeploys) |
| Badge says **API unreachable** | `API_URL` wrong, not redeployed, or API asleep | Fix `API_URL`, redeploy the site, wait a minute, refresh |
| Claude replies are scripted or generic even with a key | Model name or credit problem. The Log tab shows "scripted (model call failed ...)" | Check credit in the Console; set `CLAUDE_MODEL` to a current model |
| "Access code required" loop | Wrong code | Clear the tab's session storage or reopen in a private window |
| Push button is greyed out | `GITHUB_TOKEN` or `GITHUB_REPO` missing | Add both on the API service |
| Push says "GitHub ... said 404" | Repo name wrong or token has no access | `GITHUB_REPO` must be `username/repo`; token must include that repo |
| Push says "said 403" or "422" | Token lacks Contents or Pull requests write | Recreate the token with the Step 4 permissions |
| `.github` is missing in the repository | Hidden folder was not uploaded | Show hidden files, upload the folder again |
| Risk-check workflow does not comment | Workflow permission is read-only | Step 2.5 |
| Data vanished | Free Render storage is wiped on restart | Expected on the free plan; recreate your demo request |
| Site shows old links | Static site not rebuilt after setting variables | Manual Deploy on that site |

## What it costs
Render free plan: 0. GitHub: 0. Claude: a full demo run uses a few cents. The access code and the spend limit protect your credit.

## Safety rules to keep
Sample data only. Never paste a real patient photo or record. Never share your Claude key or GitHub token. Do not post the demo's address publicly without the access code set.

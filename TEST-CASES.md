# Test cases

Two kinds: **automated** (43 tests that run by themselves, with a fake Claude and a fake GitHub so they are free and repeatable) and **manual** (what you do with your own hands on the live demo). Tests prove the rules work; they do not prove Claude's wording is good, which is why the manual list exists.

Run automated tests: `node --test tests/*.test.js` (14 tests) and `cd app && npm test` (29 tests). They also run on every change in GitHub, Actions tab, "Tests".

## A. Automated: the rules in `docs/logic.js` (7 tests)

| # | Test | Why it matters |
| --- | --- | --- |
| A1 | HbA1c inside 3.0 to 20.0 is accepted | The stated rule in `intent.md` works at both ends |
| A2 | HbA1c outside 3.0 to 20.0, text and blank are rejected | Bad data never enters |
| A3 | A submitted reading appears immediately as the latest | Acceptance criterion in the spec |
| A4 | An invalid reading is not stored | Rejecting must mean not saving |
| A5 | Status is judged against the configured target | Targets come from configuration, not hard-coded advice |
| A6 | Search filters by name, case-insensitive | Existing feature keeps working |
| A7 | Sort orders by latest HbA1c | Existing feature keeps working |

## B. Automated: the platform API (29 tests)

**Setup and the Claude link**

| # | Test | What it proves |
| --- | --- | --- |
| B1 | Config reports live model; health is open | The badge logic and the Render health check work |
| B2 | Creating a request starts the interviewer, using the instruction file as the system prompt | What the UI shows as "agent instructions" is exactly what Claude receives, together with the current `intent.md` and your API key |

**Request Workspace: completeness**

| # | Test | What it proves |
| --- | --- | --- |
| B3 | While details are missing, the request is not ready and cannot be drafted | The "give me everything I need" gate is real, and lists what is missing |
| B4 | The interview completes only when every required detail is present; unknown touch options are dropped | Why, who benefits, problem, outcome, how, two checks and touches must all be answered; Claude cannot invent categories |
| B5 | Removing a required detail puts the request back to not ready | Completeness is decided by code, not by the model |
| B6 | Acceptance needs at least two checks | One vague check is not enough to test against |
| B7 | Scripted mode (no key) still runs the interview and enforces completeness | The demo degrades gracefully and honestly when Claude is unavailable |

**Drafting, risk and routing**

| # | Test | What it proves |
| --- | --- | --- |
| B8 | Cannot submit before drafting | The product owner always has a spec to review |
| B9 | Draft creates spec section, screen and decisions | The spec drafter and design agents' output is captured |
| B10 | Submit runs the risk check: health data means the engineer lane | Customer or health data is flagged; "rules + model" is recorded |
| B11 | The model can never downgrade a rules flag | A payment request stays flagged even if Claude says it is safe |
| B12 | A fast-lane request goes straight to approved after the product owner | Low-risk changes are not slowed down |

**Approvals, roles and the new intent.md**

| # | Test | What it proves |
| --- | --- | --- |
| B13 | Roles are enforced | A requester or engineer cannot approve as the product owner |
| B14 | Definition of Ready: the product owner cannot approve with an Open decision | Half-decided specs are blocked |
| B15 | Compose shows the Open decision and fails readiness; resolving it makes it pass | The new `intent.md` has the right version, a numbered decision row, and Open versus Resolved |
| B16 | Approve routes to the engineer; the engineer approves; the build brief is available | The two-step lane for risky changes; the brief carries why, who benefits, how |
| B17 | Request changes sends it back; the requester edits and resubmits | The review loop works |
| B18 | Release: only an engineer, only approved | Nothing goes live without the right person |

**Push to GitHub (against a fake GitHub)**

| # | Test | What it proves |
| --- | --- | --- |
| B19 | Not configured returns a clear message | You see "GitHub is not connected", not a crash |
| B20 | Only the product owner, only approved requests | Requesters and unapproved requests cannot push |
| B21 | Builds on the repository's current `intent.md` and opens a pull request | Order of GitHub calls: read current file, find main, create branch, commit, open pull request; the commit contains version 1.1, the new section and Resolved decisions; the engineer lane is labelled |

**Patient portal**

| # | Test | What it proves |
| --- | --- | --- |
| B22 | HbA1c is validated in code; blood pressure is refused while the feature is off | Out-of-range, future-dated and unauthorised data are rejected on the server, not just in the browser |
| B23 | Kill switch: requester cannot flip it; product owner can; blood pressure then works and validates | Features can be switched off without a release |
| B24 | Vision: the model's value is validated by code and the photo is not stored | Claude reads, code checks, the image is discarded |

**Real-world Claude behaviour**

| # | Test | What it proves |
| --- | --- | --- |
| B28 | If Claude answers in prose once, the app asks again and recovers | A chatty reply does not break the interview; the app tells Claude to answer in the required format and retries |
| B29 | If Claude keeps answering in prose, its own words are shown, not canned questions | The worst case still gives a sensible next question and nothing crashes |

**Security and hosting**

| # | Test | What it proves |
| --- | --- | --- |
| B25 | Only whitelisted instruction files can be read | Nobody can read `.env`, the server code or other files through the viewer |
| B26 | The access code protects the API; CORS allows the separate sites | Strangers cannot spend your Claude credit; the three sites can call the API from their own addresses |
| B27 | The three front-ends are served locally | Local run works with one command |

## B2. Automated: the code agent runner (7 tests, `tests/code-agent.test.js`, fake Claude)

| # | Test | What it proves |
| --- | --- | --- |
| E1 | A good plan is applied, tests pass, a pull request would open; the model was shown the spec change | The happy path |
| E2 | Edits to `.github/` or other forbidden files are rejected and the model must correct itself | The agent cannot change its own rules or workflows |
| E3 | A `find` text that does not match exactly once is rejected | Edits are exact, never fuzzy |
| E4 | Failing tests go back to the model; after three failures no pull request opens and the tree is restored | Nothing broken is ever proposed |
| E5 | The model can ask questions instead of guessing | The "do not invent a rule" principle |
| E6 | An Open decision in `intent.md` blocks the build before the model is called | Definition of Ready is enforced in code |
| E7 | Without an API key it stops and changes nothing | Fails safe |

These prove the rules around the model. They do not prove that Claude writes good code; judge that by reading the real pull request (C26 to C29).

## C. Manual tests on the live demo

Use sample data only. Tick each when it passes.

**Workspace: completeness**
- [ ] C1. Start a request, answer only "make it better" to the first question. The interviewer asks for a concrete example instead of accepting it.
- [ ] C2. Complete only five of the seven details. The completeness box lists exactly what is missing and **Draft with Claude** is disabled.
- [ ] C3. Complete all seven. The box says every required detail is in and Draft is enabled.
- [ ] C4. Edit the request in tab 2, delete the "how it works" text, Save. The request is "not ready" again.
- [ ] C5. Click "See its instructions" on the interview tab. The file shown matches what you expect Claude to be told.

**Drafting and risk**
- [ ] C6. Draft a request for "sort the patient list by name". It is labelled **Fast lane**.
- [ ] C7. Draft a request that mentions a card on file. It is labelled **Engineer review required** with category PAYMENTS.
- [ ] C8. Draft a request about "who can see a patient's records". It is flagged SECURITY or PERSONAL_DATA.
- [ ] C9. Check the draft: no invented numbers or thresholds; unknowns appear as decisions with a named owner.

**Product owner and engineer**
- [ ] C10. As Requester, try to approve. It is refused.
- [ ] C11. As Product owner, approve while a decision is Open. It is refused with a Definition of Ready message.
- [ ] C12. Resolve the decision, approve. A flagged request moves to Engineer; an unflagged one goes to Approved.
- [ ] C13. As Engineer, request changes with a note. As Requester, edit and resubmit; the notes are visible.
- [ ] C14. Preview new intent.md for two approved requests. Both sections appear in one document with the next version number.

**GitHub**
- [ ] C15. Push. A pull request opens containing only `intent.md`; the branch is named `intent/r-...`.
- [ ] C16. The Definition of Ready check runs on the pull request and passes.
- [ ] C17. Try to push a request that is not yet approved. The Push button is not offered, and the API refuses if called directly.
- [ ] C18. Merge the pull request. `intent.md` on `main` now shows the new version.
- [ ] C19. Open a GitHub issue from the **Change request** form with "Let patients pay a fee". The Risk-check workflow comments and labels it `risk:engineer`.

**Patient portal**
- [ ] C20. Add HbA1c `25`: refused. `2.9`: refused. `abc`: refused. `7.2` with tomorrow's date: refused.
- [ ] C21. Photograph a clearly written "7.4": the box fills with 7.4 and you confirm it. Photograph a table or a blurry page: it says it could not read it.
- [ ] C22. Control Room, Product owner, tick the blood pressure switch: the fields appear on the portal within about 15 seconds. Enter systolic 80, diastolic 120: refused. Untick the switch: the fields disappear.

**Code agent**
- [ ] C26. Merge an approved `intent.md` pull request. A **Code agent** run starts in the Actions tab.
- [ ] C27. It opens a pull request from `agent/code-...` with the files changed, test result, risk lane and switch-off note. Read the code: does it do only what the spec says, with a test?
- [ ] C28. Merge it. After Render redeploys, the enhancement appears on the Patient Portal.
- [ ] C29. Merge a spec change that leaves out a needed rule (for example, no allowed range). The agent opens an issue with questions instead of a pull request.

**Access and failure**
- [ ] C23. Open the API without the access code from a private window: refused.
- [ ] C24. Temporarily remove `ANTHROPIC_API_KEY` on Render. The badge says **Scripted mode** and the interview still works with fixed questions. Put the key back.
- [ ] C25. Set a wrong `GITHUB_TOKEN`. Push shows a clear GitHub error, and nothing breaks. Put the right one back.

## D. What these tests do not cover (say so honestly)

- The quality of Claude's questions, spec wording and photo reading. Judge them in the manual tests and in a real review, ideally against ten past requests your team has written.
- Real sign-in and per-person permissions. Roles are a menu protected by codes in this demo.
- Load, security testing and a data-protection review, needed before any real patient data.
- The GitHub workflows and the Render deployment, which can only be tested on the real services (that is what Step 7 is for).

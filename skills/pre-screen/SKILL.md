---
name: pre-screen
description: Run a commercial-loan pre-screen for a lead with the prescreen MCP tools - find the deal, pull its documents from the mailbox (IDP reads them and the cross-checks run at once), settle the document questions and the figures IDP's reading needs eyes on with the RM, run the numbers, check policy fit, have the RM approve the structure and draft the memo. Use when the RM asks to start, continue or check a pre-screen, asks what came in by email for a borrower, asks for document status, checks, numbers or the memo for a deal (e.g. "Start a pre-screen for Riverbend Roofing", "Pull in what they sent", "Run the numbers", "Draft the memo").
---

# Pre-screen playbook

You work for the relationship manager (RM), **${user_config.rm_name}**. The mailbox is the CRM: the
server reads it; you only ask the server to check it. Every tool is on the `prescreen` MCP server.
Nothing is ever sent to the borrower or to credit.

**The pre-screen pane is the RM's screen.** It opens by itself on your first pre-screen tool call and
draws the six steps, the checklist, every document and figure with its page, the checks, the numbers and
the structure, from the server's own payload, with the RM's buttons. Above the prompt the RM gets reply
buttons for the open step. So in the chat you say little: **the headline, what needs the RM, one
question.** No checklist, check or policy table in the chat, unless the RM asks for one or the pane
cannot be placed (`open_pane` says so; then give the review link, below).

## Hard rules

1. **No figure you did not get from a tool.** Every number you state names its source in brackets:
   the document and page/line or sheet cell from `inputs[].source`, "quick spread", "policy n.n" or
   "opportunity record". If a figure is missing, say it is missing.
2. **`decision_target` is copied, never built.** Take it from `exceptions[]`,
   `review.pending_confirmations[]` or `review.idp_blocks[]` exactly as returned.
3. **Decisions are the RM's.** Call `record_decision` only after the RM said so in this chat, with
   `actor` = "${user_config.rm_name}". Propose; don't decide. One decision per RM instruction.
4. **Decisions made in the pane are already recorded.** When the RM presses a button, the pane records it
   and sends you a prompt "Decided in the pre-screen pane, already recorded under …: …. Now: step n, …"
   (or, if that could not be sent, your next prompt carries "Since your last turn the RM decided in the
   pre-screen pane: …"). Take it as done and never record it again. Answer in a line or two: what is
   left for the RM now, as the "Now:" part and `opportunity_status` give it.
   **Do not ask the RM in chat to decide a document question or a figure**, and offer no reply buttons
   for one: say what waits and that the buttons are in the pane. A question left open in chat goes stale
   the moment the RM presses the button in the pane.
5. **A figure is confirmed only after the RM saw its page.** In Claude Code the pane shows each figure
   outlined on its page (and up close, and larger); the RM confirms there. If the RM confirms in chat
   after looking at it in the pane, record it with that item's `decision_target`, `confirm` and `value` =
   the figure shown. Where there is no pane, give `review_link` (with `actor` = "${user_config.rm_name}"):
   a page with the documents and the buttons, no account needed. `idp_review_url` is only for correcting
   a value in IDP.
6. `fail` means the figures disagree. `cannot_verify` means processing or a missing input. Never call
   `cannot_verify` a mismatch.
7. Long work: `collect_documents` and `run_checks` may come back `running`. Say it is in progress (the
   pane shows the progress), then call `get_operation` with the `operation_id` until it is `succeeded`,
   `failed` or `needs_attention`.
8. On a tool error, read the code before the colon and act on it (table below). Never retry blindly;
   never pass `force_new` unless the RM asks.
9. **Nothing is first said in the memo.** Tell the RM what you notice at the step where a payload first
   shows it: a missing input at step 1, a method note at the numbers. One line, with its source.

## The steps

`workbench_view` with `compact: true` returns `steps`, `stage`, `proposals` and `attention`: the server's
own view of where the deal is and what comes next (always pass `compact: true`: the full payload is too large
for one tool result). The pane and the reply buttons draw them; follow them rather than guessing.

### 1. Open the lead
"Start a pre-screen for <borrower>" → `list_opportunities`; match the borrower by name. If it exists,
`opportunity_status`; its `activity` and `latest_check_run` tell what changed since last time. If not,
ask the RM for what `start_prescreen` needs (borrower name and EIN, owners with %, loan type, amount,
term, rate, purpose, equipment cost and where it comes from (the quote number), the borrower's
contribution, the lender) and create it; never guess these.
Say in one or two lines: the borrower, the request (amount, term, rate), and what is missing from the
record: amount, term, rate, purpose, equipment cost, the borrower's contribution, the owners with their %.
Ask for a missing one; when the RM gives it, write it with `update_opportunity` (`request` = the field,
`actor` = "${user_config.rm_name}") and report any `warnings`. Do not work it out from other figures.

### 2. Pull in what they sent
"Pull in what they sent" → `collect_documents` (default source; `fixtures` only if the RM says
offline/demo files). One call does it all: the mail is collected and sorted, then **IDP reads the
documents and the ten cross-checks run, before the RM is asked anything**. The result carries the
collection and, under `check_run`, the read; either may still be running.
Say: who sent what (sender, subject, in a line), the `summary` ("7 accepted, 1 need review; checklist
7 of 7"), the checks in one line ("10 pass"), and what now needs the RM: the document questions and the
figure cards. Hand-filled or hard-to-read documents are **notes**, not questions: their figures come up
as cards once IDP has read them. Use `mailbox_overview` when the RM asks what came in, what is
unassigned, or why a message was not picked up (match terms).

### 3. The RM's checkpoint
Everything the RM settles here has IDP's reading behind it. The pane shows each item as a card with its
page and its buttons.
- **Document questions** (`exceptions[]`: another company's K-1, a wrong period, two candidates). When the
  payload gives a reason (`attribution_mismatch`, `period_mismatch` and the like), you may suggest a
  decision with `suggest_decision` (`target` = the exception's `decision_target`, `decision`, `why` = the
  reason code and its evidence in a line). The pane marks the suggested button; the RM decides. Never
  suggest on a figure.
- **Figures** (`review.pending_confirmations[]`; `attention[]` in `workbench_view` with `compact: true`): fields in use that
  IDP read as hand-written or under 0.95 confidence. A hand-filled page is one card. Say how many and on
  which page; the RM confirms them in the pane (rule 5).
- **What IDP held back** (`review.idp_blocks[]`: a blocking rule that failed or errored, a routing
  issue). Name it with its two sides and their sources. It clears when the values change (corrected in
  IDP, then `run_checks` `mode: "refresh"`) or when the RM goes on despite it: `record_decision` with
  its `decision_target`, `acknowledge`, and the RM's `reason`. It stays a failed check and becomes a key
  risk in the memo.
- RM corrected a value in IDP → `run_checks` with `mode: "refresh"`, then say what changed.
- The read set changed (a document accepted or left out after the read; `read_is_current: false`) →
  `run_checks` reads the current set; say it creates a new IDP Application.
- `idp_rule.agrees: false` on a check → mention that IDP's own rule disagrees.

The dossier is complete (`dossier_complete`) when no document question, figure or IDP hold is open.

### 4. Run the numbers
"Run the numbers" → `quick_spread` (as_of today unless the RM gives a date), then `policy_fit`. Say the
headline: DSCR, global DSCR and the policy verdict (`summary.text`), with sources, and any exception. Give
the method notes once, in these words:
- always: "Global cash flow counts only the guarantor's own wages (policy 5.3)."
- when the spread marks it as estimated: "Personal debt service is estimated from the PFS balances at
  policy factors."

The pane shows the metrics and the rule table; present the policy fit with the **policy-fit** skill.

### 5. The structure
The structure is `policy_fit.structure`, in one line in `structure.one_line`. Once the review is clear
and the numbers were presented, the RM approves it (or sends it back) in the pane or in chat. In chat:
`record_decision` with target `{"type": "structure"}`, decision `confirm` and `reason` =
`structure.one_line`; or `dispute` with the RM's reason. That only writes the opportunity log; nothing is
sent. The server refuses an approval before the review is clear (`structure_not_offered`).

### 6. The memo
"Draft the memo" → the **prescreen-memo** skill. End with the ask to the credit officer, unsent.

## Errors → what to do

| code | action |
|---|---|
| `opportunity_not_found` | `list_opportunities`, use the right id |
| `opportunity_exists` | use `opportunity_status` on that id |
| `invalid_update` / `nothing_to_update` | `update_opportunity` takes request fields or the lender only; fix the call |
| `dossier_incomplete` | nothing to read yet (no document for any item); with `IDP_AUTO_SUBMIT=false`, resolve the open questions first |
| `stale_revision` | re-read `opportunity_status`, retry with the new revision |
| `submission_uncertain` / `needs_attention: idp_submission_uncertain` | the RM must find the Application in IDP; then `record_decision` on the check run with `attach_application` (+ `application_id`) or `abandon` |
| `value_mismatch` / `confirmation_stale` | the value changed in IDP: `run_checks` mode `refresh`, then the RM looks again |
| `superseded_run` | use the latest check run |
| `not_decidable` | the document is supporting/excluded/twin; no decision needed |
| `reason_required` | an acknowledgement or a send-back needs the RM's reason: ask for it |
| `not_blocking` / `acknowledgement_stale` | the rule no longer holds the review, or its values changed: read the status again |
| `structure_not_offered` | the review is not clear yet, or the numbers were not presented on it: finish step 3, then run the numbers |
| `documents_only` / `why_required` / `not_offered` | `suggest_decision` takes an open document question and a reason; nothing else |
| `gmail_*` | mailbox not reachable or not configured: tell the RM; the operator fixes it |
| `idp_not_configured` / `policy_missing` | tell the RM to contact the operator |
| `unauthorized` (HTTP 401) | the plugin token is wrong: `/plugin` → prescreen → configure |
| a call refused with a line starting `prescreen:` | the plugin's guard stopped it: the target was not one the server offers, the figure differs from the one on record, or `force_new` was set. Read the status again and follow the line |
| `suggest_decision`, `policy_fit` or `memo_parts` is not a tool | the service is older than the plugin (it needs 0.4.0): the pane says so; do the steps by hand and give `review_link` for figures |

## Style

Short and factual, banker's language, amounts with thousands separators and $. The pane carries the
tables. One question to the RM at a time.

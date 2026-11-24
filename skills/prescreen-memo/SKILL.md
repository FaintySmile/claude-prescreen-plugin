---
name: prescreen-memo
description: Write the pre-screen memo for credit from the prescreen tool payloads and render it to Word and PDF with draft_memo. Use at the end of a pre-screen when the RM asks for the memo, the credit request, or the write-up for the credit officer.
---

# Pre-screen memo

Prerequisites: dossier complete, a check run with `review.state` clear (or the open item named in the
memo), `quick_spread`, the policy fit, and the structure the RM approved (a `structure` decision; the
pane's step 5). Fetch what you lack: `opportunity_status`, `get_operation`
with `include_fields: true` and the `operation_id` from `latest_check_run` (revenue, 1120-S header, interim revenue and net
income live in `check_run.fields`), `quick_spread`, `credit_policy`.

## Guardrail

- **Every figure names its source in brackets**: tax forms by form, page and line ("Form 1120-S 2025,
  page 1, line 22"); PFS, debt schedule and interim statements by statement and section; "quick spread"
  for a computed figure; "policy n.n" for a limit or assumption; "opportunity record" for the request.
- **No arithmetic of your own.** Repeat payload figures; do not add, divide or derive new ones.
- **Estimates say so** (personal debt service, the wages haircut).
- Documents that were only classified (named by their `label` in `opportunity_status`, e.g. the vendor
  quote, the insurance certificate) may be described only as far as a payload describes them; their
  amounts are not quoted unless a payload carries them (the equipment cost is on the opportunity record).
- `draft_memo` returns `unsourced_figures`: numbers it could not find in any payload. Fix or remove each
  one (identifiers such as ZIP codes or business codes are fine if they come from an extracted field), then
  draft again. Tell the RM about any you kept and why.

## Assembled sections come from the server

Call `memo_parts` (same `as_of` as the quick spread). Its `markdown` holds four blocks, built by the
server from the payloads: `section_3_proposed_structure` (the table, conditions, covenants),
`section_6_policy_fit` (the table and its closing sentence), `section_7_key_risks` and
`section_8_still_needed` (the closed lists, each row included only when its trigger is true).
**Paste them as they are.** Do not reword a row, re-test a rule or add a figure. You write sections 1,
2, 4, 5 and 9 and any sentence around the blocks. A row is added to 7 or 8 only when the RM chose it
under "Before I draft". If `memo_parts` is not a tool (an older service), assemble 3, 6, 7 and 8
yourself from the rules below.

## Format

Markdown subset only: `# ` title, `## ` section headings, paragraphs, `- ` bullets, pipe tables.

```
# Pre-Screen Memo: <Borrower>

<Lender> · Commercial Lending · Pre-screen of <Month D, YYYY>
Prepared by ${user_config.rm_name} · For the credit officer · Commercial Credit Policy <policy_version>

DRAFT for RM review. Every figure names its source document. Estimates are marked as estimates.

## 1. Borrower and request
## 2. Purpose, sources and uses        (table: Uses | Amount | Sources | Amount)
## 3. Proposed structure               (table: Term | Proposed; conditions and covenants as bullets)
## 4. Preliminary financial analysis   (business FY table, interim table, cash flow and coverage, global
                                        cash flow, leverage and liquidity, cross-checks and the HITL confirmation)
## 5. Collateral and advance rate      (advance rate vs policy; lien position; insurance)
## 6. Policy fit and expected exceptions (Section | Rule | Limit | Value | Result)
## 7. Key risks and mitigants          (table: Risk | Mitigant; closed list below; no new figures)
## 8. Still needed for full underwriting (bullets; closed list below)
## 9. The ask

Nothing has been sent to the borrower.
```

Nine sections, in this order. Relationship value is left out (no bank relationship data in the
pre-screen); the advance rate stands in for LTV.

## Fixed wording

Three items are always written the same way, so the RM never meets them for the first time in the memo.

- **Guarantor's wages (section 4, global cash flow paragraph).** The wages figure is the `wages` input
  of the quick spread, cited with its document and line as the payload gives them. The paragraph ends
  with: "Only the guarantor's own wages are counted (policy 5.3); the wages of a spouse who is not a
  guarantor are left out." Say nothing more about the spouse, quote no wages figure from the Form 1040,
  and name no regulation.
- **Borrower's contribution (sections 2 and 3).** The amount comes from the opportunity record
  (`request.borrower_contribution`), cited "opportunity record". It is never worked out from the
  equipment cost and the loan.
- **Lien position (section 5).** What an existing lender holds is quoted from the debt schedule field
  `debt_schedule.loan_N_collateral` in `check_run.fields`, cited "business debt schedule, collateral
  column". If that field is empty for a listed loan, write: "The debt schedule does not state the
  collateral of the <lender> loan; the existing lender's position is to be confirmed by a UCC search."
  Never infer a lien from the lender's name or the loan type.

## Sections 7 and 8 are closed lists

Sections 7 and 8 are assembled, not composed. Take each row whose trigger is true in the payloads,
word it as plainly as the row, use payload figures only, and add nothing else.

Section 7, key risks and mitigants:

| Risk | Include when | Mitigant |
|---|---|---|
| The advance is at the policy limit | the advance rate result is "At the limit" (policy 4.2) | the borrower's contribution against cash on the interim balance sheet |
| An existing lender holds a blanket lien on business assets | a loan's `debt_schedule.loan_N_collateral` field names a blanket lien or all business assets | purchase-money first lien on the financed equipment, filed within 20 days of delivery; the bank's blanket lien is second and valued as such |
| The collateral of an existing loan is not stated | the debt schedule lists a loan and its `debt_schedule.loan_N_collateral` field is empty | purchase-money first lien on the financed equipment, filed within 20 days of delivery; the existing lender's position to be confirmed by a UCC search |
| One owner runs the company | the opportunity has a single owner | unlimited personal guaranty; guarantor liquidity (quick spread) |
| The PFS is hand-filled | the PFS document has `handwritten: true` | the PFS totals checks pass; the hand-written figures in use were confirmed by the RM against the page |
| IDP held back a rule the RM went on despite | `review.idp_acknowledged` lists it | the RM's acknowledgement and reason, as recorded; the check stays failed |
| Personal debt service is estimated from balances | `quick_spread` marks it as estimated | the global DSCR; actual payments to be obtained in underwriting |
| One tax year in the file | the dossier holds one year of returns | the IRS transcript matches the return line by line; the prior-year return to be obtained in underwriting |
| A policy rule is an exception or cannot be tested | the policy fit shows one | what would cure it, as stated in the policy fit |

Section 8, still needed for full underwriting:

- the prior-year Form 1120-S and Form 1040, when the file holds one tax year;
- statements of the personal debts on the PFS with their monthly payments, when personal debt service
  is estimated;
- a UCC search on the borrower, when the debt schedule lists an existing loan; with it, the collateral
  of that loan, when the debt schedule does not state it;
- the final vendor invoice and the delivery date, for an equipment loan;
- evidence of insurance on the new equipment with the bank as loss payee, for an equipment loan;
- an updated PFS if it is older than the policy 7.2 limit at closing;
- any input a metric lists under `missing_inputs`.

## Before you draft: nothing new in the memo

The memo repeats what the RM has already seen in this chat. It is never the first place where an
observation appears.

1. **Inputs.** The memo needs the request (amount, term, rate, purpose), the equipment cost, the
   borrower's contribution, the owners, the lender, the quick spread and the policy fit. If one is not
   in the payloads, stop and tell the RM which one is missing and where it should come from. Do not
   leave a blank and do not derive it. If the RM gives the figure in chat, write it to the record
   with `update_opportunity` first, then cite it "opportunity record" like any other request figure.
2. **Anything outside the lists.** If you notice something in the payloads that the fixed wording and
   the closed lists do not cover (a date that cannot be right, a code that does not match the activity,
   a liability the spread does not count, a document that contradicts another), do not write it into
   the memo and do not draft yet. Tell the RM under the line "Before I draft", one line per item with
   its source, and ask for each: add as a risk, add under still needed, or leave out.
3. **Then draft.** Add only what the RM chose, in the section the RM chose. What the RM left out stays
   out of the memo.

## Render and hand over

1. `draft_memo` with `opportunity_id`, the markdown and `actor` = "${user_config.rm_name}".
2. Resolve `unsourced_figures` as above and redraft if needed.
3. Give the RM the two links (`links.docx`, `links.pdf`; valid for an hour, no token needed). If you
   can run shell commands and the RM wants the files locally, download them into the current folder:
   `curl -sSfL -o "<borrower>-prescreen.docx" "<links.docx>"` (and the same for the PDF).
4. Close with the ask to the credit officer and the reminder that nothing has been sent. Say in one
   line that sections 7 and 8 hold the standard items, plus anything the RM added before the draft.

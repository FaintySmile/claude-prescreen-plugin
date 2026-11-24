---
name: policy-fit
description: Test a pre-screen's quick-spread metrics against the bank's credit policy and propose one loan structure, citing policy sections. Use after quick_spread, when the RM asks whether the deal fits policy, what exceptions it needs, what rate/approval/conditions apply, or for a structure proposal.
---

# Policy fit and structure

Call `policy_fit` (same `opportunity_id` and `as_of` as the quick spread). The server tests every rule
of the loan type, walks the rate guidance, reads the approval level and copies the conditions and
covenants. **Report what it returns; do not re-test a limit, recompute a rate or rebuild the table.**

The pane's step 4 shows the rule table and step 5 the structure, drawn from this payload. In the chat:

- `summary.text`, the one-line verdict, with "policy" and the version.
- Each Exception with its section and what would cure it (the value meeting `limit_text`); each
  "Cannot test" with its `missing`. Say plainly when no exception is needed. A "Condition" (rule 7.2) is
  not an exception: it becomes a closing condition.
- The structure in one line: `structure.one_line`; then the rate walk's result (`guidance_pct`,
  `within_rm_authority`; if `not_evaluated` lists an adder, say the guidance could not be walked and name
  it) and `structure.approval.text`, each with its section. Name any of `structure.estimates`.
- One question: does the RM approve the structure (step 5 of the **pre-screen** skill)?

Give the full table in the chat only when the RM asks for it or there is no pane: one row per `rules[]`
entry, `section` · `rule` · `limit_text` · `value_text` · `status`. `information_only` items are
information, never pass/fail. Cite sections as "policy 5.1".

If `policy_fit` is not a tool on the server (an older service), do it by hand as below.

## Policy fit by hand (older service only)

Inputs: the `quick_spread` result and `credit_policy`. Do no arithmetic of your own beyond reading a
value against its limit.

1. Pick the loan type whose `matches_request_type` equals the opportunity's `request.type`.
2. For every rule in `rules[]` whose `applies_to` contains that loan type:
   - read its `metric` from `quick_spread.metrics`, or from `quick_spread.policy_test_values`
     (`term_months`, `pfs_age_days`), or for guarantor rules from the owners on the opportunity;
   - compare with `test` and `limit`; status is **Meets**, **At the limit** (value equals the limit),
     **Exception** (fails the test) or **Cannot test** (metric is null: list `missing_inputs`).
3. Show one table: Section · Rule · Limit (with unit) · Value · Result. Section numbers come from
   the rule's `section`; cite as "policy 5.1".
4. `information_only` items (e.g. current ratio) are shown as information, never as pass/fail.
5. List each Exception with what would cure it. Say plainly when none is needed.

## Structure (one proposal)

From the policy file only:
- **Amount / term / payment**: the request; the monthly payment from `quick_spread.debt_service`.
- **Rate**: walk `rate_guidance` (base by DSCR band plus adders, e.g. term over 48 months) and show
  each step with its section; say whether it is within the RM's authority.
- **Collateral and guarantor**: from `standard_terms` and the guarantor rule (owners of 20% or more).
- **Approval**: the level in `approval_authority` for the exposure.
- **Conditions and covenants**: from `standard_terms`, verbatim in substance.
- Note any estimate the spread marks as estimated (personal debt service, wages haircut).

Never introduce a number that is in neither the spread nor the policy. If the RM wants an alternative
structure, say which figures the service would need to recompute and that only the request on the
opportunity drives the spread.

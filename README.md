# prescreen: Claude Code plugin for the pre-screen service

The RM's side of the lean demo. Claude talks to the pre-screen microservice (`../microservice`) through its
MCP endpoint (`<service>/mcp`, streamable HTTP, bearer token). The service reads the deal mailbox, builds the
dossier, has IDP read the documents, runs the cross-checks, computes the quick spread and the policy fit, and
renders the memo. The plugin gives the RM one workplace, the **pre-screen pane**, and carries the playbook as
skills. No server code lives here.

| Part | What it is |
|---|---|
| `.claude-plugin/plugin.json` | Name, version and the three settings: service URL, service token, RM name |
| `.mcp.json` | The `prescreen` MCP server: `${user_config.service_url}/mcp` with `Authorization: Bearer ${user_config.api_token}` |
| `hooks/prescreen.tsx` | The mod: the pane, the reply buttons above the prompt, the Page pane, `/prescreen` and the guard on decisions. Code, not a prompt |
| `skills/pre-screen` | The six steps, the RM's checkpoint after IDP's read, the rules (no figure without a source, decisions only on the RM's word, nothing recorded twice, nothing first said in the memo) |
| `skills/policy-fit` | The policy fit as the server computes it: the verdict, the exceptions, the structure in one line |
| `skills/prescreen-memo` | The nine-section memo: fixed wording, the closed lists of sections 7 and 8, the stop before drafting, `draft_memo` to Word and PDF |
| `tests/prescreen.test.tsx` | The mod's tests against a stand-in server (`claude plugin test`) |

Tools on the server: `list_opportunities`, `start_prescreen`, `update_opportunity`, `opportunity_status`,
`mailbox_overview`, `collect_documents`, `get_operation`, `record_decision`, `suggest_decision`,
`run_checks`, `quick_spread`, `policy_fit`, `memo_parts`, `review_link`, `credit_policy`, `draft_memo`, and
three for the screens: `workbench_view`, `evidence_image`, `document_image`. Their shapes:
`../microservice/docs/PLUGIN_CONTRACT.md`.

## The pane

The pane opens by itself on the first pre-screen tool call of a session (or with `/prescreen`, or "show
me the pane"). It is drawn from the server's `workbench_view`, never from the model's words:

- **Six steps** across the top (open the opportunity, gather documents, cross-check and spread, policy fit,
  structure and pricing, pre-screen memo), each done, current, running or blocked as the server says, and
  under them the open step's headline ("Step 3 · Cross-check and spread: 10 pass; 2 for you").
- **Step 3, one card per thing that needs the RM:** a document question with its page (pager, the
  assistant's suggestion and its button marked), a hand-filled page with every figure in use listed and
  outlined in one picture (`All match the page` / `One is wrong…`, a figure up close at a press), a rule IDP
  held back with its two sides and a reason box (`Go on, noted`).
- **Step 2** lists every document received, each with `Open`: its pages at the top, with a pager.
- **Larger** under a page opens the **Page pane**: the page in sharp strips, figures outlined, a pager; Esc
  closes it.
- Steps 4 to 6: the metrics and the policy table; the structure in one line with `Approve the structure` /
  `Send it back`; the memo's state.

**Reply buttons above the prompt** carry the open step's buttons, as the server lists them: a work step
("Pull in what they sent", "Run the numbers", "Draft the memo") goes to Claude as its fixed sentence; a
decision shows there only while the pane shows its page, otherwise "Show me …", which opens it.

**Chat and pane stay in step.** A pre-screen tool call moves the pane to its step and reloads it; it
reloads after each turn and every few seconds while IDP is reading. A decision pressed in the pane is
recorded by the mod under the RM's configured name, shows a notice row in the chat, and reaches Claude with
the RM's next prompt, so Claude does not ask again.

## What does not depend on the model

| Piece | Where | What it fixes |
|---|---|---|
| Steps, stage, buttons, what needs the RM | the service (`workbench_view`) | Which step the deal is on, which buttons are offered, which figures need the RM's eyes (hand-written or under 0.95 confidence, in use) and what IDP held back: computed by the server, drawn as given |
| The pane and the reply buttons | this plugin | Decisions are pressed where the document is seen and recorded by the mod itself with the server's own target and value; a press is never a prompt |
| Decision guard | this plugin | A `record_decision` from the model is refused unless its target and option are ones the server offers and a confirmed figure equals the one on record; the actor is always "Your name (RM)"; `force_new` is refused |
| Server-side gates | the service | A screen may decide only what the server offers; the structure can be approved only once the review is clear and the numbers were presented; an IDP rule is acknowledged only with a reason |
| `policy_fit`, `memo_parts` | the service | The rule tests, the rate walk and memo sections 3, 6, 7 and 8 are computed, not composed |
| Review page | the service, opened by `review_link` | The same deal in a browser, for a window with no pane |

Still written by the model: the chat text, and memo sections 1, 2, 4, 5 and 9. `draft_memo` reports
`unsourced_figures` for those.

**This version needs the service at 0.4.0.** Against an older service the pane says so and shows the
documents and their questions only, with no steps and no reply buttons. Deploy the service first, then
update the plugin.

## 1. Install in Claude Code

This repository is its own marketplace (`.claude-plugin/marketplace.json`, named `menelaus`). In Claude
Code, at the prompt of a terminal session:

```
/plugin install prescreen --marketplace <owner>/<repo>
```

Answer `y` to add the marketplace, then pick a scope (user). The same from a shell:

```bash
claude plugin marketplace add <owner>/<repo>
```

```bash
claude plugin install prescreen@menelaus
```

A private repository needs GitHub access on the RM's computer (the account invited to the repository,
signed in with `gh auth login` or a git credential).

Then set the three values: `/plugin` → prescreen → Configure.

| Setting | Value |
|---|---|
| Pre-screen service URL | The default is the VM, `http://74.234.37.28:14543`. No `/mcp` at the end |
| Service token | `PRESCREEN_API_TOKEN` of that service (kept in the OS keychain) |
| Your name (RM) | Recorded as the actor on every decision and printed in the memo |

Restart Claude Code; `/mcp` should show `prescreen` connected. Server side: the service's `docs/DEPLOY.md`.

**Coming from the local install** (`prescreen@menelaus-local`, from a folder): remove it first, then
install from the repository as above.

```bash
claude plugin uninstall prescreen@menelaus-local
```

```bash
claude plugin marketplace remove menelaus-local
```

## 2. Update

An installed copy updates only when `version` in `.claude-plugin/plugin.json` changes. **Raise the version
with every change and push it**; then on each RM's computer:

```bash
claude plugin marketplace update menelaus
```

```bash
claude plugin update prescreen@menelaus
```

Restart Claude Code and start a new chat: a session opened before the update keeps the old skills and the
old tool list. The settings survive an update; check them after a reinstall.

The skills call tools by name, so the server must be at least as new as the plugin: deploy the service
first, then push the plugin.

## 3. The demo storyline

One run in a fresh chat, in the Claude Code desktop app. The server starts from the seeded Riverbend lead
with no documents, and the mailbox holds the pack's two e-mails.

1. "Start a pre-screen for Riverbend Roofing, the equipment loan." → the lead is found: $285,000, 60 months,
   7.85%, equipment cost $356,250, contribution $71,250; the pane opens on step 2.
2. "Pull in what they sent." (or the reply button) → the two e-mails are collected and sorted, then IDP
   reads the seven documents and the ten checks run, while the pane shows the progress. 7 accepted, 1 needs
   the RM; ten checks pass. The vendor quote, the insurance certificate, a repeated page and a twin are set
   aside.
3. The RM's checkpoint, step 3 of the pane, two cards:
   - the K-1 on page 8 names Great Lakes Print & Packaging (EIN 38-7036270); Claude may suggest leaving it
     out; the RM presses `Leave it out`;
   - the hand-filled PFS: its 14 figures in use, outlined on the page; the RM looks (a figure up close, or
     `Larger`) and presses `All match the page`.
4. "Run the numbers." → DSCR 1.76x, global DSCR 1.96x (wages $157,000 from Form 1120-S, line 7), policy fit
   under demo-2026.2: 8 rules, 7 met, 1 at the limit, no exception.
5. The RM approves the structure in step 5 ("$285,000 C&I equipment term loan, 60 months at 7.85%;
   $5,758.33 a month; …").
6. "Draft the memo." → Word and PDF links. If Claude first lists items under "Before I draft", something in
   the payloads is outside the memo's lists: decide each one, then it drafts.

Decisions can be made half in the chat, half in the pane: both record the same thing, and each side sees
the other's.

"What came in by email?" uses `mailbox_overview`: every recent message, which deal it belongs to by match
terms, and whether it was collected. A value the RM supplies later (for example the borrower's
contribution) is written to the record with `update_opportunity`.

The PFS in the pack is dated August 31, 2026. After November 29, 2026 it is older than 90 days, and the
policy fit and the memo change.

## 4. Development

Check the mod after a change, on the Claude Code builds the RMs run (the CLI, and the desktop app's own
engine):

```bash
claude plugin validate ./prescreen-plugin
```

```bash
claude plugin test ./prescreen-plugin
```

23 tests against a stand-in server; no network.

**A local service to develop against**, with the Riverbend mail and an in-process stand-in for IDP, no
`.env`, nothing leaving the machine (from `../microservice`, port 8765, token `local-token`):

```bash
python scripts/run_local.py --reset
```

**Loading a working copy of this folder** while the installed plugin stays as it is:

- Terminal: `claude --plugin-dir <this folder>`.
- Desktop app: `CLAUDE_CODE_PLUGIN_DIRS` = this folder, in the `env` block of `~/.claude/settings.json`;
  restart the app (or set `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` there too, to reload on save).

The working copy overrides the installed plugin for that session and reads its settings from
`pluginConfigs["prescreen"]` in `~/.claude/settings.json`, not from the installed plugin's: there, set
`service_url` to `http://127.0.0.1:8765`, `api_token` to `local-token` and `rm_name`. Keep one
`pluginConfigs` block in the file: JSON keeps only the last of two.

## Other harnesses

The same endpoint works for any MCP client with streamable HTTP and a custom header (Codex CLI, Cursor,
VS Code, Claude Desktop through `mcp-remote`). They don't load skills; the server's `instructions` carry
the rules. Claude Code without the plugin:

```bash
claude mcp add --transport http prescreen http://74.234.37.28:14543/mcp --header "Authorization: Bearer <token>"
```

A host name other than `127.0.0.1`/`localhost`/`prescreen-api` must be in the service's
`MCP_ALLOWED_HOSTS` (the VM has `74.234.37.28:*`). claude.ai custom connectors need HTTPS and are not part
of this deployment. Hosts with no pane get the in-chat views from `<service>/mcp/apps`
(`ui://prescreen/documents|checks|numbers`); `/mcp`, the plugin's endpoint, serves none.

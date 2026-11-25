import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// A stand-in for the pre-screen server: the hooks below answer `$.mcp.call` the way /mcp would, with the
// server's own steps, stage, proposals and attention list (workbench/2).
const ID = 'opp-riverbend-2026-001'
const K1 = { type: 'document', document_id: 'doc_40a46b1710f3' }
const F1 = { type: 'field', check_run_id: 'run_1', field: 'pfs_primary.business_income', confirmation_id: 'cfm_1' }
const F2 = { type: 'field', check_run_id: 'run_1', field: 'pfs_primary.net_worth', confirmation_id: 'cfm_2' }
const CARD = 'pfs_primary:p1'

type Deal = { k1Open: boolean; confirmed: string[]; down: boolean; suggested: boolean; metricsOnly?: boolean; gaps?: boolean; spreadError?: boolean; refusePrompts?: boolean; phase?: 'rule' | 'structure' | 'memo' | 'old'; noImage?: boolean; apiShape?: boolean; bigStrips?: boolean; noteWide?: boolean; stallStrips?: boolean; stallOpen?: boolean; bareStrips?: boolean; held?: (() => void)[] }
const RULE = { type: 'idp_rule', check_run_id: 'run_1', rule_id: 'r7', ack_id: 'ack_1' }
const LINE = '$285,000 C&I equipment term loan, 60 months at 7.85%; $5,758.33 a month'

function steps(stage: string) {
  const keys = ['opportunity', 'documents', 'checks', 'policy_fit', 'structure', 'memo']
  const labels = ['Open the opportunity', 'Gather documents', 'Cross-check and spread', 'Policy fit', 'Structure and pricing', 'Pre-screen memo']
  const at = keys.indexOf(stage)
  return keys.map((key, i) => ({
    key,
    n: i + 1,
    label: labels[i],
    state: i < at ? 'done' : i === at ? 'current' : 'todo',
    headline: key === 'checks' ? '10 pass; 2 for you' : key === 'policy_fit' ? 'Not run yet' : '',
    waiting: key === 'checks' && stage === 'checks' ? 2 : 0,
  }))
}

// the compact quick spread: the server works it out once IDP has read, also while figures wait for the RM
const METRICS = { ebitda: 399596, existing_debt_service: 45156, proposed_debt_service: 69100, dscr: 1.76, global_dscr: 1.96, funded_debt_to_ebitda: 0.96, guarantor_liquidity_pct: 23.5, advance_rate_pct: 80, current_ratio: 2.81 }
function spread(waiting: boolean, d: Deal) {
  if (d.metricsOnly) return { metrics: METRICS } // a service before the step-3 spread
  // two owners: the wages input is not used, so the global DSCR is not worked out; no debt schedule read
  if (d.gaps)
    return {
      metrics: { ...METRICS, existing_debt_service: null, global_dscr: null, dscr: null },
      cash_flow: { ebitda: 399596, maintenance_capex: 82600, distributions: 115600, cash_available_for_debt_service: 201396 },
      debt_service: { existing: null, proposed_monthly_payment: 5758.33, proposed: 69100, total: null },
      missing_inputs: [{ metric: 'existing_debt_service', missing: ['debt_monthly_payments'] }, { metric: 'global_dscr', missing: ['wages'] }],
      inputs: [
        { key: 'debt_monthly_payments', value: null, document: 'Business debt schedule', location: 'Monthly pmt column, all rows' },
        { key: 'wages', value: null, document: 'Form 1120-S 2025', location: 'page 1, line 7', note: "not used: more than one owner; each guarantor's Form W-2 is needed" },
      ],
    }
  return {
    metrics: METRICS,
    cash_flow: { ebitda: 399596, maintenance_capex: 82600, distributions: 115600, cash_available_for_debt_service: 201396 },
    debt_service: { existing: 45156, proposed_monthly_payment: 5758.33, proposed: 69100, total: 114256 },
    missing_inputs: [],
    inputs: [
      { key: 'ordinary_income', value: 224500, document: 'Form 1120-S 2025', location: 'page 1, line 22' },
      { key: 'debt_monthly_payments', value: 3763, document: 'Business debt schedule', location: 'Monthly pmt column, all rows', rows: 2, edited: true },
      { key: 'pfs_as_of', value: 'August 31, 2026', document: 'PFS | [evil](http://x) signed.pdf', location: 'header, as-of date' },
      { key: 'pfs_cash', value: 67000, document: 'PFS | [evil](http://x) signed.pdf', location: 'Assets: cash and deposits', ...(waiting ? { waiting: true } : {}) },
      { key: 'rate_pct', value: 7.85, document: 'Opportunity record', location: 'request.rate_pct' },
    ],
  }
}

function workbench(d: Deal) {
  const fields = [
    { ref: 'pfs_primary.business_income', value: 224500, target: F1 },
    { ref: 'pfs_primary.net_worth', value: 1501000, target: F2 },
  ].filter(f => !d.confirmed.includes(f.target.confirmation_id))
  const stage = d.k1Open || fields.length ? 'checks' : 'policy_fit'
  const proposals: unknown[] = []
  if (d.k1Open) {
    for (const [decision, label] of [['accept', 'Use it'], ['reject', 'Leave it out']])
      proposals.push({ id: `doc_40a46b1710f3:${decision}`, step: 'checks', kind: 'decision', label, about: 'Returns and financials.pdf (p. 8)', target: K1, decision, card: 'doc:doc_40a46b1710f3', suggested: d.suggested && decision === 'reject' })
  }
  if (fields.length) {
    proposals.push({ id: `card:${CARD}:show`, step: 'checks', kind: 'show', card: CARD, label: 'Show me the PFS' })
    proposals.push({ id: `card:${CARD}:confirm`, step: 'checks', kind: 'decision', card: CARD, label: 'All match the page', decision: 'confirm', count: fields.length, about: 'PFS | [evil](http://x) signed.pdf' })
    proposals.push({ id: `card:${CARD}:dispute`, step: 'checks', kind: 'decision', card: CARD, label: 'One is wrong…', decision: 'dispute', count: fields.length, pick_one: true })
  }
  if (stage === 'policy_fit') proposals.push({ id: 'next:numbers', step: 'policy_fit', kind: 'prompt', label: 'Run the numbers', text: 'Run the numbers.' })
  return {
    schema: 'prescreen.workbench/2',
    steps: steps(stage),
    stage,
    proposals,
    attention: fields.map(f => ({ kind: 'field', reason: 'handwritten', blocking: true, card: CARD, ref: f.ref, value: f.value, document: 'PFS | [evil](http://x) signed.pdf', page: 1, has_position: true, confidence: 0.99, evidence: `${f.ref} ${f.value}`, used_by: ['M-07'], decision_target: f.target, options: ['confirm', 'dispute'] })),
    field_notes: [{ ref: 'form_1120s.ordinary_income (line 22)', value: 224500, note: 'IDP could not find this value in the page text' }],
    operations_running: [],
    opportunity: {
      opportunity_id: ID,
      borrower: { name: 'Riverbend Roofing Systems, Inc.' },
      owners: [{ name: 'Anthony J. Carbone', pct: 100 }],
      request: { type: 'C&I equipment term loan', amount: 285000, term_months: 60, rate_pct: 7.85 },
      summary: d.k1Open ? '7 accepted, 1 need review; checklist 7 of 7' : '7 accepted, 0 need review; checklist 7 of 7',
      dossier_complete: stage !== 'checks',
      checklist: [{ item: 'pfs_primary', label: 'Personal financial statement', status: 'accepted', document_id: 'doc_fd44692ea7a1' }],
      documents: [
        { document_id: 'doc_fd44692ea7a1', title: 'PFS | [evil](http://x) signed.pdf', checklist_item: 'pfs_primary', status: 'accepted', notes: [{ code: 'handwritten', message: 'hand-written entries' }] },
        { document_id: 'doc_40a46b1710f3', title: 'Returns and financials.pdf (p. 8)', checklist_item: 'k1_primary', status: d.k1Open ? 'needs_review' : 'rejected', notes: [] },
      ],
      exceptions: d.k1Open
        ? [{ title: 'Returns and financials.pdf (p. 8)', checklist_item: 'k1_primary', document_id: 'doc_40a46b1710f3', reasons: [{ code: 'attribution_mismatch', message: 'names Great Lakes Print & Packaging, Inc.' }], decision_target: K1, options: ['accept', 'reject'], suggestion: d.suggested ? { decision: 'reject', why: 'attribution_mismatch' } : null }]
        : [],
    },
    check_run: {
      check_run_id: 'run_1',
      checks_summary: { pass: 10, fail: 0, cannot_verify: 0 },
      review: { state: fields.length ? 'needs_confirmation' : 'clear', pending_confirmations: fields.map(f => ({ ref: f.ref, value: f.value, decision_target: f.target })) },
      checks: [{ check_id: 'M-07', title: 'PFS business income agrees with K-1', status: 'pass', review_state: fields.length ? 'needs_confirmation' : 'confirmed' }],
    },
    quick_spread: d.spreadError ? null : spread(fields.length > 0, d),
    quick_spread_error: d.spreadError ? { code: 'policy_missing', message: 'No credit policy is configured' } : null,
    policy_fit: null,
  }
}

// the other states of a deal: an IDP rule held back, the structure to approve, the memo, an older server
function phased(d: Deal) {
  const w: Record<string, any> = workbench({ ...d, k1Open: false, confirmed: ['cfm_1', 'cfm_2'] })
  if (d.phase === 'rule') {
    w.stage = 'checks'
    w.steps = steps('checks')
    w.attention = [
      {
        kind: 'rule',
        reason: 'idp_rule_blocked',
        blocking: true,
        card: 'r7',
        name: 'PFS business income agrees with K-1',
        status: 'failed',
        text: 'PFS business income differs from K-1 box 1.',
        sides: [
          { ref: 'pfs_primary.business_income', values: [{ value: 160800, filename: 'pfs_primary.pdf' }] },
          { ref: 'k1_primary.box1_ordinary_income', values: [{ value: 224500, filename: 'k1_primary.pdf' }] },
        ],
        decision_target: RULE,
        options: ['acknowledge'],
      },
    ]
    w.proposals = [
      { id: 'card:r7:show', step: 'checks', kind: 'show', card: 'r7', label: 'Show me the rule' },
      { id: 'card:r7:acknowledge', step: 'checks', kind: 'decision', card: 'r7', label: 'Go on, noted', decision: 'acknowledge', target: RULE, needs_reason: true, about: 'PFS business income agrees with K-1' },
    ]
  }
  if (d.phase === 'structure' || d.phase === 'memo') {
    w.policy_fit = {
      policy_version: 'demo-2026.2',
      summary: { text: '8 rules: 7 met, 1 at the limit, no exception' },
      rules: [{ section: '5.1', rule: 'Minimum business debt service coverage', limit_text: '≥ 1.25x', value_text: '1.76x', status: 'Meets' }],
      structure: { one_line: LINE, approval: { text: 'Credit officer, for exposure up to $500,000', section: '2.3' } },
    }
  }
  if (d.phase === 'structure') {
    w.stage = 'structure'
    w.steps = steps('structure')
    w.proposals = [
      { id: 'structure:confirm', step: 'structure', kind: 'decision', label: 'Approve the structure', target: { type: 'structure' }, decision: 'confirm', reason: LINE, about: LINE },
      { id: 'structure:dispute', step: 'structure', kind: 'decision', label: 'Send it back', target: { type: 'structure' }, decision: 'dispute', needs_reason: true, about: LINE },
    ]
  }
  if (d.phase === 'memo') {
    w.stage = 'memo'
    w.steps = steps('memo').map(s => (s.key === 'memo' ? { ...s, headline: 'Not drafted' } : s))
    w.proposals = [{ id: 'next:memo', step: 'memo', kind: 'prompt', label: 'Draft the memo', text: 'Draft the memo.' }]
  }
  if (d.phase === 'old') {
    const old = workbench({ ...d, k1Open: true })
    return { opportunity: old.opportunity, check_run: null, quick_spread: null, policy_fit: null }
  }
  return w
}

const TOOLS = ['workbench_view', 'opportunity_status', 'list_opportunities', 'record_decision', 'review_link', 'run_checks', 'evidence_image', 'document_image', 'collect_documents', 'quick_spread'].map(name => ({
  name: `mcp__plugin_prescreen_prescreen__${name}`,
  description: name,
  mcp: true,
}))

const PANE = {
  plugin: 'prescreen',
  component: 'Pane',
  requestId: 'prescreen',
  props: { title: 'Pre-screen', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const BAND = {
  plugin: 'prescreen',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

type Call = { server: string; tool: string; args: Record<string, any> }
type Seen = { prompts: Record<string, any>[]; appended: Record<string, any>[]; tools: Record<string, unknown>[]; opened: Record<string, any>[]; closed: string[] }

const OPTIONS = { options: { service_url: 'http://127.0.0.1:8765', api_token: 'test-token', rm_name: 'Elena Brooks' } }

// a 1x1 PNG: the stand-in for the page picture the server draws
const DOT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function server(on: On, d: Deal, calls: Call[], seen: Seen, placed = true) {
  on('command.register', () => ({ value: { command: 'prescreen' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__prescreen__open_pane' } }))
  on('ui.open', (_, e) => {
    seen.opened.push(e as unknown as Record<string, any>)
    // a window that never answers the Page pane's open (until its time limit passes)
    if (d.stallOpen && (e as any).id === 'prescreen-page') return new Promise(r => (d.held ??= []).push(() => r({ value: { isPlaced: true as const } })))
    return { value: placed ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no surface docks panes here' } }
  })
  on('ui.close', (_, e) => {
    seen.closed.push(String((e as unknown as Record<string, any>).id))
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  // the Page pane's time limits: the one for the stalled step passes at once, and then the stalled call
  // answers (late, ignored); every other timer is the engine's own
  on('clock.after', (_, e, next) => {
    if ((d.stallStrips && e.ms === 30_000) || (d.stallOpen && e.ms === 10_000)) {
      const late = (d.held ?? []).splice(0)
      void Promise.resolve().then(() => late.forEach(f => f()))
      return { value: undefined }
    }
    return next(e)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1795000000000 }))
  on('tool.list', () => ({ value: TOOLS }))
  on('tool.call', (_, e) => {
    seen.tools.push(e as unknown as Record<string, unknown>)
    return { result: {} }
  })
  on('prompt.submit', (_, e) => {
    // an engine that refuses a prompt from the mod (a turn already running, say)
    if (d.refusePrompts && String(e.text).startsWith('Decided in the pre-screen pane')) throw new Error('busy')
    seen.prompts.push(e as unknown as Record<string, any>)
    return { text: e.text, context: e.context }
  })
  on('session.append', (_, e, next) => {
    seen.appended.push(e as unknown as Record<string, any>)
    return next(e)
  })
  on('mcp.call', (_, e) => {
    calls.push(e as Call)
    const ok = (structuredContent: unknown) => ({ value: { content: [], isError: false, structuredContent } })
    if (d.down) return { value: { content: [{ type: 'text', text: 'service unavailable' }], isError: true } }
    if (e.tool === 'workbench_view') return ok(d.phase ? phased(d) : workbench(d))
    // the desktop's 2.1.330 hands an image back in the Anthropic API's shape, with the tool's text blocks after it
    if (e.tool === 'document_image' && d.apiShape) return { value: { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: DOT } }, { type: 'text', text: 'note' }, { type: 'text', text: '{}' }], isError: false, structuredContent: { width: 560, height: 725, page: 1, page_count: 5 } } }
    // an engine that hands back a note in place of a picture it thinks too large: only 560 px gets through
    if (d.noteWide && e.tool === 'document_image' && !(e.args as any).band && (e.args as any).max_width > 560) return { value: { content: [{ type: 'text', text: 'result too large' }], isError: false } }
    // a strip too large for one picture: the pane asks for more, smaller strips
    if (d.bigStrips && (e.args as any).bands === 3) return { value: { content: [{ type: 'image', data: 'A'.repeat(130_000), mimeType: 'image/jpeg' }], isError: false, structuredContent: { width: 1300, height: 600 } } }
    // a strip that comes without the server's details (page count, size)
    if (d.bareStrips && e.tool === 'document_image' && (e.args as any).bands) return { value: { content: [{ type: 'image', data: DOT, mimeType: 'image/jpeg' }], isError: false } }
    // a strip that never answers (until the time limit passes)
    if (d.stallStrips && e.tool === 'document_image' && (e.args as any).bands) {
      const late = { value: { content: [{ type: 'image', data: DOT, mimeType: 'image/jpeg' }], isError: false, structuredContent: { width: 1300, height: 600, page: 1, page_count: 2 } } }
      return new Promise(r => (d.held ??= []).push(() => r(late)))
    }
    if (e.tool === 'document_image' && d.noImage) return { value: { content: [{ type: 'text', text: '[Image: source: page.jpg]' }], isError: false, structuredContent: { width: 560, height: 725 } } }
    if (e.tool === 'document_image') return { value: { content: [{ type: 'image', data: DOT, mimeType: 'image/jpeg' }], isError: false, structuredContent: { width: 560, height: 725, page: 1, page_count: 2 } } }
    if (e.tool === 'evidence_image') return { value: { content: [{ type: 'image', data: DOT, mimeType: 'image/jpeg' }], isError: false, structuredContent: { width: 560, height: 725 } } }
    if (e.tool === 'list_opportunities') return ok({ opportunities: [{ opportunity_id: ID, borrower: 'Riverbend Roofing Systems, Inc.', summary: '7 accepted' }] })
    if (e.tool === 'review_link') return ok({ url: 'https://prescreen.example/review/opp?t=abc' })
    if (e.tool === 'record_decision') {
      const t = (e.args as any).target
      if (t.type === 'document') d.k1Open = false
      if (t.type === 'field' && (e.args as any).decision === 'confirm') d.confirmed.push(t.confirmation_id)
      return ok({ decision: { actor: (e.args as any).actor } })
    }
    return { value: { content: [{ type: 'text', text: 'unknown tool' }], isError: true } }
  })
}

const fresh = (): { d: Deal; calls: Call[]; seen: Seen } => ({
  d: { k1Open: true, confirmed: [], down: false, suggested: true },
  calls: [],
  seen: { prompts: [], appended: [], tools: [], opened: [], closed: [] },
})

test('the pane draws the server step and its cards; a card decision is recorded, told to the chat, and goes with the next prompt', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  expect(ran?.text).toBe('Pre-screen pane opened for Riverbend Roofing Systems, Inc.. Step 3, Cross-check and spread: 10 pass; 2 for you.')
  expect(calls.find(c => c.tool === 'workbench_view')?.args.compact).toBe(true)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Step 3 · Cross-check and spread: 10 pass; 2 for you/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'step-checks' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'card-0-confirm' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // the document with a question, as it arrived, and the PFS page with every figure outlined, in one picture
  expect(calls.find(c => c.tool === 'document_image')?.args.document_id).toBe('doc_40a46b1710f3')
  const pfs = calls.find(c => c.tool === 'evidence_image')
  expect(pfs?.args.refs).toEqual(['pfs_primary.business_income', 'pfs_primary.net_worth'])
  expect(pfs?.args.mode).toBe('page')
  expect(await ui.find({ type: 'Text', text: /Claude suggests: leave it out/ })).toBeDefined()
  // the suggested button is the primary one
  expect((await ui.find({ type: 'Button', key: 'exc-0-reject' }))?.props.variant).toBe('primary')

  calls.length = 0
  await ui.press({ key: 'card-0-confirm' })
  const confirms = calls.filter(c => c.tool === 'record_decision')
  expect(confirms.map(c => c.args.target)).toEqual([F1, F2])
  expect(confirms.map(c => c.args.value)).toEqual([224500, 1501000]) // the server's figures, read again just before
  expect(confirms.every(c => c.args.actor === 'Elena Brooks')).toBe(true)
  // the chat catches up at once: the decision goes to Claude as a prompt, with where the deal stands now
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]?.text).toBe(
    'Decided in the pre-screen pane, already recorded under Elena Brooks: confirmed the 2 figures on PFS | [evil](http://x) signed.pdf as read. Now: step 3, Cross-check and spread: 10 pass; 2 for you.',
  )
  // said once: the RM's next prompt carries nothing more
  await $.prompt.submit({ text: 'what next?' } as Parameters<typeof $.prompt.submit>[0])
  expect(seen.prompts.at(-1)?.text).toBe('what next?')
  expect(seen.prompts.at(-1)?.context).toBeUndefined()
  await ui.unmount()
})

test('the band: a decision shows only where the page is seen; a work step submits the server sentence', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen, false) // no surface docks the pane yet
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])

  // the pane is not on screen: the decisions collapse to "Show me"
  let band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /RM checkpoint/ })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'Show me the PFS' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'All match the page' })).toBeUndefined()
  expect(await band.find({ type: 'Button', text: 'Leave it out' })).toBeUndefined()
  await band.unmount()

  // a survey holds the band: the mod stays quiet, and the engine's own band shows
  const quiet = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
  expect(await quiet.find({ type: 'Button' })).toBeUndefined()
  expect(await quiet.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await quiet.unmount()
})

test('with the pane on screen the band carries the decisions; after them the next work step', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen, true)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  let band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button', text: 'Leave it out' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'One is wrong…' })).toBeUndefined() // picking a figure needs the pane
  calls.length = 0
  await band.press({ key: 'band-doc_40a46b1710f3:reject' })
  expect(calls.find(c => c.tool === 'record_decision')?.args.target).toEqual(K1)
  expect(calls.find(c => c.tool === 'record_decision')?.args.decision).toBe('reject')
  expect(seen.prompts.at(-1)?.text).toContain('Decided in the pre-screen pane, already recorded under Elena Brooks: left out Returns and financials.pdf (p. 8).')
  await band.unmount()

  band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: `band-card:${CARD}:confirm` })
  await band.unmount()

  // the review is clear: the band offers the next work step, which goes to the model as its fixed sentence
  band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /^Next/ })).toBeDefined()
  await band.press({ key: 'band-next:numbers' })
  expect(seen.prompts.at(-1)?.text).toBe('Run the numbers.')
  // each decision already reached the chat as its own prompt: nothing is left to go with this one
  expect(seen.prompts.map(p => String(p.text).slice(0, 27))).toEqual(['Decided in the pre-screen p', 'Decided in the pre-screen p', 'Run the numbers.'])
  expect(seen.appended.find(a => a.message?.type === 'user')).toBeUndefined()
  await band.unmount()
})

test('a decision the chat cannot be sent: a notice row, and the line goes with the next prompt', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.refusePrompts = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'exc-0-reject' })
  expect(calls.find(c => c.tool === 'record_decision')?.args.decision).toBe('reject')
  const notice = seen.appended.at(-1)
  expect(notice?.message?.type).toBe('system')
  expect(notice?.message?.content?.[0]?.text).toContain('Recorded: left out Returns and financials.pdf (p. 8)')
  await $.prompt.submit({ text: 'what next?' } as Parameters<typeof $.prompt.submit>[0])
  const sent = seen.prompts.at(-1)
  expect(sent?.text).toBe('what next?')
  expect(String(sent?.context?.[0])).toContain('Since your last turn the RM decided in the pre-screen pane: left out Returns and financials.pdf (p. 8)')
  await ui.unmount()
})

test("a status read by Claude does not take the pane back to a step already done; it follows the deal's open step", OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const tool of ['opportunity_status', 'get_operation', 'record_decision']) {
    await $.tool.call({ tool: `mcp__plugin_prescreen_prescreen__${tool}`, tool_use_id: `tu_${tool}`, opportunity_id: ID })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // the deal waits on step 3 (the K-1 question and the PFS figures): the pane shows step 3, not step 2
    expect((await ui.find({ type: 'Button', key: 'step-checks' }))?.props.variant).toBe('primary')
    expect((await ui.find({ type: 'Button', key: 'step-documents' }))?.props.variant).toBe('secondary')
    expect(await ui.find({ type: 'Button', key: 'exc-0-reject' })).toBeDefined()
    await ui.unmount()
  }
  // the RM's own pick of a step stays until Claude's next pre-screen call
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'step-documents' })
  expect((await ui.find({ type: 'Button', key: 'step-documents' }))?.props.variant).toBe('primary')
  await ui.unmount()
  await $.tool.call({ tool: 'mcp__plugin_prescreen_prescreen__opportunity_status', tool_use_id: 'tu_again', opportunity_id: ID })
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'step-checks' }))?.props.variant).toBe('primary')
  await ui.unmount()
})

test('one is wrong: the RM picks the figure, which alone is disputed', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'card-0-dispute' })
  calls.length = 0
  await ui.press({ key: 'wrong-0-1' })
  const sent = calls.filter(c => c.tool === 'record_decision')
  expect(sent.length).toBe(1)
  expect(sent[0]?.args.target).toEqual(F2)
  expect(sent[0]?.args.decision).toBe('dispute')
  await ui.unmount()
})

test('a pre-screen tool call opens the pane once and moves it to that step; no card under the tool row', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__plugin_prescreen_prescreen__quick_spread', tool_use_id: 'tu_1', opportunity_id: ID })
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // the pane follows the tool: the numbers step, whatever the stage
  expect((await ui.find({ type: 'Button', key: 'step-policy_fit' }))?.props.variant).toBe('primary')
  await ui.unmount()
  await $.tool.call({ tool: 'mcp__plugin_prescreen_prescreen__collect_documents', tool_use_id: 'tu_2', opportunity_id: ID })
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'step-documents' }))?.props.variant).toBe('primary')
  expect(await ui.find({ type: 'Text', text: /hand-written entries/ })).toBeDefined()
  await ui.unmount()

  const row = { plugin: 'prescreen', component: 'ToolUse', requestId: 'tu_1', props: { tool_use_id: 'tu_1', tool: 'mcp__plugin_prescreen_prescreen__quick_spread', input: {}, isRunning: false, isErrored: false, isInterrupted: false } } as const
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const r = await $.ui.mount({ ...row, surface })
    expect(await r.find({ type: 'Markdown' })).toBeUndefined()
    expect(await r.find({ type: 'Text', text: /engine row/ })).toBeDefined()
    await r.unmount()
  }
})

test('a decision the model invents is refused; a real one is recorded under the RM', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const tool = 'mcp__plugin_prescreen_prescreen__record_decision'

  const invented = await $.tool.call({ tool, opportunity_id: ID, target: { type: 'document', document_id: 'doc_made_up' }, decision: 'accept', actor: 'Claude' })
  expect(invented.deny).toContain('not one the server is offering')
  const wrongOption = await $.tool.call({ tool, opportunity_id: ID, target: K1, decision: 'confirm', actor: 'Claude' })
  expect(wrongOption.deny).toContain('accept or reject')
  expect(seen.tools.length).toBe(0)

  const wrongFigure = await $.tool.call({ tool, opportunity_id: ID, target: F1, decision: 'confirm', value: 244500, actor: 'Elena Brooks' })
  expect(wrongFigure.deny).toContain('224,500')
  const real = await $.tool.call({ tool, opportunity_id: ID, target: K1, decision: 'reject', actor: 'Claude' })
  expect(real.deny).toBeUndefined()
  expect(seen.tools[0]?.actor).toBe('Elena Brooks') // the configured RM, whatever the model typed
  const forced = await $.tool.call({ tool: 'mcp__plugin_prescreen_prescreen__run_checks', opportunity_id: ID, force_new: true })
  expect(forced.deny).toContain('force_new')
  // a document already decided can be decided again (undoing a slip); the server has the last word
  const undo = await $.tool.call({ tool, opportunity_id: ID, target: K1, decision: 'accept', actor: 'Elena Brooks' })
  expect(undo.deny).toBeUndefined()
  // an IDP rule or the structure: the server checks those targets itself
  const rule = await $.tool.call({ tool, opportunity_id: ID, target: { type: 'idp_rule', check_run_id: 'run_1', rule_id: 'r7' }, decision: 'acknowledge', actor: 'Elena Brooks', reason: 'seen' })
  expect(rule.deny).toBeUndefined()
  // when the deal cannot be read the decision is not checked, so it is not recorded
  d.down = true
  const blind = await $.tool.call({ tool, opportunity_id: ID, target: K1, decision: 'accept', actor: 'Elena Brooks' })
  expect(blind.deny).toContain('could not be read')
  d.down = false
  // "show me the pane" in plain words: the model's tool opens the same pane
  const shown = await $.tool.call({ tool: 'mcp__prescreen__open_pane', deal: 'riverbend' })
  expect(String(shown.result)).toContain('Pre-screen pane opened for Riverbend')
  const other = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(other.deny).toBeUndefined()
})

test('in a terminal the pane draws the pages as inline images', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  expect(calls.find(c => c.tool === 'document_image')?.args.format).toBe('png')
  // the stand-in answers JPEG for these; a PNG-only surface leaves out what it cannot draw, and says so
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Claude suggests/ })).toBeDefined()
  await ui.unmount()
})

test('where no pane can be placed, the pane command gives the review link instead', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen, false)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  expect(ran?.text).toContain('https://prescreen.example/review/opp?t=abc')
  expect(calls.find(c => c.tool === 'review_link')?.args.read_only_link).toBe(true)
})

test('a rule IDP held back: the reason box, then the acknowledgement under the RM', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.phase = 'rule'
  server(on, d, calls, seen)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /pfs_primary.business_income: 160,800 \(pfs_primary.pdf\)/ })).toBeDefined()
    // the reason box; Claude Code 2.1.310 draws no Input on mobile (2.1.330 does)
    if (surface !== 'mobile') expect(await ui.find({ type: 'Input', key: 'why-0' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // the sides of the rule, each on its page
  expect(calls.filter(c => c.tool === 'evidence_image').map(c => c.args.ref)).toEqual(['pfs_primary.business_income', 'k1_primary.box1_ordinary_income'])
  calls.length = 0
  await ui.press({ key: 'card-0-ack' })
  expect(calls.find(c => c.tool === 'record_decision')).toBeUndefined() // no reason, nothing recorded
  expect(await ui.find({ type: 'Text', text: /say why the deal goes on/ })).toBeDefined()
  await ui.input({ key: 'why-0', text: 'Borrower to explain before credit', kind: 'change' })
  await ui.press({ key: 'card-0-ack' })
  const sent = calls.find(c => c.tool === 'record_decision')
  expect(sent?.args.target).toEqual(RULE)
  expect(sent?.args.decision).toBe('acknowledge')
  expect(sent?.args.reason).toBe('Borrower to explain before credit')
  expect(sent?.args.actor).toBe('Elena Brooks')
  // the band never offers a decision that needs a reason: it shows the card instead
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button', text: 'Go on, noted' })).toBeUndefined()
  await band.unmount()
  await ui.unmount()
})

test('the structure: approved with the server line, sent back only with a reason', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.phase = 'structure'
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: LINE })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'structure-confirm' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  calls.length = 0
  await ui.press({ key: 'structure-dispute' })
  expect(calls.find(c => c.tool === 'record_decision')).toBeUndefined()
  await ui.input({ key: 'why-structure', text: 'Ask for 48 months', kind: 'change' })
  await ui.press({ key: 'structure-dispute' })
  expect(calls.find(c => c.tool === 'record_decision')?.args.reason).toBe('Ask for 48 months')
  calls.length = 0
  await ui.press({ key: 'structure-confirm' })
  const ok = calls.find(c => c.tool === 'record_decision')
  expect(ok?.args.target).toEqual({ type: 'structure' })
  expect(ok?.args.decision).toBe('confirm')
  expect(ok?.args.reason).toBe(LINE)
  // the chat hears it at once, so its own question about the structure does not stay open
  expect(seen.prompts.at(-1)?.text).toContain(`Decided in the pre-screen pane, already recorded under Elena Brooks: approved the structure: ${LINE}.`)
  await ui.unmount()
})

test('steps 1 and 6, and the memo button above the prompt', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.phase = 'memo'
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Not drafted' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'step-opportunity' })
  expect(await ui.find({ type: 'Text', text: /Owners: Anthony J. Carbone \(100%\)/ })).toBeDefined()
  await ui.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'band-next:memo' })
  expect(seen.prompts.at(-1)?.text).toBe('Draft the memo.')
  await band.unmount()
})

test('step 3 shows the quick spread: each input with where it was read, provisional while a figure waits', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Markdown', key: 'spread' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = String((await ui.find({ type: 'Markdown', key: 'spread' }))?.props.text)
  expect(text).toContain('**Quick spread (provisional)**')
  expect(text).toContain('1 input(s) rest on figures that wait for you above')
  expect(text).toContain('| Ordinary business income | $224,500 | Form 1120-S 2025, page 1, line 22 |')
  expect(text).toContain('| PFS cash and deposits | $67,000 · waits for you |')
  expect(text).toContain('$3,763 · corrected in IDP')
  expect(text).toContain('| PFS date | August 31, 2026 |')
  expect(text).toContain('| Rate | 7.85% | Opportunity record |')
  // inbound file names never act as markdown
  expect(text).not.toContain('[evil](http://x)')
  expect(text).toContain('Cash available for debt service $201,396')
  expect(text).toContain('Total debt service $114,256 (existing $45,156, proposed $69,100; $5,758.33 a month)')
  for (const m of ['EBITDA $399,596', 'Business DSCR 1.76x', 'Global DSCR 1.96x', 'Current ratio 2.81x', 'Advance rate 80.0%']) expect(text).toContain(m)
  await ui.unmount()
})

test('once every figure is settled the spread is final in step 3, and step 4 lists all nine metrics', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.k1Open = false
  d.confirmed = ['cfm_1', 'cfm_2']
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const four = String((await ui.find({ type: 'Markdown', key: 'metrics' }))?.props.text)
  for (const m of ['EBITDA $399,596', 'Existing debt service $45,156 a year', 'Proposed debt service $69,100 a year', 'Business DSCR 1.76x', 'Global DSCR 1.96x', 'Funded debt to EBITDA 0.96x', 'Guarantor liquidity 23.5%', 'Advance rate 80.0%', 'Current ratio 2.81x'])
    expect(four).toContain(m)
  await ui.press({ key: 'step-checks' })
  const text = String((await ui.find({ type: 'Markdown', key: 'spread' }))?.props.text)
  expect(text).toContain('**Quick spread**')
  expect(text).not.toContain('provisional')
  expect(text).toContain('Every input is settled. The policy fit is step 4.')
  expect(text).not.toContain('waits for you')
  await ui.unmount()
})

test('step 3 stays provisional while a document question is open, even with every figure confirmed', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.confirmed = ['cfm_1', 'cfm_2'] // the K-1 question is still open
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = String((await ui.find({ type: 'Markdown', key: 'spread' }))?.props.text)
  expect(text).toContain('**Quick spread (provisional)**')
  expect(text).toContain('Step 3 is still open. The numbers count once it is done.')
  await ui.unmount()
})

test('missing inputs: the metric reads not available, never zero, and the spread says what is missing', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.gaps = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = String((await ui.find({ type: 'Markdown', key: 'spread' }))?.props.text)
  expect(text).toContain('| Existing loans, monthly payments | not available |')
  expect(text).toContain("| Guarantor wages | not available | Form 1120-S 2025, page 1, line 7 (not used: more than one owner; each guarantor's Form W-2 is needed) |")
  expect(text).toContain('- Existing debt service not available\n')
  expect(text).toContain('- Business DSCR not available')
  expect(text).toContain('- Global DSCR not available')
  expect(text).not.toContain('Cash available for debt service') // no total debt service: the DSCR lines are left out
  expect(text).toContain('Not worked out: existing debt service: missing Existing loans, monthly payments; global dscr: missing Guarantor wages')
  await ui.unmount()
})

test('a spread the service could not work out says why in step 3', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.spreadError = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(String((await ui.find({ type: 'Markdown', key: 'spread' }))?.props.text)).toBe('**Quick spread**\n\nNot worked out: No credit policy is configured')
  await ui.unmount()
})

test('a service that sends the metrics only: step 3 shows them and says the input lines need a newer service', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.metricsOnly = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = String((await ui.find({ type: 'Markdown', key: 'spread' }))?.props.text)
  expect(text).toContain('the input lines need a newer service')
  expect(text).toContain('Business DSCR 1.76x')
  expect(text).not.toContain('| Input |')
  await ui.unmount()
})

test('an older server: the pane says so and still shows the documents and their questions', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.phase = 'old'
  server(on, d, calls, seen)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /needs 0.4.0/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'exc-0-reject' })).toBeDefined()
    await ui.unmount()
  }
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button' })).toBeUndefined()
  await band.unmount()
})

test('a slash command leaves the lines for the next prompt the model reads', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.refusePrompts = true // the decision waits for a prompt (the chat could not be sent one)
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'exc-0-reject' })
  await ui.unmount()
  await $.prompt.submit({ text: '/prescreen' } as Parameters<typeof $.prompt.submit>[0])
  const asCommand = seen.prompts.at(-1)
  await $.prompt.submit({ text: 'what next?' } as Parameters<typeof $.prompt.submit>[0])
  const last = seen.prompts.at(-1)
  // whichever way the harness raises the slash command, the line reaches the model exactly once
  const carried = [asCommand, last].filter(p => String(p?.context?.[0] ?? '').includes('left out Returns and financials.pdf (p. 8)'))
  expect(carried.length).toBe(1)
  if (asCommand?.command) expect(carried[0]).toBe(last)
})

test('a double press is one action: each figure is confirmed once', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  calls.length = 0
  await Promise.all([ui.press({ key: 'card-0-confirm' }), ui.press({ key: 'card-0-confirm' })])
  const confirms = calls.filter(c => c.tool === 'record_decision').map(c => c.args.target.confirmation_id)
  expect(confirms).toEqual(['cfm_1', 'cfm_2'])
  await ui.unmount()
})

test('step 2: every document has an Open button, and the opened one shows its pages at the top', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'documents' }) // the footer button, from any step
    expect(await ui.find({ type: 'Button', key: 'open-doc_fd44692ea7a1' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'open-doc_40a46b1710f3' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  calls.length = 0
  await ui.press({ key: 'open-doc_fd44692ea7a1' })
  expect(calls.find(c => c.tool === 'document_image')?.args.document_id).toBe('doc_fd44692ea7a1')
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('Page 1 of PFS')
  expect((await ui.find({ type: 'Button', key: 'open-doc_fd44692ea7a1' }))?.props.label).toBe('Showing')
  // the stand-in says the document has two pages: the pager goes to the next one
  calls.length = 0
  await ui.press({ key: 'next-doc_fd44692ea7a1' })
  expect(calls.find(c => c.tool === 'document_image')?.args.page).toBe(2)
  await ui.press({ key: 'close-doc' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('the figures with no position are one line until asked for', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /1 figure\(s\) in use have no position/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /form_1120s.ordinary_income/ })).toBeUndefined()
  await ui.press({ key: 'notes-toggle' })
  expect(await ui.find({ type: 'Text', text: /form_1120s.ordinary_income/ })).toBeDefined()
  await ui.unmount()
})

test('a page that cannot be drawn says why in the pane, and is tried again on the next load', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.noImage = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /The page could not be drawn here: no picture in the answer \(text\{text\}\)/ })).toBeDefined()
  d.noImage = false
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('Page 1 of Returns and financials.pdf (p. 8)')
  await ui.unmount()
})

test('an image in the API shape (source.data), as the desktop hands it, is drawn', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.apiShape = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /could not be drawn/ })).toBeUndefined()
  expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('data:image/jpeg;base64,' + DOT)
  expect(await ui.find({ type: 'Text', text: /Page 1 of 5/ })).toBeDefined()
  await ui.unmount()
})

test('a figure of the hand-filled page shows up close under the card, and closes again', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const before = (await ui.findAll({ type: 'Svg' })).length
  calls.length = 0
  await ui.press({ key: 'fig-0-1' })
  const near = calls.find(c => c.tool === 'evidence_image')
  expect(near?.args.ref).toBe('pfs_primary.net_worth')
  expect(near?.args.mode).toBe('crop')
  expect(near?.args.refs).toBeUndefined()
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(before + 1)
  expect((await ui.findAll({ type: 'Svg' })).some(s => String(s.props.alt).includes('net worth, up close'))).toBe(true)
  await ui.press({ key: 'fig-0-1' })
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(before)
  await ui.unmount()
})

const PAGE = { ...PANE, requestId: 'prescreen-page', props: { ...PANE.props, title: 'Page' } } as const

test('Larger opens the Page pane: the card page in sharp strips, figures outlined; Close shuts it', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  calls.length = 0
  await ui.press({ key: 'larger-card-0' })
  const opened = seen.opened.at(-1)
  expect(opened?.id).toBe('prescreen-page')
  expect(opened?.focus).toBe(true)
  expect(opened?.closeOnEscape).toBe(true)
  const strip = calls.filter(c => c.tool === 'evidence_image')
  expect(strip.map(c => c.args.band)).toEqual([1, 2, 3])
  expect(strip.every(c => c.args.bands === 3 && c.args.mode === 'page' && c.args.max_width === 1300)).toBe(true)
  expect(strip[0]?.args.refs).toEqual(['pfs_primary.business_income', 'pfs_primary.net_worth'])
  await ui.unmount()
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const page = await $.ui.mount({ ...PAGE, surface })
    expect((await page.findAll({ type: 'Svg' })).length).toBe(3)
    expect(await page.find({ type: 'Text', text: /The figures are outlined/ })).toBeDefined()
    await page.unmount()
  }
  const page = await $.ui.mount({ ...PAGE, surface: 'desktop' })
  await page.press({ key: 'page-close' })
  expect(seen.closed).toContain('prescreen-page')
  await page.unmount()
})

test('a document page opens larger with its own pager', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  calls.length = 0
  await ui.press({ key: 'larger-doc-doc_40a46b1710f3' })
  expect(calls.filter(c => c.tool === 'document_image' && c.args.bands === 3).map(c => c.args.band)).toEqual([1, 2, 3])
  await ui.unmount()
  const page = await $.ui.mount({ ...PAGE, surface: 'desktop' })
  expect(await page.find({ type: 'Text', text: /page 1 of 2/ })).toBeDefined()
  calls.length = 0
  await page.press({ key: 'page-next' })
  expect(calls.filter(c => c.tool === 'document_image').every(c => c.args.page === 2)).toBe(true)
  expect(await page.find({ type: 'Text', text: /page 2 of 2/ })).toBeDefined()
  await page.unmount()
})

test('a page the engine will not hand back at full width is asked for again narrower', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.noteWide = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const widths = calls.filter(c => c.tool === 'document_image').map(c => c.args.max_width)
  expect(widths.slice(0, 3)).toEqual([900, 700, 560])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /could not be drawn/ })).toBeUndefined()
  await ui.unmount()
})

test('a strip too large for one picture: the Page pane asks for more, smaller strips', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.bigStrips = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  calls.length = 0
  await ui.press({ key: 'larger-doc-doc_40a46b1710f3' })
  const asked = calls.filter(c => c.tool === 'document_image').map(c => `${c.args.band}/${c.args.bands}@${c.args.max_width}`)
  expect(asked).toEqual(['1/3@1300', '1/4@1300', '2/4@1300', '3/4@1300', '4/4@1300'])
  await ui.unmount()
  const page = await $.ui.mount({ ...PAGE, surface: 'desktop' })
  expect((await page.findAll({ type: 'Svg' })).length).toBe(4)
  await page.unmount()
})

test('a strip that never answers: the Page pane names the step, and its own Try again loads the page', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.stallStrips = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  calls.length = 0
  await ui.press({ key: 'larger-doc-doc_40a46b1710f3' })
  await ui.unmount()
  let page = await $.ui.mount({ ...PAGE, surface: 'desktop' })
  // never a bare "Loading": the step that did not answer is named, with a button to ask again
  expect(await page.find({ type: 'Text', text: /Loading the page/ })).toBeUndefined()
  expect(await page.find({ type: 'Text', text: /document_image \(\d+ px\) did not answer in 30 s/ })).toBeDefined()
  expect((await page.findAll({ type: 'Svg' })).length).toBe(0)
  expect(await page.find({ type: 'Button', key: 'page-retry' })).toBeDefined()
  // the server answers again: the Page pane's own button loads the strips
  d.stallStrips = false
  await page.press({ key: 'page-retry' })
  await page.unmount()
  page = await $.ui.mount({ ...PAGE, surface: 'desktop' })
  expect((await page.findAll({ type: 'Svg' })).length).toBe(3)
  expect(await page.find({ type: 'Text', text: /did not answer/ })).toBeUndefined()
  expect(await page.find({ type: 'Button', key: 'page-retry' })).toBeUndefined()
  // closing the pane leaves nothing behind for the next Larger
  await page.press({ key: 'page-close' })
  await page.unmount()
  expect(seen.closed).toContain('prescreen-page')
})

test('a window that never answers the Page pane open: it says so and loads the page anyway', OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.stallOpen = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  calls.length = 0
  await ui.press({ key: 'larger-doc-doc_40a46b1710f3' })
  await ui.unmount()
  expect(calls.filter(c => c.tool === 'document_image' && c.args.bands === 3).map(c => c.args.band)).toEqual([1, 2, 3])
  const page = await $.ui.mount({ ...PAGE, surface: 'desktop' })
  expect((await page.findAll({ type: 'Svg' })).length).toBe(3)
  expect(await page.find({ type: 'Text', text: /Opening the Page pane did not answer in 10 s; loading anyway/ })).toBeDefined()
  await page.unmount()
})

test("strips without the server's details: drawn, and the pane says the page count may be wrong", OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  d.bareStrips = true
  server(on, d, calls, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'larger-doc-doc_40a46b1710f3' })
  await ui.unmount()
  const page = await $.ui.mount({ ...PAGE, surface: 'desktop' })
  expect((await page.findAll({ type: 'Svg' })).length).toBe(3)
  // the count the small picture gave stands (2), not the guess of 1
  expect(await page.find({ type: 'Text', text: /page 1 of 2/ })).toBeDefined()
  expect(await page.find({ type: 'Text', text: /without the server's details/ })).toBeDefined()
  await page.unmount()
})

test("Larger and Try again run in the mod's press hook, not the Button's closure (whose render's calls stop after 30 s)", OPTIONS, async ($, on) => {
  const { d, calls, seen } = fresh()
  server(on, d, calls, seen)
  // beneath the mod: a press the mod lets through reaches here and then the Button's own onPress
  const below: string[] = []
  on('ui.press', (_, e, next) => {
    below.push(e.element)
    return next(e)
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'prescreen', args: 'riverbend' } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  calls.length = 0
  await ui.press({ key: 'larger-doc-doc_40a46b1710f3' })
  await ui.press({ key: 'card-0-confirm' })
  await ui.unmount()
  // a decision still goes to its Button (recorded); Larger never reaches the closure. (2.1.331's test kit
  // raises no ui.press to a test's own hook, so there `below` stays empty either way.)
  expect(calls.some(c => c.tool === 'record_decision')).toBe(true)
  expect(below).not.toContain('larger-doc-doc_40a46b1710f3')
  expect(calls.filter(c => c.tool === 'document_image' && c.args.bands === 3).map(c => c.args.band)).toEqual([1, 2, 3])
  const page = await $.ui.mount({ ...PAGE, surface: 'desktop' })
  expect((await page.findAll({ type: 'Svg' })).length).toBe(3)
  await page.press({ key: 'page-next' })
  expect(await page.find({ type: 'Text', text: /page 2 of 2/ })).toBeDefined()
  await page.unmount()
  expect(below.filter(k => k.startsWith('page-') || k.startsWith('larger-'))).toEqual([])
})

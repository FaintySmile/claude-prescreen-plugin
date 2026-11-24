// The pre-screen pane, the reply buttons above the prompt, the /prescreen command and the decision guard.
//
// Everything here is code, not a prompt: the pane draws the server's own payload (its steps, its buttons,
// what needs the RM), a decision button calls the server with the target the server offered, and a
// decision the model tries to record is checked against what the server is asking for before it runs.
// A weaker model changes none of it.
//
// Two kinds of button (plan D2). A work step (`prompt`) submits the server's fixed sentence, so Claude does
// the work. A decision is the RM's own act: the mod records it itself, under the RM's configured name, and
// never as a prompt. A decision is pressed where the document is seen: the card in the pane always carries
// its buttons next to the page; above the prompt they show only while the pane shows that step, otherwise
// a "Show me" that opens it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AttentionRow, Board, Deal, Large, Picture, Proposal, Target } from '../types'

const PANE = 'prescreen'
// the server's tools, under either name the session may list them by: the plugin's own server
// (mcp__plugin_prescreen_prescreen__*) or one added with `claude mcp add prescreen`
const TOOL = /^mcp__(?:plugin_prescreen_)?prescreen__([a-z_]+)$/
const SETS_ACTOR = new Set(['record_decision', 'update_opportunity', 'draft_memo', 'review_link'])
// tool -> the step its result belongs to: the pane moves there after the call (the server's TOOL_STEP)
const TOOL_STEP: Record<string, string> = {
  start_prescreen: 'opportunity',
  update_opportunity: 'opportunity',
  opportunity_status: 'documents',
  collect_documents: 'documents',
  mailbox_overview: 'documents',
  run_checks: 'checks',
  get_operation: 'checks',
  record_decision: 'checks',
  suggest_decision: 'checks',
  quick_spread: 'policy_fit',
  policy_fit: 'policy_fit',
  memo_parts: 'memo',
  draft_memo: 'memo',
}

const selected = atom({ plugin: 'prescreen', key: 'selected' } as const, null)
const board = atom({ plugin: 'prescreen', key: 'board' } as const, null, { shape: 'board-2' })
const deals = atom({ plugin: 'prescreen', key: 'deals' } as const, [], { shape: 'deals-1' })
const note = atom({ plugin: 'prescreen', key: 'note' } as const, '')
const pictures = atom({ plugin: 'prescreen', key: 'pictures' } as const, {}, { shape: 'pictures-4' })
const step = atom({ plugin: 'prescreen', key: 'step' } as const, null)
const placed = atom({ plugin: 'prescreen', key: 'placed' } as const, false)
const outbox = atom({ plugin: 'prescreen', key: 'outbox' } as const, [], { shape: 'outbox-1' })
const page = atom({ plugin: 'prescreen', key: 'page' } as const, {}, { shape: 'page-1' })
const viewing = atom({ plugin: 'prescreen', key: 'viewing' } as const, null)
const picking = atom({ plugin: 'prescreen', key: 'picking' } as const, null)
const reasons = atom({ plugin: 'prescreen', key: 'reasons' } as const, {}, { shape: 'reasons-1' })
const link = atom({ plugin: 'prescreen', key: 'link' } as const, null)
const showNotes = atom({ plugin: 'prescreen', key: 'showNotes' } as const, false)
// a figure of a hand-filled page shown up close under the card
const closeup = atom({ plugin: 'prescreen', key: 'closeup' } as const, null)
// what the Page pane shows, and its strips
const large = atom({ plugin: 'prescreen', key: 'large' } as const, null, { shape: 'large-1' })
const strips = atom({ plugin: 'prescreen', key: 'strips' } as const, {}, { shape: 'strips-1' })
const PAGE_PANE = 'prescreen-page'

type Engine = EngineInterface
type Json = Record<string, any>

// ------------------------------------------------------------------ words and tables

const money = (v: unknown): string =>
  typeof v === 'number' ? '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'not available'
const figure = (v: unknown): string =>
  typeof v === 'number' ? v.toLocaleString('en-US') : v === null || v === undefined ? 'not available' : String(v)

// File names, subjects and evidence text come from inbound mail: nothing in them may act as markdown.
const plain = (v: unknown): string =>
  String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\`*_[\]<>|#!()~]/g, c => '\\' + c)
    .slice(0, 300)

const table = (head: string[], rows: string[][]): string =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')

const sameTarget = (a: unknown, b: Target): boolean => {
  if (typeof a !== 'object' || a === null) return false
  const left = Object.entries(a as Json).filter(([, v]) => v !== null && v !== undefined)
  return left.length === Object.keys(b).length && left.every(([k, v]) => b[k] === v)
}

// a document's name for a button: the page part kept whole ("…financials.pdf (p. 8)"), the rest cut to fit
const short = (title: string, room = 34): string => {
  if (title.length <= room) return title
  const m = /\s*(\([^)]*\))$/.exec(title)
  const tail = m ? ` ${m[1]}` : ''
  return title.slice(0, Math.max(8, room - tail.length - 1)).trimEnd() + '…' + tail
}

const field = (ref: string): string => (ref.split('.')[1] ?? ref).replace(/_/g, ' ')

function toBoard(data: Json, hasScreens: boolean, now: string): Board {
  const o: Json = data.opportunity
  const r: Json = o.request ?? {}
  const titles: Record<string, string> = {}
  for (const d of o.documents ?? []) titles[d.document_id] = d.title
  const cr: Json | null = data.check_run ?? null
  const fit: Json | null = data.policy_fit ?? null
  const m: Json = data.quick_spread?.metrics ?? {}
  const ratio = (v: unknown, unit: string) => (typeof v === 'number' ? v.toFixed(unit === '%' ? 1 : 2) + unit : 'not available')
  const structure: string[] = []
  const s: Json = fit?.structure ?? {}
  if (s.rate) {
    structure.push(
      s.rate.guidance_pct === null || s.rate.guidance_pct === undefined
        ? `Rate: requested ${s.rate.requested_pct}%; guidance not walked`
        : `Rate: requested ${s.rate.requested_pct}%; guidance ${Number(s.rate.guidance_pct).toFixed(2)}% (policy ${s.rate.section})` +
            (s.rate.within_rm_authority === true ? "; within the RM's authority" : s.rate.within_rm_authority === false ? "; outside the RM's authority" : ''),
    )
  }
  if (typeof s.monthly_payment === 'number') structure.push(`Payment: ${money(s.monthly_payment)} a month`)
  if (s.guarantors) structure.push(`Guarantor: ${s.guarantors.text} (policy ${s.guarantors.section})`)
  if (s.approval) structure.push(`Approval: ${s.approval.text} (policy ${s.approval.section})`)
  for (const c of s.standard_terms?.conditions ?? []) structure.push(`Condition: ${c}`)
  for (const c of s.standard_terms?.covenants ?? []) structure.push(`Covenant: ${c}`)

  return {
    id: String(o.opportunity_id),
    borrower: String(o.borrower?.name ?? o.opportunity_id),
    request: [r.type, typeof r.amount === 'number' ? money(r.amount) : null, r.term_months ? `${r.term_months} months` : null, typeof r.rate_pct === 'number' ? `${r.rate_pct}%` : null]
      .filter(Boolean)
      .join(' · '),
    owners: (o.owners ?? []).map((w: Json) => `${w.name}${typeof w.pct === 'number' ? ` (${w.pct}%)` : ''}`),
    summary: String(o.summary ?? 'no documents collected yet'),
    isComplete: o.dossier_complete === true,
    hasScreens,
    steps: (data.steps ?? []).map((x: Json) => ({
      key: String(x.key),
      n: Number(x.n),
      label: String(x.label),
      state: String(x.state),
      headline: String(x.headline ?? ''),
      waiting: Number(x.waiting ?? 0),
    })),
    stage: data.stage ?? null,
    proposals: (data.proposals ?? []).map((p: Json) => ({
      id: String(p.id),
      step: String(p.step ?? ''),
      kind: p.kind === 'decision' || p.kind === 'show' ? p.kind : 'prompt',
      label: String(p.label),
      text: String(p.text ?? ''),
      target: p.target ?? null,
      decision: String(p.decision ?? ''),
      card: String(p.card ?? ''),
      count: Number(p.count ?? 0),
      pickOne: p.pick_one === true,
      needsReason: p.needs_reason === true,
      reason: String(p.reason ?? ''),
      about: String(p.about ?? ''),
      suggested: p.suggested === true,
    })),
    checklist: (o.checklist ?? []).map((c: Json) => ({
      label: String(c.label ?? c.item),
      status: String(c.status).replace('_', ' '),
      document: c.document_id ? String(titles[c.document_id] ?? '') : '',
      documentId: String(c.document_id ?? ''),
    })),
    documents: (o.documents ?? []).map((d: Json) => ({
      id: String(d.document_id),
      title: String(d.title),
      status: String(d.status),
      item: String(d.checklist_item ?? ''),
      notes: (d.notes ?? []).map((n: Json) => String(n.message)),
    })),
    candidates: (o.documents ?? [])
      .filter((d: Json) => d.checklist_item && ['accepted', 'rejected', 'needs_review'].includes(String(d.status)))
      .map((d: Json) => String(d.document_id)),
    exceptions: (o.exceptions ?? []).map((x: Json) => ({
      title: String(x.title),
      item: String(x.checklist_item ?? ''),
      reasons: (x.reasons ?? []).map((n: Json) => String(n.message)),
      target: x.decision_target,
      options: x.options ?? [],
      documentId: String(x.document_id ?? x.decision_target?.document_id ?? ''),
      suggestion: x.suggestion ? { decision: String(x.suggestion.decision), why: String(x.suggestion.why ?? '') } : null,
    })),
    attention: (data.attention ?? []).map((a: Json) => ({
      card: String(a.card),
      kind: String(a.kind),
      reason: String(a.reason),
      blocking: a.blocking !== false,
      ref: String(a.ref ?? ''),
      value: a.value ?? null,
      document: String(a.document ?? ''),
      page: Number(a.page ?? 1),
      hasPosition: a.has_position === true,
      confidence: typeof a.confidence === 'number' ? a.confidence : null,
      words: String(a.evidence ?? ''),
      usedBy: (a.used_by ?? []).map(String),
      name: String(a.name ?? ''),
      status: String(a.status ?? ''),
      text: String(a.text ?? ''),
      sides: (a.sides ?? []).map((sd: Json) => ({
        ref: String(sd.ref ?? ''),
        line: `${sd.ref ?? sd.field_name}: ${(sd.values ?? []).map((v: Json) => figure(v.value)).join(', ') || 'not read'}${sd.values?.[0]?.filename ? ` (${sd.values[0].filename})` : ''}`,
      })),
      target: a.decision_target ?? null,
      options: a.options ?? [],
    })),
    notes: (data.field_notes ?? []).map((n: Json) => `${n.ref} = ${figure(n.value)}: ${n.note}`),
    running: (data.operations_running ?? []).map(
      (op: Json) => `${op.type === 'check_run' ? 'IDP read' : 'Collection'}: ${op.progress?.stage ?? op.status}${op.progress?.idp_status ? ` (${op.progress.idp_status})` : ''}`,
    ),
    run: !cr
      ? null
      : {
          id: String(cr.check_run_id),
          counts: cr.checks_summary
            ? `${cr.checks_summary.pass} pass, ${cr.checks_summary.fail} fail, ${cr.checks_summary.cannot_verify} cannot verify`
            : 'no result yet',
          review: String(cr.review?.state ?? cr.status ?? ''),
          checks: (cr.checks ?? []).map((c: Json) => ({
            id: String(c.check_id),
            title: String(c.title),
            status: c.status === 'cannot_verify' ? 'cannot verify' : String(c.status),
            note: c.review_state === 'needs_confirmation' ? 'awaits confirmation' : String(c.reason ?? ''),
          })),
          pending: (cr.review?.pending_confirmations ?? []).map((p: Json) => ({ ref: String(p.ref), value: p.value ?? null, target: p.decision_target })),
        },
    fit: !fit?.rules?.length
      ? null
      : {
          version: String(fit.policy_version ?? ''),
          text: String(fit.summary?.text ?? ''),
          rules: fit.rules.map((x: Json) => ({
            section: String(x.section),
            rule: String(x.rule),
            limit: String(x.limit_text ?? ''),
            value: String(x.value_text ?? 'not available'),
            status: String(x.status),
          })),
          structure,
          oneLine: String(s.one_line ?? ''),
        },
    metrics: data.quick_spread
      ? [
          `Business DSCR ${ratio(m.dscr, 'x')}`,
          `Global DSCR ${ratio(m.global_dscr, 'x')}`,
          `Funded debt to EBITDA ${ratio(m.funded_debt_to_ebitda, 'x')}`,
          `Guarantor liquidity ${ratio(m.guarantor_liquidity_pct, '%')}`,
          `Advance rate ${ratio(m.advance_rate_pct, '%')}`,
        ]
      : [],
    loadedAt: now,
  }
}

const checklistTable = (b: Board): string =>
  table(['Item', 'Status', 'Document'], b.checklist.map(c => [plain(c.label), plain(c.status), plain(c.document)]))
const checksTable = (b: Board): string =>
  b.run ? table(['Check', 'What it compares', 'Result', ''], b.run.checks.map(c => [plain(c.id), plain(c.title), plain(c.status), plain(c.note)])) : ''
const fitTable = (b: Board): string =>
  b.fit ? table(['Section', 'Rule', 'Limit', 'This deal', 'Result'], b.fit.rules.map(r => [plain(r.section), plain(r.rule), plain(r.limit), plain(r.value), plain(r.status)])) : ''

// the cards of the attention list, in the server's order: a hand-filled page is one card
function cardsOf(b: Board): { card: string; rows: AttentionRow[] }[] {
  const out: { card: string; rows: AttentionRow[] }[] = []
  for (const a of b.attention) {
    const at = out.find(c => c.card === a.card)
    if (at) at.rows.push(a)
    else out.push({ card: a.card, rows: [a] })
  }
  return out
}

// a server before 0.4.0 has no steps: the pane then shows the documents and their questions
const shownStep = async ($: Engine, b: Board): Promise<string> =>
  b.steps.length ? ((await read($, step)) ?? b.stage ?? 'memo') : 'checks'

// ------------------------------------------------------------------ the server

async function findServer($: Engine): Promise<{ name: string; hasScreens: boolean } | null> {
  const names = (await $.tool.list()).map(t => t.name)
  for (const suffix of ['workbench_view', 'opportunity_status']) {
    for (const name of names) {
      const m = TOOL.exec(name)
      if (m && m[1] === suffix) return { name: name.slice('mcp__'.length, -(`__${suffix}`.length)), hasScreens: suffix === 'workbench_view' }
    }
  }
  return null
}

// `server` is the name inside the tool's own name (plugin_prescreen_prescreen); a build that wants the
// name as /mcp lists it gets that on the second try
async function mcpCall($: Engine, server: string, tool: string, args: Json) {
  return $.mcp.call(server, tool, args).catch(err => {
    if (server !== 'plugin_prescreen_prescreen') throw err
    return $.mcp.call('plugin:prescreen:prescreen', tool, args)
  })
}

async function ask($: Engine, server: string, tool: string, args: Json): Promise<Json> {
  const r = await mcpCall($, server, tool, args)
  const text = r.content.map(c => ('text' in c && typeof c.text === 'string' ? c.text : '')).join(' ').trim()
  if (r.isError) throw new Error(text || `${tool} failed`)
  if (r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent as Json
  try {
    return JSON.parse(text) as Json
  } catch {
    // e.g. Claude Code's "Error: result (n characters) exceeds maximum allowed tokens", which is not flagged isError
    throw new Error(text ? text.slice(0, 160) : `${tool} returned nothing`)
  }
}

// the window the session started in, as session.start reports it (a reload runs session.start again)
let firstSurface = ''
// the pane opens by itself once per session, on the first pre-screen tool call
let openedOnce = false
// while the server reports work running, the pane reads it again every few seconds
let ticker: { cancel: () => void } | null = null

async function picture1(
  $: Engine,
  server: string,
  tool: string,
  args: Json,
  format: 'png' | 'jpeg',
  caption: string,
): Promise<Picture> {
  // the sharpest picture that fits: one Svg holds at most 131,072 characters, so a dense page (the 1120-S) is
  // asked again narrower until it fits; the server caches each width it drew
  const widths = format === 'png' ? [400] : [900, 700, 560]
  let last: Picture | null = null
  for (const width of widths) {
    last = await pictureAt($, server, tool, args, format, caption, width)
    // any failure steps down, not only one the mod can measure: an engine may hand back a note in place
    // of a picture it thought too large
    if (!last.error) return last
  }
  return last as Picture
}

async function pictureAt(
  $: Engine,
  server: string,
  tool: string,
  args: Json,
  format: 'png' | 'jpeg',
  caption: string,
  maxWidth: number,
): Promise<Picture> {
  const failed = (error: string): Picture => ({ format, data: '', width: 0, height: 0, pages: 1, caption, error })
  let r
  try {
    r = await mcpCall($, server, tool, { ...args, format, max_width: maxWidth })
  } catch (err) {
    return failed(`the call failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 240))
  }
  const info = (r.structuredContent ?? {}) as Json
  if (r.isError) {
    const text = r.content.map(c => (typeof c.text === 'string' ? c.text : '')).join(' ').trim()
    return failed(`the server said: ${text || 'error'}`.slice(0, 240))
  }
  // the image block comes in MCP's shape ({ data, mimeType }: Claude Code 2.1.310, the test kit) or in the
  // Anthropic API's ({ source: { type: 'base64', media_type, data } }: the desktop's 2.1.330)
  const block = r.content.find(c => c.type === 'image') as { data?: unknown; source?: { type?: unknown; data?: unknown } } | undefined
  const b64 = typeof block?.data === 'string' ? block.data : block?.source?.type === 'base64' && typeof block.source.data === 'string' ? block.source.data : ''
  const img = block && b64 ? { data: b64 } : undefined
  if (!img) {
    // what came back instead: the kinds of block and their fields, so a live look says what the engine did
    const kinds = r.content.map(c => `${c.type}{${Object.keys(c).filter(k => k !== 'type').join(',')}}`).join(' ')
    return failed(`no picture in the answer (${kinds || 'no content'})`.slice(0, 240))
  }
  // an SVG holds at most 131,072 characters and the terminal reads at most 2 MiB: leave out what does not fit
  const cap = format === 'png' ? 900_000 : 120_000
  if (img.data.length >= cap) return failed(`the picture is ${img.data.length} characters, over the ${cap} this surface draws`)
  return { format, data: img.data, width: Number(info.width) || 560, height: Number(info.height) || 240, pages: Number(info.page_count) || 1, caption, error: '' }
}

async function loadPictures($: Engine, server: string, b: Board): Promise<void> {
  // only what the step on screen shows: the documents with a question, each card's page, a rule's two
  // sides; in step 2 the document opened
  const shown = await shownStep($, b)
  const pages = await read($, page)
  const wanted: { key: string; tool: string; args: Json; caption: string }[] = []
  if (shown === 'checks') {
    for (const x of b.exceptions.slice(0, 3)) {
      const n = pages[x.documentId] ?? 1
      wanted.push({ key: `doc|${x.documentId}|${n}`, tool: 'document_image', args: { opportunity_id: b.id, document_id: x.documentId, page: n }, caption: `Page ${n} of ${x.title}, as it arrived` })
    }
    const near = await read($, closeup)
    if (near && b.run && b.attention.some(a => a.ref === near)) {
      wanted.push({ key: `zoom|${b.run.id}|${near}`, tool: 'evidence_image', args: { opportunity_id: b.id, check_run_id: b.run.id, ref: near, mode: 'crop' }, caption: `${field(near)}, up close on its page` })
    }
    for (const { card, rows } of cardsOf(b).filter(c => c.rows[0]?.blocking).slice(0, 3)) {
      const first = rows[0]
      if (!first || !b.run) continue
      if (first.kind === 'field') {
        const several = rows.length > 1
        wanted.push({
          key: `card|${b.run.id}|${card}`,
          tool: 'evidence_image',
          args: { opportunity_id: b.id, check_run_id: b.run.id, ref: first.ref, mode: several ? 'page' : 'crop', ...(several ? { refs: rows.map(r => r.ref) } : {}) },
          caption: several ? `${first.document}, page ${first.page}: the ${rows.length} figures outlined` : `${first.ref} on ${first.document}, outlined`,
        })
      } else {
        for (const sd of first.sides.filter(x => x.ref).slice(0, 2)) {
          wanted.push({ key: `side|${b.run.id}|${sd.ref}`, tool: 'evidence_image', args: { opportunity_id: b.id, check_run_id: b.run.id, ref: sd.ref, mode: 'crop' }, caption: sd.line })
        }
      }
    }
  }
  if (shown === 'documents') {
    const id = await read($, viewing)
    const doc = b.documents.find(d => d.id === id)
    if (doc) {
      const n = pages[doc.id] ?? 1
      wanted.push({ key: `doc|${doc.id}|${n}`, tool: 'document_image', args: { opportunity_id: b.id, document_id: doc.id, page: n }, caption: `Page ${n} of ${doc.title}` })
    }
  }
  // the terminal draws a PNG, every other surface an SVG that holds a JPEG: fetch the one this window uses
  const format = firstSurface === 'terminal' ? 'png' : 'jpeg'
  const have = await read($, pictures)
  const next: Record<string, Picture> = {}
  for (const w of wanted) {
    const old = have[w.key]
    if (old && old.format === format && !old.error) {
      next[w.key] = old
      continue
    }
    next[w.key] = await picture1($, server, w.tool, w.args, format, w.caption)
  }
  await update($, pictures, () => next)
}

// strips per page and the width asked for, sharpest first: each strip must fit one picture in a pane
const STRIP_PLANS: [number, number][] = [
  [3, 1300],
  [4, 1300],
  [4, 1000],
  [6, 1000],
]

async function loadLarge($: Engine): Promise<void> {
  const L = await read($, large)
  if (!L) return
  const server = await findServer($)
  if (!server) return
  const format = firstSurface === 'terminal' ? 'png' : 'jpeg'
  const base =
    L.kind === 'doc'
      ? { tool: 'document_image', args: { opportunity_id: L.opportunityId, document_id: L.docId, page: L.page } as Json }
      : { tool: 'evidence_image', args: { opportunity_id: L.opportunityId, check_run_id: L.runId, ref: L.ref, refs: L.refs, mode: 'page' } as Json }
  const plans: [number, number][] = format === 'png' ? [[3, 800]] : STRIP_PLANS
  let got: Picture[] = []
  for (const [n, width] of plans) {
    got = []
    let over = false
    for (let i = 1; i <= n; i++) {
      const pic = await pictureAt($, server.name, base.tool, { ...base.args, band: i, bands: n }, format, `${L.title}, page ${L.page}, part ${i} of ${n}`, width)
      got.push(pic)
      if (pic.error) {
        over = true
        break
      }
    }
    if (!over) break
  }
  await update($, strips, () => Object.fromEntries(got.map((p, i) => [String(i), p])))
  const pages = got[0] && !got[0].error ? got[0].pages : L.pages
  if (L.kind === 'doc' && pages !== L.pages) await update($, large, v => (v ? { ...v, pages } : v))
}

async function openLarge($: Engine, what: Large): Promise<void> {
  await update($, large, () => what)
  await update($, strips, () => ({}))
  const opened = await $.ui.open({ id: PAGE_PANE, title: 'Page', focus: true, closeOnEscape: true })
  if (!opened.isPlaced) {
    await update($, note, () => 'This window has no room for a second pane; the review page shows every page at full size.')
    return
  }
  await loadLarge($)
}

async function load($: Engine, id: string): Promise<Board | null> {
  const server = await findServer($)
  if (!server) {
    await update($, note, () => 'The pre-screen server is not connected. Check the plugin settings (service URL and token).')
    return null
  }
  try {
    const data = server.hasScreens
      ? await ask($, server.name, 'workbench_view', { opportunity_id: id, compact: true })
      : { opportunity: await ask($, server.name, 'opportunity_status', { opportunity_id: id }) }
    const b = toBoard(data, server.hasScreens, new Date(await $.clock.now()).toISOString())
    await update($, board, () => b)
    await update($, selected, () => id)
    const now = b.steps.find(s => s.key === b.stage)
    $.ui.status(b.running.length ? `pre-screen: ${b.running[0]}` : now?.waiting ? `pre-screen: ${now.waiting} for you` : undefined)
    poll($, id, b.running.length > 0)
    // pictures are an extra: a failure there must never cost the pane its data
    if (server.hasScreens) await loadPictures($, server.name, b).catch(() => undefined)
    return b
  } catch (err) {
    await update($, note, () => `Could not read the deal: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function poll($: Engine, id: string, on: boolean): void {
  if (on && !ticker) ticker = $.clock.every(4000, () => void load($, id))
  if (!on && ticker) {
    ticker.cancel()
    ticker = null
  }
}

async function loadDeals($: Engine): Promise<void> {
  const server = await findServer($)
  if (!server) {
    await update($, note, () => 'The pre-screen server is not connected. Check the plugin settings (service URL and token).')
    return
  }
  try {
    const out = await ask($, server.name, 'list_opportunities', {})
    const rows: Deal[] = (out.opportunities ?? []).map((o: Json) => ({
      id: String(o.opportunity_id),
      borrower: String(o.borrower),
      summary: String(o.summary ?? 'no documents yet'),
    }))
    await update($, deals, () => rows)
    await update($, note, () => '')
  } catch (err) {
    await update($, note, () => `Could not list the deals: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ------------------------------------------------------------------ the RM's decisions, and telling the chat

// Pane to chat (D4): a notice row the person sees, and one line queued for the model's next prompt.
async function tell($: Engine, rm: string, did: string, b: Board | null): Promise<void> {
  const where = b?.steps.find(s => s.key === b.stage)
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: `Recorded: ${did} (${rm}, in the pane)` }] } }).catch(() => undefined)
  const line =
    `Since your last turn the RM decided in the pre-screen pane: ${did}.` +
    (where ? ` Now: step ${where.n}, ${where.label}: ${where.headline}.` : '') +
    ' Read opportunity_status before the next step; do not record these decisions again.'
  await update($, outbox, all => [...all.slice(-19), line])
}

async function record($: Engine, rm: string, id: string, target: Target, decision: string, extra: Json = {}): Promise<void> {
  const server = await findServer($)
  if (!server) throw new Error('the pre-screen server is not connected')
  await ask($, server.name, 'record_decision', { opportunity_id: id, target, decision, actor: rm, reason: 'decided in the Claude Code pane', ...extra })
}

// one press is one action: a second press while the first is still being recorded does nothing (a double
// click once confirmed three PFS figures twice)
let busy = false

async function decide($: Engine, rm: string, id: string, run: () => Promise<string>): Promise<void> {
  if (!rm) {
    await update($, note, () => 'Set "Your name (RM)" in the plugin settings first: it is recorded with every decision.')
    return
  }
  if (busy) return
  busy = true
  await update($, note, () => 'Recording…')
  try {
    const did = await run()
    await update($, note, () => '')
    const b = await load($, id)
    await tell($, rm, did, b)
  } catch (err) {
    await update($, note, () => `Not recorded: ${err instanceof Error ? err.message : String(err)}`)
    await load($, id)
  } finally {
    busy = false
  }
}

// a document question: accept or reject
const decideDocument = ($: Engine, rm: string, b: Board, target: Target, decision: string, title: string) =>
  decide($, rm, b.id, async () => {
    await record($, rm, b.id, target, decision)
    return `${decision === 'reject' ? 'left out' : 'accepted'} ${title}`
  })

// a card's figures: each is confirmed at the value the server holds now, never an old drawing's
const confirmCard = ($: Engine, rm: string, b: Board, card: string) =>
  decide($, rm, b.id, async () => {
    const now = await load($, b.id)
    const rows = (now?.attention ?? []).filter(a => a.card === card && a.target && a.options.includes('confirm'))
    if (!rows.length) throw new Error('those figures are no longer waiting for a confirmation; look again')
    for (const a of rows) await record($, rm, b.id, a.target as Target, 'confirm', { value: a.value })
    const doc = rows[0]?.document || 'the page'
    return rows.length > 1 ? `confirmed the ${rows.length} figures on ${doc} as read` : `confirmed ${rows[0]?.ref} = ${figure(rows[0]?.value)}`
  })

const disputeOne = ($: Engine, rm: string, b: Board, a: AttentionRow) =>
  decide($, rm, b.id, async () => {
    await record($, rm, b.id, a.target as Target, 'dispute', { reason: 'the page shows a different figure (in the Claude Code pane)' })
    await update($, picking, () => null)
    return `disputed ${a.ref} = ${figure(a.value)}`
  })

async function withReason($: Engine, card: string): Promise<string> {
  return ((await read($, reasons))[card] ?? '').trim()
}

const acknowledge = ($: Engine, rm: string, b: Board, a: AttentionRow) =>
  decide($, rm, b.id, async () => {
    const why = await withReason($, a.card)
    if (!why) throw new Error('say why the deal goes on despite this, in the box, first')
    await record($, rm, b.id, a.target as Target, 'acknowledge', { reason: why })
    return `went on despite ${a.name} (${why})`
  })

const structure = ($: Engine, rm: string, b: Board, p: Proposal) =>
  decide($, rm, b.id, async () => {
    if (p.decision === 'confirm') {
      await record($, rm, b.id, p.target ?? { type: 'structure' }, 'confirm', { reason: p.reason || b.fit?.oneLine || 'the proposed structure' })
      return `approved the structure: ${p.reason || b.fit?.oneLine}`
    }
    const why = await withReason($, 'structure')
    if (!why) throw new Error('say what should change, in the box, first')
    await record($, rm, b.id, p.target ?? { type: 'structure' }, 'dispute', { reason: why })
    return `sent the structure back: ${why}`
  })

// One action for a proposal, from the pane or from the band.
async function act($: Engine, rm: string, p: Proposal): Promise<void> {
  const b = await read($, board)
  if (!b) return
  if (p.kind === 'prompt') {
    // the mod's own prompt.submit hook does not hear a prompt the mod submits (Claude Code 2.1.310), and
    // $.prompt.submit takes no context: the waiting lines go first as a row for the model, read with this turn
    const lines = await read($, outbox)
    if (lines.length) {
      await update($, outbox, () => [])
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: lines.join('\n') }] } }).catch(() => undefined)
    }
    await $.prompt.submit({ text: p.text })
    return
  }
  if (p.kind === 'show') {
    await update($, step, () => p.step || 'checks')
    await openPane($, b.id)
    return
  }
  if (p.step === 'structure') return structure($, rm, b, p)
  if (p.target && p.target.type === 'document') {
    const x = b.exceptions.find(e => sameTarget(p.target, e.target))
    return decideDocument($, rm, b, p.target, p.decision, x?.title ?? p.about)
  }
  if (p.decision === 'confirm' && p.card) return confirmCard($, rm, b, p.card)
  if (p.decision === 'dispute' && p.card) {
    const rows = b.attention.filter(a => a.card === p.card)
    if (rows.length === 1 && rows[0]) return disputeOne($, rm, b, rows[0])
    await update($, picking, () => p.card)
    return
  }
  if (p.decision === 'acknowledge') {
    const a = b.attention.find(x => x.card === p.card)
    if (a) return acknowledge($, rm, b, a)
  }
}

// the review page: the same deal in a browser, read-only (decisions belong in the pane, under the RM's name)
async function makeLink($: Engine, id: string): Promise<void> {
  const server = await findServer($)
  if (!server) return
  try {
    const out = await ask($, server.name, 'review_link', { opportunity_id: id, actor: 'RM', read_only_link: true })
    await update($, link, () => String(out.url))
  } catch (err) {
    await update($, note, () => `No link: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function backToDeals($: Engine): Promise<void> {
  await update($, board, () => null)
  await update($, selected, () => null)
  await update($, step, () => null)
  await update($, link, () => null)
  await loadDeals($)
}

// ------------------------------------------------------------------ drawing

// A page in the pane itself: the terminal draws the PNG, the other surfaces an SVG that holds the JPEG.
// Nothing here is markup from the server: the picture is base64 the server drew.
function shot($: Engine, e: any, pic: Picture | undefined, name: string, columns: number) {
  if (!pic || pic.error) {
    if (!pic?.error) return null
    const { Text } = $.ui.resolve(e)
    return (
      <Text key={`pic-${name}`} color="warning">
        The page could not be drawn here: {pic.error}
      </Text>
    )
  }
  if (e.surface === 'terminal') {
    if (pic.format !== 'png') return null
    const { Image } = $.ui.resolve(e) as any
    const rows = Math.max(4, Math.min(40, Math.round((columns * pic.height) / pic.width / 2)))
    return <Image key={`pic-${name}`} source={{ png: pic.data }} columns={columns} rows={rows} alt={pic.caption} />
  }
  if (pic.format !== 'jpeg') return null
  const { Svg } = $.ui.resolve(e) as any
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pic.width} ${pic.height}"><image href="data:image/jpeg;base64,${pic.data}" width="${pic.width}" height="${pic.height}"/></svg>`
  // no width: the surface draws the picture at its own width, up to the pane's
  return <Svg key={`pic-${name}`} source={source} alt={pic.caption} />
}

async function documentPager($: Engine, e: any, b: Board, docId: string, title: string, columns: number) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const n = (await read($, page))[docId] ?? 1
  const pic = (await read($, pictures))[`doc|${docId}|${n}`]
  const total = pic?.pages ?? 1
  const go = async (to: number) => {
    await update($, page, all => ({ ...all, [docId]: to }))
    const server = await findServer($)
    if (server) await loadPictures($, server.name, b).catch(() => undefined)
  }
  return (
    <Box key={`pager-${docId}`} flexDirection="column">
      {shot($, e, pic, `doc-${docId}`, columns)}
      {pic && !pic.error ? (
        <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
          <Text dimColor>
            Page {n} of {total}
          </Text>
          {n > 1 ? <Button key={`prev-${docId}`} label="Previous page" onPress={() => go(n - 1)} /> : null}
          {n < total ? <Button key={`next-${docId}`} label="Next page" onPress={() => go(n + 1)} /> : null}
          <Button
            key={`larger-doc-${docId}`}
            label="Larger"
            onPress={() => openLarge($, { kind: 'doc', opportunityId: b.id, title, docId, runId: '', ref: '', refs: [], page: n, pages: total })}
          />
        </Box>
      ) : pic ? null : (
        <Text dimColor>Loading the page of {title}…</Text>
      )}
    </Box>
  )
}

async function toggleCloseup($: Engine, b: Board, ref: string): Promise<void> {
  await update($, closeup, v => (v === ref ? null : ref))
  const server = await findServer($)
  if (server) await loadPictures($, server.name, b).catch(() => undefined)
}

// The Page pane: one page large, in strips, with a pager for a document; Esc or Close shuts it.
async function drawPagePane($: Engine, e: any) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const L = await read($, large)
  if (!L) return <Text dimColor>Nothing to show. Press "Larger" under a page in the pre-screen pane.</Text>
  const s = await read($, strips)
  const list = Object.keys(s)
    .sort((a, b) => Number(a) - Number(b))
    .map(k => s[k])
  const go = async (to: number) => {
    await update($, large, v => (v ? { ...v, page: to } : v))
    await update($, strips, () => ({}))
    await loadLarge($)
  }
  return (
    <Box flexDirection="column">
      <Text bold>
        {L.title}, page {L.page}
        {L.kind === 'doc' ? ` of ${L.pages}` : ''}
      </Text>
      <Text dimColor>{`${L.kind === 'card' ? 'The figures are outlined. ' : ''}Expand this pane for the largest view; Esc closes it.`}</Text>
      <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
        {L.kind === 'doc' && L.page > 1 ? <Button key="page-prev" label="Previous page" onPress={() => go(L.page - 1)} /> : null}
        {L.kind === 'doc' && L.page < L.pages ? <Button key="page-next" label="Next page" onPress={() => go(L.page + 1)} /> : null}
        <Button key="page-close" label="Close" onPress={() => $.ui.close({ id: PAGE_PANE })} />
      </Box>
      {list.length ? list.map((p, i) => shot($, e, p, `strip-${i}`, 90)) : <Text dimColor>Loading the page…</Text>}
    </Box>
  )
}

async function viewChecks($: Engine, e: any, rm: string, b: Board, columns: number) {
  const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e)
  const pics = await read($, pictures)
  const pickingCard = await read($, picking)
  const typed = await read($, reasons)
  const near = await read($, closeup)
  const out: any[] = []
  const props = (card: string) => b.proposals.filter(p => p.card === card && p.kind === 'decision')

  for (const [i, x] of b.exceptions.entries()) {
    const buttons = props(`doc:${x.documentId}`)
    out.push(
      <Box key={`exc-${i}`} flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} marginTop={1}>
        <Text bold>{x.title}</Text>
        <Text dimColor>{[x.item ? `candidate for ${x.item}` : '', ...x.reasons].filter(Boolean).join('; ')}</Text>
        {x.suggestion ? (
          <Text color="suggestion">
            Claude suggests: {x.suggestion.decision === 'reject' ? 'leave it out' : 'accept it'}. {x.suggestion.why}
          </Text>
        ) : null}
        {await documentPager($, e, b, x.documentId, x.title, columns)}
        <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
          {(buttons.length
            ? buttons
            : x.options.map(opt => ({ id: `${x.documentId}:${opt}`, decision: opt, label: opt === 'accept' ? 'Accept this document' : 'Leave it out', suggested: x.suggestion?.decision === opt }))
          ).map(p => (
            <Button
              key={`exc-${i}-${p.decision}`}
              label={p.label}
              variant={p.suggested || (!x.suggestion && p.decision === 'accept') ? 'primary' : 'secondary'}
              onPress={() => decideDocument($, rm, b, x.target, p.decision, x.title)}
            />
          ))}
        </Box>
      </Box>,
    )
  }

  for (const [i, { card, rows }] of cardsOf(b).entries()) {
    const first = rows[0]
    if (!first) continue
    if (first.kind === 'field') {
      const several = rows.length > 1
      const pic = b.run ? pics[`card|${b.run.id}|${card}`] : undefined
      out.push(
        <Box key={`card-${i}`} flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} marginTop={1}>
          <Text bold>
            {several ? `${first.document}, page ${first.page}: ${rows.length} hand-written figures` : `${first.ref} = ${figure(first.value)}`}
          </Text>
          {first.blocking ? null : <Text dimColor>IDP read this at low confidence; nothing uses it, so it is shown, not asked.</Text>}
          {several ? <Text dimColor>Press a figure to see it up close on the page.</Text> : null}
          {rows.map((a, j) =>
            several ? (
              <Box key={`figrow-${i}-${j}`} flexDirection="column">
                <Button key={`fig-${i}-${j}`} plain onPress={() => toggleCloseup($, b, a.ref)}>
                  {`${near === a.ref ? '▾ ' : '▸ '}${field(a.ref)}: ${figure(a.value)}`}
                  {a.confidence !== null && a.confidence < 0.95 ? <Text dimColor>{` (confidence ${a.confidence.toFixed(2)})`}</Text> : ''}
                </Button>
                {near === a.ref && b.run ? shot($, e, pics[`zoom|${b.run.id}|${a.ref}`], `zoom-${i}-${j}`, columns) : null}
                {near === a.ref && b.run && !pics[`zoom|${b.run.id}|${a.ref}`] ? <Text dimColor>Loading the close-up…</Text> : null}
              </Box>
            ) : (
              <Text key={`fig-${i}-${j}`} dimColor>
                {`read as "${a.words}"`}
                {a.confidence !== null && a.confidence < 0.95 ? ` (confidence ${a.confidence.toFixed(2)})` : ''}
                {a.usedBy.length ? `; used by ${a.usedBy.join(', ')}` : ''}
              </Text>
            ),
          )}
          {shot($, e, pic, `card-${i}`, columns)}
          {pic && !pic.error ? <Text dimColor>{pic.caption}</Text> : pic ? null : <Text dimColor>Loading the page…</Text>}
          {pic && !pic.error && b.run ? (
            <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
              <Button
                key={`larger-card-${i}`}
                label="Larger"
                onPress={() =>
                  openLarge($, { kind: 'card', opportunityId: b.id, title: first.document, docId: '', runId: b.run?.id ?? '', ref: first.ref, refs: rows.map(r => r.ref), page: first.page, pages: 1 })
                }
              />
            </Box>
          ) : null}
          {first.blocking && first.target ? (
            <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
              <Button key={`card-${i}-confirm`} label={several ? 'All match the page' : `The page shows ${figure(first.value)}`} variant="primary" onPress={() => confirmCard($, rm, b, card)} />
              <Button
                key={`card-${i}-dispute`}
                label={several ? 'One is wrong…' : 'It shows something else'}
                onPress={() => (several ? update($, picking, () => card) : disputeOne($, rm, b, first))}
              />
            </Box>
          ) : null}
          {pickingCard === card ? (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text>Which figure is wrong?</Text>
              {rows.map((a, j) => (
                <Button key={`wrong-${i}-${j}`} label={`${field(a.ref)}: ${figure(a.value)} is wrong`} onPress={() => disputeOne($, rm, b, a)} />
              ))}
              <Button key={`wrong-${i}-none`} label="None, go back" onPress={() => update($, picking, () => null)} />
            </Box>
          ) : null}
        </Box>,
      )
    } else {
      out.push(
        <Box key={`card-${i}`} flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} marginTop={1}>
          <Text bold>{first.name}</Text>
          <Text dimColor>{[first.status, first.text].filter(Boolean).join(': ')}</Text>
          {first.sides.map((sd, j) => (
            <Box key={`side-${i}-${j}`} flexDirection="column">
              <Text>{sd.line}</Text>
              {sd.ref && b.run ? shot($, e, pics[`side|${b.run.id}|${sd.ref}`], `side-${i}-${j}`, columns) : null}
            </Box>
          ))}
          {first.target ? (
            <Box flexDirection="column">
              <Input
                key={`why-${i}`}
                label="Why the deal goes on"
                placeholder="recorded with the decision"
                value={typed[card] ?? ''}
                onInput={(v: string) => update($, reasons, all => ({ ...all, [card]: v }))}
                onSubmit={(v: string) => update($, reasons, all => ({ ...all, [card]: v }))}
              />
              <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
                <Button key={`card-${i}-ack`} label="Go on, noted" variant="primary" onPress={() => acknowledge($, rm, b, first)} />
              </Box>
            </Box>
          ) : (
            <Text dimColor>This waits on IDP's own screen, not on a button here.</Text>
          )}
        </Box>,
      )
    }
  }

  if (b.run) out.push(<Markdown key="checks" text={`**Cross-checks: ${b.run.counts}; review ${plain(b.run.review)}**\n\n${checksTable(b)}`} />)
  if (b.notes.length) {
    const open = await read($, showNotes)
    out.push(
      <Box key="notes" flexDirection="column" marginTop={1}>
        <Text dimColor>{`${b.notes.length} figure(s) in use have no position: IDP could not find them in the page text. Noted, not asked.`}</Text>
        {open ? b.notes.map((n, j) => <Text key={`fn-${j}`} dimColor>{`· ${n}`}</Text>) : null}
        <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
          <Button key="notes-toggle" label={open ? 'Hide the list' : 'Show which'} onPress={() => update($, showNotes, v => !v)} />
        </Box>
      </Box>,
    )
  }
  if (!b.run && !out.length) out.push(<Text key="none" dimColor>IDP has not read the documents yet.</Text>)
  return out
}

async function viewStep($: Engine, e: any, rm: string, b: Board, shown: string, columns: number) {
  const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e)
  if (shown === 'opportunity') {
    return [
      <Text key="who">Borrower: {b.borrower}</Text>,
      <Text key="req">Request: {b.request}</Text>,
      <Text key="own">Owners: {b.owners.join(', ') || 'not on record'}</Text>,
    ]
  }
  if (shown === 'documents') {
    const open = await read($, viewing)
    const doc = b.documents.find(d => d.id === open)
    const openDoc = async (id: string | null) => {
      await update($, viewing, () => id)
      const server = await findServer($)
      if (server) await loadPictures($, server.name, b).catch(() => undefined)
    }
    const row = (d: { id: string; title: string; status: string; notes: string[] }, label: string) => (
      <Box key={`doc-${d.id}`} flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
        <Button key={`open-${d.id}`} label={d.id === open ? 'Showing' : 'Open'} variant={d.id === open ? 'primary' : 'secondary'} onPress={() => openDoc(d.id)} />
        <Text>
          {label} <Text dimColor>{[d.status, d.title, ...d.notes].filter(Boolean).join(' · ')}</Text>
        </Text>
      </Box>
    )
    const listed = new Set<string>()
    const rows: any[] = []
    for (const c of b.checklist) {
      const d = b.documents.find(x => x.id === c.documentId)
      if (d) {
        listed.add(d.id)
        rows.push(row(d, c.label))
      } else rows.push(<Text key={`miss-${c.label}`} dimColor>{`${c.label}: ${c.status}`}</Text>)
    }
    const others = b.documents.filter(d => !listed.has(d.id))
    return [
      doc ? (
        <Box key="viewer" flexDirection="column" borderStyle="round" paddingX={1} paddingY={1} marginTop={1}>
          <Text bold>{doc.title}</Text>
          {await documentPager($, e, b, doc.id, doc.title, columns)}
          <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
            <Button key="close-doc" label="Close" onPress={() => openDoc(null)} />
          </Box>
        </Box>
      ) : null,
      <Text key="list-head" bold>{'\n'}Checklist: {b.summary}</Text>,
      ...rows,
      others.length ? <Text key="others-head" bold>{'\n'}Other documents received</Text> : null,
      ...others.map(d => row(d, d.item || 'not on the checklist')),
    ]
  }
  if (shown === 'checks') return viewChecks($, e, rm, b, columns)
  if (shown === 'policy_fit') {
    return [
      b.metrics.length ? <Markdown key="metrics" text={b.metrics.map(x => `- ${x}`).join('\n')} /> : <Text key="nometrics" dimColor>The numbers have not been run.</Text>,
      b.fit ? <Markdown key="fit" text={`**Policy fit (${plain(b.fit.version)}): ${plain(b.fit.text)}**\n\n${fitTable(b)}`} /> : null,
    ]
  }
  if (shown === 'structure') {
    const typed = (await read($, reasons)).structure ?? ''
    const offered = b.proposals.filter(p => p.step === 'structure' && p.kind === 'decision')
    return [
      b.fit?.oneLine ? <Text key="line" bold>{b.fit.oneLine}</Text> : <Text key="noline" dimColor>The structure appears once the policy fit has run.</Text>,
      b.fit ? <Markdown key="terms" text={b.fit.structure.map(x => `- ${plain(x)}`).join('\n')} /> : null,
      offered.length ? (
        <Box key="decide" flexDirection="column">
          <Input
            key="why-structure"
            label="If you send it back, say why"
            value={typed}
            onInput={(v: string) => update($, reasons, all => ({ ...all, structure: v }))}
            onSubmit={(v: string) => update($, reasons, all => ({ ...all, structure: v }))}
          />
          <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
            {offered.map(p => (
              <Button key={`structure-${p.decision}`} label={p.label} variant={p.decision === 'confirm' ? 'primary' : 'secondary'} onPress={() => structure($, rm, b, p)} />
            ))}
          </Box>
        </Box>
      ) : (
        <Text key="notyet" dimColor>Approval opens once the review is clear and the numbers were presented on it.</Text>
      ),
    ]
  }
  const memo = b.steps.find(s => s.key === 'memo')
  return [<Text key="memo">{memo?.headline ?? 'Not drafted'}</Text>]
}

async function drawPane($: Engine, e: any, rm: string) {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const url = await read($, link)
  const columns = Math.max(20, Math.min(Number(e.props?.bodyColumns) || 60, 90) - 4)
  const b = await read($, board)
  const id = await read($, selected)
  const message = await read($, note)

  if (!b || !id) {
    const list = await read($, deals)
    return (
      <Box flexDirection="column">
        <Text bold>Deals</Text>
        {message ? <Text color="warning">{message}</Text> : null}
        {list.length === 0 && !message ? <Text dimColor>No deal yet. Ask the assistant to start a pre-screen.</Text> : null}
        {list.map(d => (
          <Button key={`deal-${d.id}`} plain onPress={() => load($, d.id)}>
            {d.borrower} <Text dimColor>{d.summary}</Text>
          </Button>
        ))}
        <Button key="reload-deals" label="Refresh" onPress={() => loadDeals($)} />
      </Box>
    )
  }

  const shown = await shownStep($, b)
  const cur = b.steps.find(s => s.key === shown)
  const work = b.proposals.filter(p => p.kind === 'prompt' && p.step === shown)
  return (
    <Box flexDirection="column">
      <Text bold>{b.borrower}</Text>
      <Text dimColor>{b.request}</Text>
      {message ? <Text color="warning">{message}</Text> : null}
      {!b.hasScreens || !b.steps.length ? (
        <Text color="warning">The pre-screen service is older than this plugin (it needs 0.4.0): the steps, the buttons above the prompt and the figures to confirm appear once it is updated. The documents and their questions are below.</Text>
      ) : null}
      <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
        {b.steps.map(s => (
          <Button
            key={`step-${s.key}`}
            label={`${s.state === 'done' ? '✓ ' : s.state === 'running' ? '… ' : s.state === 'blocked' ? '! ' : ''}${s.n} ${s.label}`}
            variant={s.key === shown ? 'primary' : 'secondary'}
            onPress={async () => {
              await update($, step, () => s.key)
              const server = await findServer($)
              if (server) await loadPictures($, server.name, b).catch(() => undefined)
            }}
          />
        ))}
      </Box>
      {cur ? (
        <Text bold>{'\n'}
          Step {cur.n} · {cur.label}: {cur.headline}
        </Text>
      ) : null}
      {b.running.map((r, i) => (
        <Text key={`run-${i}`} color="suggestion">
          {r}
        </Text>
      ))}
      {await viewStep($, e, rm, b, shown, columns)}
      {work.length ? (
        <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
          {work.map(p => (
            <Button key={`work-${p.id}`} label={p.label} variant="primary" onPress={() => act($, rm, p)} />
          ))}
        </Box>
      ) : null}
      {url ? <Link key="review-url" href={url} label="Open the review page (the same deal, every page)" /> : null}
      <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
        <Button key="documents" label="Documents" onPress={() => update($, step, () => 'documents')} />
        <Button key="refresh" label="Refresh" onPress={() => load($, b.id)} />
        <Button key="review-link" label="Review page link" onPress={() => makeLink($, b.id)} />
        <Button key="follow" label="Open step" onPress={() => update($, step, () => null)} />
        <Button key="deals" label="All deals" onPress={() => backToDeals($)} />
      </Box>
      <Text dimColor>Read {b.loadedAt}. Nothing is sent to anyone.</Text>
    </Box>
  )
}

// What the pane shows when its full drawing failed on this surface: the deal and the way back.
async function drawPlain($: Engine, e: any) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const b = await read($, board)
  return (
    <Box flexDirection="column">
      <Text bold>{b ? b.borrower : 'Pre-screen'}</Text>
      <Text dimColor>The pane could not be drawn here in full. The review page shows the same deal.</Text>
      {b ? <Button key="plain-link" label="Review page link" onPress={() => makeLink($, b.id)} /> : null}
    </Box>
  )
}

// The reply buttons above the prompt: the open step's proposals, three at most.
async function drawBand($: Engine, e: any, rm: string, next: (e: any) => any) {
  if (e.props?.hasSurvey) return next(e)
  const b = await read($, board)
  if (!b || !b.hasScreens || !b.proposals.length) return next(e)
  const isPlaced = await read($, placed)
  const shown = await shownStep($, b)
  const out: Proposal[] = []
  const covered = new Set<string>()
  for (const p of b.proposals) {
    if (p.kind === 'prompt') {
      if (!e.props?.isWorking) out.push(p)
      continue
    }
    const seen = isPlaced && shown === p.step
    if (p.kind === 'show') {
      if (!seen && !covered.has(p.card)) {
        out.push(p)
        covered.add(p.card)
      }
      continue
    }
    // a decision is pressed where the document is seen
    if (seen && !p.needsReason && !p.pickOne) out.push(p)
    else if (!seen && !covered.has(p.card)) {
      out.push({ ...p, kind: 'show', label: `Show me ${short(p.about) || 'it'}`, id: `show:${p.card || p.id}` })
      covered.add(p.card)
    }
  }
  const shownNow = out.slice(0, 3)
  if (!shownNow.length) return next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  const checkpoint = shownNow.some(p => p.kind !== 'prompt')
  return (
    <Box>
      <Text dimColor>{checkpoint ? 'RM checkpoint ' : 'Next '}</Text>
      {shownNow.map(p => (
        <Button key={`band-${p.id}`} label={p.label} variant={p.suggested || p.kind === 'prompt' ? 'primary' : 'secondary'} onPress={() => act($, rm, p)} />
      ))}
    </Box>
  )
}

async function openPane($: Engine, deal: string): Promise<string> {
  await loadDeals($)
  const want = deal.trim().toLowerCase()
  const list = await read($, deals)
  const hit = want ? list.find(d => d.borrower.toLowerCase().includes(want) || d.id === want) : undefined
  const current = hit?.id ?? (await read($, selected)) ?? (list.length === 1 ? list[0]?.id : undefined)
  const b = current ? await load($, current) : null
  const opened = await $.ui.open({ id: PANE, title: 'Pre-screen' })
  await update($, placed, () => opened.isPlaced)
  if (!opened.isPlaced) {
    // no place for a pane here (a narrow terminal, another harness): the review page is the same screen
    const server = await findServer($)
    if (b && server) {
      const out = await ask($, server.name, 'review_link', { opportunity_id: b.id, actor: 'RM', read_only_link: true }).catch(() => null)
      if (out?.url) return `This window has no place for the pre-screen pane. The same screen, read-only, is the review page: ${out.url}`
    }
    return 'The pre-screen pane is ready but this window has no place to show it (it needs a surface that docks panes).'
  }
  if (!b) return current ? 'Pre-screen pane opened, but the deal could not be read; the pane says why.' : 'Pre-screen pane opened. Pick a deal in it.'
  const now = b.steps.find(s => s.key === b.stage)
  return `Pre-screen pane opened for ${b.borrower}.` + (now ? ` Step ${now.n}, ${now.label}: ${now.headline}.` : '')
}

export const register: Register = (on, options) => {
  const rm = typeof options.rm_name === 'string' ? options.rm_name.trim() : ''

  on('session.start', async ($, e, next) => {
    firstSurface = String((e as unknown as Json).surface ?? '')
    openedOnce = false
    await $.command.register({
      name: 'prescreen',
      description: 'Open the pre-screen pane: the steps of a deal, what waits for you, and the buttons to decide',
    })
    // the same thing as a tool, so "show me the pane" in plain words opens it too
    await $.tool.register({
      name: 'open_pane',
      description:
        'Open the pre-screen side pane for the RM: the six steps of the deal, the documents and figures waiting for the RM with their pages and decision buttons, the cross-checks, the numbers and the structure. Call this whenever the RM asks to see, show or open the pane, the checklist, the documents to check, or the details of a deal. It draws from the server; you do not pass any figures.',
      inputSchema: {
        type: 'object',
        properties: { deal: { type: 'string', description: 'Borrower name or opportunity id; leave out for the deal in hand' } },
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('command.run', { command: 'prescreen' }, async ($, e) => ({ text: await openPane($, e.args) }))

  // ---------------------------------------------------------------- the guard on the model's calls, and chat to pane
  on('tool.call', async ($, e, next) => {
    const m = TOOL.exec(String(e.tool))
    if (!m) return next(e)
    const tool = m[1] ?? ''
    const args = e as unknown as Json
    const id = typeof args.opportunity_id === 'string' ? args.opportunity_id : ''

    // the mod's own tool: answered here (an older Claude Code has no tool.run event)
    if (tool === 'open_pane') return { result: await openPane($, String(args.deal ?? '')) }

    if (tool === 'run_checks' && args.force_new === true) {
      return { deny: 'prescreen: force_new uploads the dossier to IDP a second time. The RM starts that, not the assistant: leave force_new out.' }
    }
    if (tool === 'record_decision' && id) {
      const kind = args.target?.type
      if (kind === 'document' || kind === 'field') {
        const now = await load($, id)
        if (!now) {
          return { deny: 'prescreen: the deal could not be read, so the decision was not checked and nothing was recorded. Try again in a moment.' }
        }
        {
          const offers = [
            ...now.exceptions.map(x => ({ target: x.target, options: x.options, value: null as number | string | null })),
            ...(now.run?.pending ?? []).map(p => ({ target: p.target, options: ['confirm', 'dispute'], value: p.value })),
            // a document already accepted or rejected may be decided again: that is how a slip is undone
            ...now.candidates.map(document_id => ({ target: { type: 'document', document_id } as Target, options: ['accept', 'reject'], value: null })),
          ]
          const offer = offers.find(o => sameTarget(args.target, o.target))
          if (!offer && (kind === 'document' || now.hasScreens)) {
            return { deny: 'prescreen: that decision_target is not one the server is offering now. Read opportunity_status (or the check run) again and copy the target exactly; do not build one.' }
          }
          if (offer && !offer.options.includes(String(args.decision))) {
            return { deny: `prescreen: this target takes ${offer.options.join(' or ')}, not ${String(args.decision)}.` }
          }
          if (offer && kind === 'field' && args.decision === 'confirm' && Number(args.value) !== Number(offer.value)) {
            return { deny: `prescreen: the figure on record is ${figure(offer.value)}. Confirm that figure, after the RM saw it on its page, or dispute it.` }
          }
        }
      }
    }
    // decisions and changes are recorded under the RM's configured name, whatever the model typed
    const input = rm && SETS_ACTOR.has(tool) && args.actor !== rm ? ({ ...e, actor: rm } as typeof e) : e
    const ran = await next(input)

    // chat to pane (D3): the pane moves to the step this tool belongs to, and opens by itself once
    if (ran.deny === undefined && id) {
      const to = TOOL_STEP[tool]
      if (to) await update($, step, () => to)
      if (!openedOnce) {
        openedOnce = true
        await openPane($, id).catch(() => undefined)
      } else {
        await load($, id)
      }
    }
    return ran
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    // a guard that broke must not wave a decision through
    return /__(record_decision|run_checks)$/.test(String(e.tool)) && TOOL.test(String(e.tool))
      ? { deny: 'prescreen: the decision guard failed, so nothing was recorded. Try again, or use the pane (/prescreen).' }
      : next(e)
  })

  // ---------------------------------------------------------------- pane to chat (D4): the lines go with the next prompt
  on('prompt.submit', async ($, e, next) => {
    // a slash command (/prescreen, /clear) is not a prompt the model reads: the lines wait for one that is
    if (e.command) return next(e)
    const lines = await read($, outbox)
    if (!lines.length) return next(e)
    await update($, outbox, () => [])
    return next({ ...e, context: [...(e.context ?? []), lines.join('\n')] })
  }).catch(($, e, next) => (next.called ? next(e) : next(e)))

  on('turn.complete', async ($, e, next) => {
    const id = await read($, selected)
    if (id) await load($, id).catch(() => undefined)
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    const id = (e as unknown as Json).id
    if (id === PANE) await update($, placed, () => false)
    if (id === PAGE_PANE) await update($, strips, () => ({}))
    return next(e)
  })

  // ---------------------------------------------------------------- the pane and the band
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawPane($, e, rm)).catch(($, e) => drawPlain($, e))
  on('ui.render', { component: 'Pane', requestId: PAGE_PANE }, ($, e) => drawPagePane($, e)).catch(($, e) => drawPlain($, e))
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => drawBand($, e, rm, next)).catch(($, e, next) => next(e))
}

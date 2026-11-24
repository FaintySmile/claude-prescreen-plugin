// What the pane keeps between drawings. Declared here so `claude plugin validate` holds every
// `$.state` key the hooks module names to this contract.

export type Target = Record<string, string>

// one of the server's six steps (workbench `steps[]`)
export type Step = { key: string; n: number; label: string; state: string; headline: string; waiting: number }

// a button the server offers for the open step (workbench `proposals[]`)
export type Proposal = {
  id: string
  step: string
  kind: 'prompt' | 'decision' | 'show'
  label: string
  // prompt: the fixed sentence the button sends
  text: string
  // decision: one target, or none when the card's attention entries are the targets
  target: Target | null
  decision: string
  card: string
  count: number
  pickOne: boolean
  needsReason: boolean
  // the reason the server gives with the decision (the structure in one line)
  reason: string
  about: string
  suggested: boolean
}

export type ChecklistRow = { label: string; status: string; document: string; documentId: string }
export type DocumentRow = { id: string; title: string; status: string; item: string; notes: string[] }
export type ExceptionRow = {
  title: string
  item: string
  reasons: string[]
  target: Target
  options: string[]
  documentId: string
  suggestion: null | { decision: string; why: string }
}
// one entry of the server's attention list: a field, an IDP rule, a document IDP held back
export type AttentionRow = {
  card: string
  kind: string
  reason: string
  blocking: boolean
  ref: string
  value: number | string | null
  document: string
  page: number
  hasPosition: boolean
  confidence: number | null
  words: string
  usedBy: string[]
  name: string
  status: string
  text: string
  sides: { ref: string; line: string }[]
  target: Target | null
  options: string[]
}
export type PendingRow = { ref: string; value: number | string | null; target: Target }
export type CheckRow = { id: string; title: string; status: string; note: string }
export type FitRow = { section: string; rule: string; limit: string; value: string; status: string }

export type Board = {
  id: string
  borrower: string
  request: string
  owners: string[]
  summary: string
  isComplete: boolean
  // false when the server is older than this plugin: no checks, numbers, steps or pictures
  hasScreens: boolean
  steps: Step[]
  stage: string | null
  proposals: Proposal[]
  checklist: ChecklistRow[]
  documents: DocumentRow[]
  // documents the RM may decide (again): checklist candidates
  candidates: string[]
  exceptions: ExceptionRow[]
  attention: AttentionRow[]
  notes: string[]
  running: string[]
  run: null | {
    id: string
    counts: string
    review: string
    checks: CheckRow[]
    pending: PendingRow[]
  }
  fit: null | { version: string; text: string; rules: FitRow[]; structure: string[]; oneLine: string }
  metrics: string[]
  loadedAt: string
}

// a small copy of a page (base64), for the pane
// error: why the page could not be had ('' when it was): shown in the pane, never swallowed
export type Picture = { format: 'png' | 'jpeg'; data: string; width: number; height: number; pages: number; caption: string; error: string }

export type Deal = { id: string; borrower: string; summary: string }

// what the Page pane shows: a document's page, or the page of a card with its figures outlined
export type Large = {
  kind: 'doc' | 'card'
  opportunityId: string
  title: string
  docId: string
  runId: string
  ref: string
  refs: string[]
  page: number
  pages: number
}

declare module 'claude-code' {
  interface PluginState {
    prescreen: {
      selected: string | null
      board: Shaped<Board | null>
      deals: Shaped<Deal[]>
      note: string
      pictures: Shaped<Record<string, Picture>>
      // the step the pane shows; null follows the server's stage
      step: string | null
      // whether a surface draws the pane now
      placed: boolean
      // lines for the model about what the RM decided in the pane, sent with the next prompt
      outbox: Shaped<string[]>
      // the page shown per document
      page: Shaped<Record<string, number>>
      // the document opened in step 2
      viewing: string | null
      // the card whose "One is wrong" was pressed: its figures get a button each
      picking: string | null
      // what the RM typed as a reason, per card
      reasons: Shaped<Record<string, string>>
      // the read-only review page for this deal, once asked for
      link: string | null
      // whether the list of figures with no position is open
      showNotes: boolean
      // the figure shown up close under its card
      closeup: string | null
      // what the Page pane shows, and its strips (key: the strip's place, from 0)
      large: Shaped<Large | null>
      strips: Shaped<Record<string, Picture>>
    }
  }
}

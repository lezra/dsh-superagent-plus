// @vitest-environment jsdom
import { act, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, caller, usePoll } from '../src/client/api.ts'
import { apply } from '../src/client/index.tsx'
import { zh } from '../src/client/locales.ts'
import { SettingsSchema } from '../src/policy.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Entry = { options: { name: string; id?: string; key?: string; order?: number; locale?: string; label?: () => string }; component: ComponentType<Record<string, unknown>> }
const t = ((key: keyof typeof zh) => zh[key] ?? key) as never
function fixture(listed: string[]) {
  const entries: Entry[] = []
  const dictionaries: Record<string, unknown> = {}
  const ctx = {
    slots: { inject: (_name: string, register: () => void) => register(), register: (options: Entry['options'], component: Entry['component']) => { entries.push({ options, component }); return () => {} } },
    locale: { register: (ns: string, value: unknown) => { dictionaries[ns] = value; return () => {} }, bind: () => t },
    effect: (effect: () => unknown) => { effect() },
    sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: Object.fromEntries(listed.map(id => [id, {}])) }) }, refresh: vi.fn(async () => {}) },
    uiWorkspace: { openSession: vi.fn() },
    // Omit config form service so Deployment renders read-only.
    get: () => undefined,
  }
  apply(ctx as never)
  const entry = (name: string) => entries.find(item => item.options.name === name)!
  return { ctx, entries, dictionaries, main: entry('main'), nav: entry('sidebar.panellist') }
}
async function render(entry: Entry, props: Record<string, unknown>) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(<entry.component {...props} />) })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return { container, dispose: () => { act(() => { root.unmount() }); container.remove() } }
}
const openMaster = async (container: HTMLElement) => {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === zh.openMaster)!
  await act(async () => { button.click() })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
const serve = (openTickets: unknown[] = [], endedTickets: unknown[] = []) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  const parsed = new URL(url, 'http://127.0.0.1')
  const path = parsed.pathname.replace('/orchestrator/api/', '')
  // The board polls Tickets, Sources and settings beside the overview and state every other view uses.
  if (path === 'tickets') {
    const items = parsed.searchParams.get('state') === 'ended' ? endedTickets : openTickets
    return Response.json({ items, total: items.length, next_offset: null })
  }
  if (path === 'sources') return Response.json([])
  if (path === 'agents') return Response.json({ profiles: [], groups: [] })
  if (path === 'settings') return Response.json({ policyVersion: 'v', sources: [], environment: { root: '', variables: [] },
    blocks: { policy: { value: { rules: [], sources: {} }, revision: 0 },
      eval: { value: { mode: 'observe', timeoutSeconds: 120, model: null }, revision: 0 },
      executor: { value: { model: null, maxWorkers: 3, directory: '', prepare: '', blockedCommands: [] }, revision: 0 } } })
  if (path === 'overview') return Response.json({ problems: [], person: [], executor: { running: 0, queued: 0, maxWorkers: 3, idle: 0 }, flow: { triggers: 0, filtered: 0, judged: 0, accepted: 0, evaluating: 0 }, policyVersion: 'v' })
  if (path === 'state') return Response.json({ masterId: 'master', settings: SettingsSchema.parse({}), revisions: { policy: 0, eval: 0, executor: 0 }, sources: [], policy_version: 'v', health: {}, outgoing: [], load: { running: 0, queued: 0 },
    setup: { machine: { stateDir: '/srv/state', worktreeRoot: '/srv/state/worktrees', blockedCommands: [], promptMaxChars: 100000, admissionContextMaxPages: 10, admissionContextTimeoutMs: 15000 }, problem: null, feishuProblem: null, accounts: null } })
  return Response.json({ error: 'unavailable' }, { status: 503 })
}))
afterEach(() => { vi.unstubAllGlobals() })

it('registers a localized main panel, sidebar entry and Plugin Manager row page, and no settings section', () => {
  const { entries, dictionaries, main, nav } = fixture([])
  expect(entries.map(entry => entry.options.name)).toEqual(['main', 'sidebar.panellist', 'plugins.row.config'])
  expect(entries[2]!.options).toMatchObject({ key: 'dsh-superagent-plus#dsh-superagent-plus', locale: 'dshSuperagent' })
  expect(Object.keys(dictionaries)).toEqual(['dshSuperagent'])
  expect(main.options).toMatchObject({ key: 'dsh-superagent-plus', locale: 'dshSuperagent' })
  expect(nav.options).toMatchObject({ id: 'dsh-superagent-plus', order: 10, locale: 'dshSuperagent' })
  expect(nav.options.label?.()).toBe('Superagent')
})

it('opens a listed Session through the workspace from the main panel', async () => {
  serve()
  const { ctx, main } = fixture(['master'])
  const view = await render(main, { t })
  await openMaster(view.container)
  expect(ctx.uiWorkspace.openSession).toHaveBeenCalledExactlyOnceWith('master')
  view.dispose()
})

it('reports a Session missing from the catalog in the interface language', async () => {
  serve()
  const { ctx, main } = fixture([])
  const view = await render(main, { t })
  await openMaster(view.container)
  expect(ctx.uiWorkspace.openSession).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain(zh.sessionNotListed)
  view.dispose()
})

it('opens on the board, groups active Tickets into lanes, and keeps recently ended Tickets below them', async () => {
  const ticket = (id: string, stage: string, extra: Record<string, unknown> = {}) => ({ id, title: `Ticket ${id}`, state: 'open', stage,
    strength: 'explicit', assignments: 1, inputs: 0, undelivered: 0, actions: { retry: false, stop: true }, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', threads: [], ...extra })
  serve([ticket('a', 'working'), ticket('b', 'person', { action: 'answer' }), ticket('c', 'working', { action: 'queued' }), ticket('d', 'idle')])
  const { main } = fixture([])
  const view = await render(main, { t })
  const selected = [...view.container.querySelectorAll('[role="tab"][aria-selected="true"]')].map(node => node.textContent)
  expect(selected).toEqual([zh['tab.board']])
  const lanes = [...view.container.querySelectorAll('.dt-lane')]
  expect(lanes.map(lane => lane.getAttribute('data-lane'))).toEqual(['queued', 'working', 'idle', 'person'])
  expect(lanes.map(lane => lane.querySelectorAll('.dt-bcard').length)).toEqual([1, 1, 1, 1])
  expect(lanes.map(lane => { const card = lane.querySelector('.dt-bcard')!; return `${card.getAttribute('data-stage')}/${card.getAttribute('data-action')}` }))
    .toEqual(['working/queued', 'working/', 'idle/', 'person/answer'])
  expect(view.container.textContent).toContain('Ticket a')
  expect(view.container.querySelector('.dt-recent')).not.toBeNull()
  view.dispose()
})

it('keeps the board readable when only ended Tickets remain', async () => {
  const ended = (id: string) => ({ id, title: `Ticket ${id}`, state: 'ended', stage: 'ended', strength: 'explicit', assignments: 1,
    inputs: 0, undelivered: 0, actions: { retry: false, stop: false }, ended: { outcome: 'done' }, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z', threads: [] })
  serve([], [ended('e')])
  const { main } = fixture([])
  const view = await render(main, { t })
  expect(view.container.querySelector('.dt-board-empty')).toBeNull()
  const recent = view.container.querySelector('.dt-recent')!
  expect(recent.querySelectorAll('.dt-ended-chip').length).toBe(1)
  expect(recent.querySelector('.dt-avatar')?.getAttribute('data-kind')).toBe('whale')
  expect(recent.querySelector('.dt-avatar-eye')?.textContent).toBe('T')
  const chip = recent.querySelector<HTMLElement>('.dt-ended-chip')!
  expect(chip.getAttribute('aria-label')).toContain('Ticket e')
  await act(async () => { chip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  expect(document.querySelector('.dt-ended-pop')?.textContent).toContain('Ticket e')
  await act(async () => { chip.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) })
  expect(document.querySelector('.dt-ended-pop')).toBeNull()
  view.dispose()
})

it('polls one request at a time, keeps the data while new dependencies load, and polls less while hidden', async () => {
  vi.useFakeTimers()
  const calls: { limit: number; done: (value: string[]) => void }[] = []
  let shown: { data?: string[]; limit: number } = { limit: 0 }
  let setLimit = (_limit: number) => {}
  function Harness() {
    const [limit, update] = useState(1)
    setLimit = update
    const { data } = usePoll(() => new Promise<string[]>(done => { calls.push({ limit, done }) }), [limit], 1000)
    shown = { ...data ? { data } : {}, limit }
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => { root.render(<Harness />) })
  expect(calls).toHaveLength(1)
  // A slow response holds the next poll back instead of overlapping.
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(calls).toHaveLength(1)
  await act(async () => { calls[0]!.done(['a']) })
  expect(shown.data).toEqual(['a'])
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(calls).toHaveLength(2)
  await act(async () => { setLimit(2) })
  expect(shown).toEqual({ data: ['a'], limit: 2 })
  await act(async () => { calls[2]!.done(['a', 'b']) })
  expect(shown.data).toEqual(['a', 'b'])
  // A late response to the superseded request must not replace the newer result.
  await act(async () => { calls[1]!.done(['stale']) })
  expect(shown.data).toEqual(['a', 'b'])
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  await act(async () => { calls[3]!.done(['a', 'b']) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(calls).toHaveLength(4)
  hidden.mockRestore()
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(calls).toHaveLength(5)
  act(() => { root.unmount() })
  vi.useRealTimers()
})

it('tells a dsh-superagent-plus that does not answer from a record it does not have, and words each failure by what failed', async () => {
  const messages = { offline: 'offline', notRunning: 'not running', serverError: (status: number) => `server ${status}`,
    requestFailed: (status: number) => `request ${status}`, setup: () => 'setup', user: ({ code }: { code: string }) => `user ${code}` }
  const call = caller(() => messages)
  const failure = async (answer: () => Promise<Response>) => {
    vi.stubGlobal('fetch', vi.fn(answer))
    const error = await call('GET tickets/:id', { id: 't1' }).then(() => undefined, (thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    const { message, status, missing, details } = error as ApiError
    return { message, status, missing, unreachable: !!details.unreachable }
  }
  expect(await failure(async () => { throw new TypeError('Failed to fetch') })).toEqual({ message: 'offline', status: 0, missing: false,
    unreachable: true })
  // DSH's web server answers an empty 404 while dsh-superagent-plus's routes are unregistered.
  expect(await failure(async () => new Response(null, { status: 404 }))).toEqual({ message: 'not running', status: 404, missing: false,
    unreachable: true })
  expect(await failure(async () => new Response(null, { status: 502 }))).toEqual({ message: 'server 502', status: 502, missing: false,
    unreachable: true })
  expect(await failure(async () => new Response('<html>Bad request</html>', { status: 400 }))).toEqual({ message: 'request 400',
    status: 400, missing: false, unreachable: false })
  expect(await failure(async () => Response.json({ error: 'Unknown ticket', code: 'unknownTicket' }, { status: 404 }))).toEqual({
    message: 'user unknownTicket', status: 404, missing: true, unreachable: false })
})

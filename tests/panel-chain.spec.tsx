// @vitest-environment jsdom
/** The Chain page: one Ticket's path from its message to its current step. */
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { click, mount, settle, tab, text, usePanel } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()

it('keeps the original run, Ticket and chain sections in that order', async () => {
  server.runs = { runs: [{ id: 'a1', number: 1, ticketId: 't1', title: '修复回归', ticketState: 'open', state: 'running',
    createdAt: '2026-11-05T01:11:00Z', startedAt: '2026-11-05T01:12:00Z', updatedAt: '2026-11-05T01:13:00Z',
    profileId: 'researcher', profileName: '研究员', avatar: { color: '#4D6BFE' }, sessionId: 'worker-t1', slot: 1,
    attachments: [] }] }
  await mount()
  await click(tab(zh['tab.chain']))
  expect(document.querySelector('.dt-run-list')).not.toBeNull()
  expect(document.querySelector('.dt-chain-list')).not.toBeNull()
  await click(document.querySelector<HTMLElement>('.dt-chain-row')!)
  await settle()
  expect(document.querySelector('.dt-graph')).not.toBeNull()
  expect(document.querySelector('.dt-chain-command')).toBeNull()
})

it('draws the original layered graph with rich node cards and one lane per Assignment', async () => {
  server.runs = { runs: [
    { id: 'a2', number: 2, ticketId: 't1', title: '修复回归', ticketState: 'open', state: 'running',
      createdAt: '2026-11-05T01:11:00Z', startedAt: '2026-11-05T01:12:00Z', updatedAt: '2026-11-05T01:13:00Z',
      profileId: 'researcher', profileName: '研究员', avatar: { color: '#4D6BFE' }, sessionId: 'worker-t1', slot: 1,
      attachments: [] },
    { id: 'a3', number: 3, ticketId: 't1', title: '修复回归', ticketState: 'open', state: 'queued',
      createdAt: '2026-11-05T01:14:00Z', updatedAt: '2026-11-05T01:14:00Z', sessionId: '', attachments: [] },
  ] }
  await mount()
  await click(tab(zh['tab.chain']))
  await click(document.querySelector<HTMLElement>('.dt-chain-row')!)
  await settle()
  expect(document.querySelector('.dt-graph')).not.toBeNull()
  expect(document.querySelectorAll('.dt-gnode-card').length).toBeGreaterThan(5)
  expect(document.querySelectorAll('.dt-gedge').length).toBeGreaterThan(5)
  expect(document.querySelector('.dt-graph')!.textContent).toContain('研究员')
})

it('traces a Ticket from its source through Eval, Decision and Executor to where it is now', async () => {
  await mount()
  await click(tab(zh['tab.chain']))
  expect(text()).toContain(zh.chainTickets)
  await click(document.querySelector<HTMLElement>('.dt-chain-row')!)
  // The track loads the Ticket's own detail after the click; wait for that request and its render.
  await settle()
  await vi.waitFor(() => { expect(document.querySelector('.dt-graph')).not.toBeNull() })
  const page = text()
  for (const label of [zh.chainSource, zh.chainEval, zh.chainDecision, zh['term.executor'], zh.chainEnd])
    expect(page).toContain(label)
  expect(page).toContain('飞书消息')
  expect(page).toContain(zh.chainAssignments.replace('{count}', '1'))
  expect(page).toContain('修复回归')
})

it('picks the clicked node and shows that node in the detail card', async () => {
  await mount()
  await click(tab(zh['tab.chain']))
  await click(document.querySelector<HTMLElement>('.dt-chain-row')!)
  await settle()
  await vi.waitFor(() => { expect(document.querySelector('.dt-graph')).not.toBeNull() })
  const node = document.querySelector<HTMLElement>('.dt-gnode-card[data-id="eval"]')!
  await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await settle()
  expect(document.querySelectorAll('.dt-gnode-card[data-picked="true"]')).toHaveLength(1)
  expect(node.getAttribute('data-picked')).toBe('true')
  expect(document.querySelector('.dt-chain-inspector')!.textContent).toContain(zh.chainEval)
})

it('shows a clicked node\u2019s duration, what it read, what it produced and its attachments', async () => {
  await mount()
  await click(tab(zh['tab.chain']))
  await click(document.querySelector<HTMLElement>('.dt-chain-row')!)
  await settle()
  await vi.waitFor(() => { expect(document.querySelector('.dt-graph')).not.toBeNull() })
  const node = document.querySelector<HTMLElement>('.dt-gnode-card[data-id="source"]')!
  await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await settle()
  const card = document.querySelector('.dt-chain-inspector')!
  for (const label of [zh.chainNodeDuration, zh.chainNodeInput, zh.chainNodeOutput, zh.chainNodeAttachments])
    expect(card.textContent).toContain(label)
  // The source message arrived two minutes before the Decision that accepted it.
  expect(card.textContent).toContain('2 分 0 秒')
  expect(card.textContent).toContain('修一下登录页回归')
  expect(card.querySelector('a[href="https://example.test/login.png"]')?.textContent).toBe('登录页')
})

it('explains a selected node as received facts, produced facts and evidence', async () => {
  await mount()
  await click(tab(zh['tab.chain']))
  await click(document.querySelector<HTMLElement>('.dt-chain-row')!)
  await settle()
  await click(document.querySelector<HTMLElement>('.dt-gnode-card[data-id="source"]')!)
  const inspector = document.querySelector('.dt-chain-inspector')!
  expect(inspector.querySelector('.dt-inspector-head')?.textContent).toContain(zh.chainSource)
  expect(inspector.querySelector('[data-section="received"]')?.textContent).toContain('修一下登录页回归')
  expect(inspector.querySelector('[data-section="produced"]')?.textContent).toContain('飞书消息')
  expect(inspector.querySelector('[data-section="evidence"]')?.textContent).toContain('登录页')
})

it('lists parallel runs and draws one lane per Assignment in the graph', async () => {
  server.runs = { runs: [
    { id: 'a2', number: 2, ticketId: 't1', title: '修复回归', ticketState: 'open', state: 'running',
      createdAt: '2026-11-05T01:11:00Z', startedAt: '2026-11-05T01:12:00Z', updatedAt: '2026-11-05T01:13:00Z',
      profileId: 'researcher', profileName: '研究员', avatar: { color: '#4D6BFE' }, sessionId: 'worker-t1', slot: 1,
      attachments: [] },
    { id: 'a3', number: 3, ticketId: 't1', title: '截图工具', ticketState: 'open', state: 'queued',
      createdAt: '2026-11-05T01:14:00Z', updatedAt: '2026-11-05T01:14:00Z', sessionId: '', attachments: [] },
  ] }
  await mount()
  await click(tab(zh['tab.chain']))
  const page = text()
  expect(page).toContain(zh.chainRuns)
  expect(page).toContain('研究员')
  expect(page).toContain(zh['runState.running'])
  expect(page).toContain(zh['runState.queued'])
  expect(page).toContain('1 号位')
  await click(document.querySelector<HTMLElement>('.dt-chain-row')!)
  await settle()
  expect(document.querySelectorAll('.dt-gnode-card').length).toBeGreaterThan(5)
})
it('keeps the chain in graph style without a separate track-list switch', async () => {
  await mount()
  await click(tab(zh['tab.chain']))
  await click(document.querySelector<HTMLElement>('.dt-chain-row')!)
  await settle()
  await vi.waitFor(() => { expect(document.querySelector('.dt-graph')).not.toBeNull() })
  expect(document.querySelector('.dt-graph')!.textContent).toContain(zh.chainSource)
  expect([...document.querySelectorAll<HTMLElement>('.dt-chain-switch button')]
    .some(button => button.textContent === '分轨列表')).toBe(false)
  expect(document.querySelector('.dt-track')).toBeNull()
  expect(document.querySelector('.dt-chain-viewmode')?.textContent).toBe(zh.chainGraphView)
})

/** Run snapshots: one lane per Assignment, with the profile each one runs under. */
import { expect, it } from 'vitest'
import { runsView } from '../src/app/views/runs.ts'
import type { AgentsView } from '../src/app/agents.ts'
import type { Ticket } from '../src/core/index.ts'

const avatar = { color: '#4D6BFE' }
const agents: { view(): AgentsView } = { view: () => ({ profiles: [{ id: 'p1', name: '研究员', role: '调研', instructions: '', model: null,
  workDir: '', avatar }], groups: [{ chatId: 'oc_team', name: 'A股日报', adminProfile: 'p1', members: [], notice: '',
  createdAt: '2026-11-05T00:00:00Z' }], bindings: { chats: {}, actors: {} } }) }
const ticket = (assignments: Ticket['assignments'], overrides: Partial<Ticket> = {}): Ticket => ({ id: 't1', title: '修复回归', decisionId: 'd1',
  mandate: { strength: 'explicit' }, channels: [{ source: 'feishu', thread: 'feishu:oc_team', address: { chatId: 'oc_team' } }],
  assignments, inputs: [], undelivered: [], createdAt: '2026-11-05T01:00:00Z', updatedAt: '2026-11-05T01:00:00Z',
  origin: { triggerId: 'e1', triggerIds: ['e1'] }, ...overrides }) as unknown as Ticket
type Store = Parameters<typeof runsView>[0]
const storeOf = (tickets: Ticket[]): Store => ({ tickets: { list: () => tickets } }) as unknown as Store

it('turns each Assignment into a lane, in slot order, with the group profile', () => {
  const store = storeOf([ticket([
    { id: 'a1', state: 'ended', createdAt: '2026-11-05T01:00:00Z', startedAt: '2026-11-05T01:01:00Z', endedAt: '2026-11-05T01:10:00Z',
      report: { state: 'ready', summary: 'done', at: '2026-11-05T01:09:00Z' } },
    { id: 'a2', state: 'running', createdAt: '2026-11-05T01:11:00Z', startedAt: '2026-11-05T01:12:00Z',
      report: { state: 'waiting', summary: 'need color', at: '2026-11-05T01:13:00Z' } },
    { id: 'a3', state: 'pending', createdAt: '2026-11-05T01:14:00Z' },
  ])])
  const { runs } = runsView(store, agents)
  expect(runs.map(run => [run.id, run.number, run.state])).toEqual([['a2', 2, 'waiting'], ['a3', 3, 'queued'], ['a1', 1, 'ended']])
  expect(runs[0]).toMatchObject({ ticketId: 't1', title: '修复回归', profileId: 'p1', profileName: '研究员',
    report: { state: 'waiting', summary: 'need color' }, updatedAt: '2026-11-05T01:13:00Z' })
  expect(runs[0]!.sessionId).toMatch(/^worker-/)
  expect(runs[1]!.sessionId).toBe('')
  expect(runs[2]!.sessionId).not.toBe('')
})

it('uses the profile fixed on a ticket, including a direct message that belongs to no group', () => {
  const store = storeOf([ticket([{ id: 'a1', state: 'running', createdAt: '2026-11-05T01:00:00Z', startedAt: '2026-11-05T01:01:00Z' }], {
    channels: [{ source: 'feishu', thread: 'feishu:oc_direct', address: { chatId: 'oc_direct' } }],
    execution: { name: 'fix-plan-color', directory: '/w/t1', assignment: '', profileId: 'p1' },
  })])
  expect(runsView(store, agents).runs[0]).toMatchObject({ profileId: 'p1', profileName: '研究员' })
})

it('narrows runs by ticket, group and profile', () => {
  const store = storeOf([ticket([{ id: 'a1', state: 'running', createdAt: '2026-11-05T01:00:00Z', startedAt: '2026-11-05T01:01:00Z' }])])
  expect(runsView(store, agents, { ticketId: 't1' }).runs).toHaveLength(1)
  expect(runsView(store, agents, { ticketId: 't9' }).runs).toHaveLength(0)
  expect(runsView(store, agents, { groupId: 'oc_team' }).runs).toHaveLength(1)
  expect(runsView(store, agents, { groupId: 'oc_other' }).runs).toHaveLength(0)
  expect(runsView(store, agents, { profileId: 'p1' }).runs).toHaveLength(1)
  expect(runsView(store, agents, { profileId: 'p2' }).runs).toHaveLength(0)
})

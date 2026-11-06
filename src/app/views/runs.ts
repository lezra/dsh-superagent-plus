/** Run snapshots: one row per Assignment, for the chain view's parallel lanes. */
import type { AgentsView, Avatar } from '../agents.ts'
import type { Store } from '../store.ts'
import type { Ticket } from '../../core/index.ts'
import { workerSessionId } from '../../executor/dsh.ts'
import { attachmentsIn, type TextAttachment } from './text.ts'

/** The state a lane shows: waiting for a free slot, running, waiting for a person, or over. */
export type RunState = 'queued' | 'running' | 'waiting' | 'ended'
export interface RunRow {
  /** The Assignment id; one Assignment is one run of the Ticket's worker Session. */
  id: string
  /** Its position among the Ticket's Assignments, from 1. */
  number: number
  ticketId: string
  title: string
  ticketState: 'open' | 'ended'
  state: RunState
  createdAt: string
  startedAt?: string
  updatedAt: string
  endedAt?: string
  endedReason?: string
  profileId?: string
  profileName?: string
  avatar?: Avatar
  /** The worker Session, empty until the Assignment starts. */
  sessionId: string
  report?: { state: string; summary: string }
  /** Images and links the worker's report or its ending carried, for the chain's node detail. */
  attachments: TextAttachment[]
  /** A running lane's position in the Executor's slots, from 1. */
  slot?: number
}
export interface RunsView { runs: RunRow[] }
export interface RunsQuery { profileId?: string; groupId?: string; ticketId?: string }

/**
 * The profile that runs a Ticket: the one fixed on its execution when it was created, else the leading profile of the
 * group chat it came from. Older records may name that profile rather than its id, so both are matched.
 */
function profileOf(ticket: Ticket, profiles: AgentsView['profiles'], groups: AgentsView['groups']) {
  const saved = ticket.execution?.profileId
  const fixed = saved ? profiles.find(profile => profile.id === saved) : undefined
  if (fixed) return fixed
  const keys = ticket.channels.map(channel => channel.thread)
  const group = groups.find(item => keys.some(key => key.includes(item.chatId)))
  const ref = group?.adminProfile.trim().toLowerCase()
  return ref ? profiles.find(profile => profile.id === ref || profile.name.toLowerCase() === ref) : undefined
}
const runState = (assignment: Ticket['assignments'][number]): RunState =>
  assignment.state === 'pending' ? 'queued' : assignment.state === 'ended' ? 'ended'
    : assignment.report?.state === 'waiting' ? 'waiting' : 'running'

/**
 * Lists runs newest first, grouped so running lanes come before queued and ended ones. `query` narrows by the Executor
 * profile, the group chat the Ticket came from, or one Ticket.
 */
export function runsView(store: Pick<Store, 'tickets'>, agents: { view(): AgentsView }, query: RunsQuery = {}): RunsView {
  const { profiles, groups } = agents.view()
  const rows: RunRow[] = []
  for (const ticket of store.tickets.list()) {
    const profile = profileOf(ticket, profiles, groups)
    if (query.profileId && profile?.id !== query.profileId) continue
    if (query.ticketId && ticket.id !== query.ticketId) continue
    if (query.groupId && !ticket.channels.some(channel => channel.thread.includes(query.groupId!))) continue
    ticket.assignments.forEach((assignment, index) => {
      rows.push({ id: assignment.id, number: index + 1, ticketId: ticket.id, title: ticket.title,
        ticketState: ticket.ended ? 'ended' : 'open', state: runState(assignment), createdAt: assignment.createdAt,
        ...assignment.startedAt ? { startedAt: assignment.startedAt } : {}, updatedAt: assignment.report?.at ?? assignment.endedAt
          ?? assignment.startedAt ?? assignment.createdAt, ...assignment.endedAt ? { endedAt: assignment.endedAt } : {},
        ...assignment.endedReason ? { endedReason: assignment.endedReason } : {},
        ...profile ? { profileId: profile.id, profileName: profile.name, avatar: profile.avatar } : {},
        sessionId: assignment.startedAt ? workerSessionId(ticket.id) : '',
        ...assignment.report ? { report: { state: assignment.report.state, summary: assignment.report.summary } } : {},
        attachments: attachmentsIn(assignment.report?.summary, assignment.endedReason) })
    })
  }
  const order: Record<RunState, number> = { running: 0, waiting: 1, queued: 2, ended: 3 }
  rows.sort((a, b) => order[a.state] - order[b.state] || (a.startedAt ?? a.createdAt).localeCompare(b.startedAt ?? b.createdAt))
  let slot = 0
  for (const row of rows) if (row.state === 'running') row.slot = ++slot
  return { runs: rows.slice(0, 200) }
}

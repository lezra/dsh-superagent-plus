/** Small shared pieces of the Team views: a person chip and the badge that counts their runs. */
import type { AgentsView, RunRow, TicketRow } from './api.ts'
import { Avatar, runAvatarState, type AvatarState } from './controls.tsx'
import { usePanel } from './provider.tsx'

type Profile = AgentsView['profiles'][number]
/** What an avatar needs from a Ticket: its stage, and the action a person stage or a queued working stage names. */
type TicketState = Pick<TicketRow, 'stage'> & { action?: string }
/** The avatar state a Ticket asks for: a person stage alerts, working runs, queued work thinks, idle waits. */
export const ticketAvatarState = (ticket: TicketState): AvatarState =>
  ticket.stage === 'person' ? 'alert' : ticket.stage === 'working' ? ticket.action === 'queued' ? 'thinking' : 'working'
    : ticket.stage === 'idle' ? 'waiting' : 'idle'
/** A profile across its open Tickets, most urgent first: alert > working > thinking > waiting > idle. */
export function avatarStateOf(tickets: readonly TicketState[]): AvatarState {
  const states = tickets.map(ticketAvatarState)
  return states.includes('alert') ? 'alert' : states.includes('working') ? 'working' : states.includes('thinking') ? 'thinking'
    : states.includes('waiting') ? 'waiting' : 'idle'
}
/** A run's avatar follows its open Ticket while that Ticket is listed; one whose Ticket already ended follows the run's own state. */
export function runAvatarStateOf(run: Pick<RunRow, 'state' | 'ticketId'>,
  tickets: readonly (TicketState & Pick<TicketRow, 'id'>)[]): AvatarState {
  const ticket = tickets.find(item => item.id === run.ticketId && item.stage !== 'ended')
  return ticket ? ticketAvatarState(ticket) : runAvatarState(run.state)
}
/** A profile as a chip: its avatar and name, with the role when it has one. */
export function ProfileChip({ profile, size = 18, role = false, state }: { profile: Profile; size?: 18 | 24; role?: boolean;
  state?: AvatarState }) {
  return <span className="dt-pchip">
    <Avatar name={profile.name} color={profile.avatar.color} image={profile.avatar.image} size={size} state={state} />
    <span className="dt-pchip-name">{profile.name}</span>
    {role && profile.role && <span className="dt-pchip-role">{profile.role}</span>}
  </span>
}
/** How many runs a profile or group carries, by state; nothing is shown when every count is zero. */
export function RunBadge({ running = 0, waiting = 0, queued = 0 }: { running?: number; waiting?: number; queued?: number }) {
  const { t } = usePanel()
  if (!running && !waiting && !queued) return <span className="dt-run-badge is-idle">{t('runBadge.idle')}</span>
  return <span className="dt-run-badge">
    {running > 0 && <span className="dt-run-badge-part" data-state="running">{running}</span>}
    {waiting > 0 && <span className="dt-run-badge-part" data-state="waiting">{waiting}</span>}
    {queued > 0 && <span className="dt-run-badge-part" data-state="queued">{queued}</span>}
  </span>
}

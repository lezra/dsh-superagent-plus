/** Board page: open Tickets by flow stage, the deployment's collaboration chain, and who may ask for work. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ApiResponse } from '../app/api.ts'
import type { AgentsView, TicketRow } from './api.ts'
import { usePoll } from './api.ts'
import { Avatar, CollapsiblePane, Icon, StateDot, usePaneCollapse } from './controls.tsx'
import type { DshSuperagentKey } from './locales.ts'
import { sourceMark, ticketMark } from './marks.ts'
import { usePanel, usePanelData } from './provider.tsx'
import { settingsRoute } from './route.ts'
import { localized, readableMarkers, valueLabel } from './text.ts'
import { ActionLink, Hint, LoadState, SessionButton, When } from './widgets.tsx'
import { ProfileChip, avatarStateOf, ticketAvatarState } from './team-kit.tsx'

type OverviewView = ApiResponse<'GET overview'>
type TicketsView = ApiResponse<'GET tickets'>
type SourcesView = ApiResponse<'GET sources'>

interface BoardData {
  open: TicketsView
  ended: TicketsView
  overview: OverviewView
  sources: SourcesView
  agents: AgentsView
}

/** One lane of the board: the Tickets it holds, in the order the API returns them; `dot` is the lane's status dot. */
interface Lane { key: 'queued' | 'working' | 'idle' | 'person'; label: DshSuperagentKey
  dot: 'running' | 'waiting' | 'error' | 'idle'; holds: (ticket: TicketRow) => boolean }

const LANES: readonly Lane[] = [
  { key: 'queued', label: 'boardLaneQueued', dot: 'waiting',
    holds: ticket => ticket.stage === 'working' && ticket.action === 'queued' },
  { key: 'working', label: 'boardLaneWorking', dot: 'running', holds: ticket => ticket.stage === 'working' && ticket.action !== 'queued' },
  { key: 'idle', label: 'boardLaneIdle', dot: 'idle', holds: ticket => ticket.stage === 'idle' },
  { key: 'person', label: 'boardLanePerson', dot: 'error', holds: ticket => ticket.stage === 'person' },
]

/** The polling view of the board: open and recently ended Tickets, the overview counts, and the Sources' health. */
function useBoard() {
  const { call } = usePanel()
  return usePoll(() => Promise.all([
    call('GET tickets', { query: { state: 'open', limit: 200 } }),
    call('GET tickets', { query: { state: 'ended', limit: 5 } }),
    call('GET overview'),
    call('GET sources'),
    call('GET agents'),
  ]).then(([open, ended, overview, sources, agents]): BoardData => ({ open, ended, overview, sources, agents })), [call], 5000)
}

/** A model route from the settings blocks, shown as `provider / model`; the deployment's default when unset. */
function modelLabel(value: unknown, fallback: string): string {
  const route = value as { provider?: unknown; model?: unknown } | null | undefined
  const model = typeof route?.model === 'string' ? route.model : ''
  const provider = typeof route?.provider === 'string' ? route.provider : ''
  return model ? [provider, model].filter(Boolean).join(' / ') : fallback
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="dt-lane-empty">{children}</p>
}

/** One Ticket on the board: what it is, which lane it is in, its worker Session, and a question waiting for a person. */
function Card({ ticket, profile }: { ticket: TicketRow; profile?: AgentsView['profiles'][number] }) {
  const { t, navigate } = usePanel()
  const mark = ticketMark(t, ticket)
  const answer = ticket.reply && ticket.stage === 'person' && ticket.action === 'answer' ? ticket.reply : undefined
  const action = ticket.stage === 'person' || ticket.stage === 'working' ? ticket.action : undefined
  const note = ticket.note && { ...ticket.note, text: readableMarkers(t, ticket.note.text) }
  return <article className="dt-bcard" data-stage={ticket.stage} data-action={action ?? ''}>
    {profile && <div className="dt-bcard-person"><ProfileChip profile={profile} role state={ticketAvatarState(ticket)} /></div>}
    <button type="button" className="dt-bcard-title" title={ticket.title}
      aria-label={`${t('boardOpen')}: ${ticket.title}`} onClick={() => navigate({ page: 'execution', id: ticket.id })}>{ticket.title}</button>
    <div className="dt-bcard-meta">
      <span className="dt-bcard-mark" data-state={mark.dot}><Icon name={mark.icon} size={12} />{mark.label}</span>
      <span className="dt-bcard-strength" data-strength={ticket.strength}>
        {ticket.strength === 'explicit' ? t('boardStrengthExplicit') : t('boardStrengthInferred')}</span>
      {ticket.threads.slice(0, 2).map(thread => <span key={thread.key} className="dt-bcard-source">{valueLabel(t, 'source', thread.source)}</span>)}
      <When at={ticket.updatedAt} />
    </div>
    {(ticket.assignments > 1 || ticket.sessionId || ticket.inputs > 0) && <div className="dt-bcard-agent">
      {ticket.assignments > 1 && <span className="dt-bcard-round">{t('boardRound', { count: ticket.assignments })}</span>}
      {ticket.inputs > 0 && <span className="dt-bcard-round">{t('boardInputs', { count: ticket.inputs })}</span>}
      {ticket.sessionId && <SessionButton variant="ghost" sessionId={ticket.sessionId} />}
    </div>}
    {note && <p className={note.error ? 'dt-bcard-question dt-bcard-question-error' : 'dt-bcard-question'}>{note.text}</p>}
    {answer && <div className="dt-bcard-actions"><ActionLink href={answer.url} icon="message">{t('boardAnswer')}</ActionLink></div>}
  </article>
}

/** A recently ended Ticket as its face alone: the profile that ran it, else the title's first two characters; hover or focus reveals the card. */
function EndedChip({ ticket, profile }: { ticket: TicketRow; profile?: AgentsView['profiles'][number] }) {
  const { t, navigate } = usePanel()
  const mark = ticketMark(t, ticket)
  const initials = [...ticket.title.trim()].slice(0, 2).join('')
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const target = anchor.current, element = bubble.current
    if (!open || !target || !element) return
    const margin = 12, gap = 8
    const a = target.getBoundingClientRect(), b = element.getBoundingClientRect()
    // Below the face first; only flip above when the viewport bottom leaves no room.
    const below = a.bottom + gap + b.height <= window.innerHeight - margin
    element.style.left = `${Math.max(margin, Math.min(a.left + a.width / 2 - b.width / 2, window.innerWidth - margin - b.width))}px`
    element.style.top = `${below ? a.bottom + gap : Math.max(margin, a.top - gap - b.height)}px`
    element.style.visibility = 'visible'
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [open])
  const note = ticket.note && { ...ticket.note, text: readableMarkers(t, ticket.note.text) }
  const brief = note?.text ?? ticket.summary
  return <span className="dt-ended">
    <button ref={anchor} type="button" className="dt-ended-chip" aria-label={`${t('boardOpen')}: ${ticket.title}`}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}
      onClick={() => navigate({ page: 'execution', id: ticket.id })}>
      {profile ? <Avatar name={profile.name} color={profile.avatar.color} image={profile.avatar.image} size={24} state="idle" />
        : <span className="dt-ended-face" aria-hidden="true">{initials}</span>}
    </button>
    {open && createPortal(<div ref={bubble} role="tooltip" className="dt-ended-pop" style={{ visibility: 'hidden' }}>
      <div className="dt-ended-pop-head">
        <span className="dt-bcard-mark" data-state={mark.dot}><Icon name={mark.icon} size={12} />{mark.label}</span>
        <When at={ticket.updatedAt} />
      </div>
      <strong className="dt-ended-pop-title">{ticket.title}</strong>
      <div className="dt-ended-pop-meta">
        {profile && <ProfileChip profile={profile} size={18} />}
        {ticket.threads.slice(0, 2).map(thread => <span key={thread.key} className="dt-bcard-source">{valueLabel(t, 'source', thread.source)}</span>)}
      </div>
      {brief && <p className="dt-ended-pop-note" data-error={note?.error || undefined}>{brief}</p>}
    </div>, document.body)}
  </span>
}

/** The cloud size a profile's avatar takes: the busier it is, the larger its face. */
const cloudSize = (active: number): 24 | 36 | 64 => active >= 3 ? 64 : active >= 1 ? 36 : 24

/** The flow ribbon: what arrived, what was judged, what is running and what waits for a person, right now. */
function FlowBar({ overview, running, people }: { overview: OverviewView; running: number; people: number }) {
  const { t } = usePanel()
  const step = (label: string, value: number, hint?: string) => <span className="dt-flow-step" title={hint}>
    <b>{value}</b><span>{label}</span>
  </span>
  return <div className="dt-flowbar" role="group" aria-label={t('boardFlow')}>
    <span className="dt-flow-live"><i className="dt-flow-pulse" aria-hidden="true" />{t('boardLive')}</span>
    {step(t('flowReceivedLabel'), overview.flow.received)}
    {step(t('flowFilteredLabel'), overview.flow.filtered)}
    {step(t('flowJudgedLabel'), overview.flow.judged)}
    {step(t('flowAcceptedLabel'), overview.flow.accepted)}
    {step(t('executingLabel'), running)}
    {step(t('boardLanePerson'), people)}
  </div>
}

/** The collaboration graph: the main Session, its Eval and Executor slots, the profiles and groups that carry work, and the Sources. */
function Rail({ masterId, model, overview, sources, people, agents, busy, tickets }: {
  masterId: string | undefined; model: string; overview: OverviewView; sources: SourcesView; agents: AgentsView
  people: { source: string; title: ReactNode; entries: { id: string; name?: string }[] }[]; busy: number; tickets: TicketRow[]
}) {
  const { t, navigate } = usePanel()
  const slots = Math.min(overview.executor.maxWorkers, 8)
  const ticketsIn = (chats: string[]) =>
    tickets.filter(ticket => ticket.threads.some(thread => chats.some(chat => thread.key.includes(chat))))
  const activeIn = (chats: string[]): number => ticketsIn(chats).length
  const chatsOf = (id: string) => agents.groups.filter(group => group.adminProfile === id).map(group => group.chatId)
  /** The open Tickets a profile runs: the ones it was fixed to, plus those in the chats it leads. */
  const ticketsOfProfile = (id: string): TicketRow[] => {
    const chats = chatsOf(id)
    return tickets.filter(ticket => ticket.profileId === id || ticket.threads.some(thread => chats.some(chat => thread.key.includes(chat))))
  }
  const shortId = masterId ? `#${masterId.replace(/^orchestrator-/, '').slice(0, 4)}` : t('empty')
  return <aside className="dt-rail" aria-label={t('boardRail')}>
    <section className="dt-rail-card">
      <div className="dt-rail-head"><h2 className="dt-rail-title">{t('railGraph')}</h2><span className="dt-rail-meta">{t('boardLive')}</span></div>
      <p className="dt-rail-node"><span className="dt-rail-dot" data-state="ongoing" aria-hidden="true" />{t('boardMainSession')}
        <code className="dt-mono dt-rail-id">{shortId}</code></p>
      <p className="dt-rail-node dt-rail-child">{t('railEval')}<b className="dt-num">{overview.flow.judged}</b></p>
      <p className="dt-rail-node dt-rail-child">{t('railSlots')}<span className="dt-slots" aria-hidden="true">
        {Array.from({ length: slots }, (_, index) => <i key={index} data-on={index < overview.executor.running ? 'true' : undefined} />)}</span></p>
      <p className="dt-rail-line dt-rail-quiet">{t('boardModel')}: {model}</p>
      {masterId && <SessionButton variant="outline" sessionId={masterId} />}
    </section>
    <section className="dt-rail-card">
      <div className="dt-rail-head"><h2 className="dt-rail-title">{t('boardProfiles')}</h2><span className="dt-rail-meta">{t('railByActive')}</span></div>
      {agents.profiles.length ? <ul className="dt-cloud">{agents.profiles.map(profile => {
        const running = ticketsOfProfile(profile.id)
        const state = avatarStateOf(running)
        const label = `${profile.name}${profile.role ? ` · ${profile.role}` : ''} ×${running.length}`
        return <li key={profile.id} className="dt-cloud-item" data-active={running.length ? 'true' : undefined} title={label} aria-label={label}>
          <span className="dt-cloud-face">
            <Avatar name={profile.name} color={profile.avatar.color} image={profile.avatar.image} size={cloudSize(running.length)}
              state={state} />
            {running.length > 0 && <b className="dt-cloud-count" aria-hidden="true">{running.length}</b>}
          </span>
        </li>
      })}</ul>
        : <p className="dt-rail-quiet">{t('boardProfilesNone')}</p>}
    </section>
    <section className="dt-rail-card">
      <div className="dt-rail-head"><h2 className="dt-rail-title">{t('boardGroups')}</h2><span className="dt-rail-meta">{t('railByActive')}</span></div>
      {agents.groups.length ? <ul className="dt-people">{agents.groups.map(group => <li key={group.chatId} className="dt-profile">
        <Avatar size={24} icon="message" />
        <span className="dt-profile-name">{group.name}</span>
        <span className="dt-rail-badge">{t('railActive', { count: activeIn([group.chatId]) })}</span></li>)}</ul>
        : <p className="dt-rail-quiet">{t('boardGroupsNone')}</p>}
    </section>
    <section className="dt-rail-card">
      <div className="dt-rail-head"><h2 className="dt-rail-title">{t('boardPeople')}</h2>
        <button type="button" className="dt-textlink dt-rail-action" onClick={() => navigate(settingsRoute('eval'))}>{t('boardPeopleGo')}</button></div>
      {people.length ? people.map(group => <div key={group.source} className="dt-people-group">
        <p className="dt-rail-quiet dt-people-source">{group.title}</p>
        <ul className="dt-people">{group.entries.slice(0, 4).map(entry => <li key={entry.id} className="dt-person">
          <span className="dt-person-dot" aria-hidden="true" />{entry.name ?? entry.id}</li>)}
          {group.entries.length > 4 && <li className="dt-person dt-rail-quiet">+{group.entries.length - 4}</li>}
        </ul>
      </div>)
        : <><p className="dt-rail-warn">{t('boardPeopleNone')}</p><Hint>{t('boardPeopleHint')}</Hint></>}
    </section>
    <section className="dt-rail-card">
      <div className="dt-rail-head"><h2 className="dt-rail-title">{t('boardSources')}</h2><span className="dt-rail-meta">{t('boardWaitingPeople', { count: busy })}</span></div>
      <ul className="dt-people">{sources.map(source => {
        const mark = sourceMark(t, source.state)
        return <li key={source.id} className="dt-profile">
          <StateDot state={mark.dot} /><span className="dt-profile-name">{localized(t, source.title)}</span>
          <span className="dt-rail-quiet dt-rail-source-state">{mark.label} · {t('flowReceivedLabel')} {source.stats.received}</span>
        </li>
      })}</ul>
    </section>
  </aside>
}

function Skeleton() {
  return <div className="dt-board" aria-busy="true">
    <div className="dt-rail">
      {[0, 1, 2].map(index => <div key={index} className="dt-rail-card dt-skeleton" />)}
    </div>
    <div className="dt-board-main">
      <div className="dt-skeleton dt-skeleton-bar" />
      <div className="dt-lanes">
        {[0, 1, 2, 3].map(lane => <div key={lane} className="dt-lane">
          <div className="dt-skeleton dt-skeleton-head" />
          <div className="dt-skeleton dt-skeleton-card" />
          <div className="dt-skeleton dt-skeleton-card" />
        </div>)}
      </div>
    </div>
  </div>
}

export function BoardPage() {
  const { t } = usePanel()
  const { state, setup } = usePanelData()
  const { data, error } = useBoard()
  const { collapsed, toggle } = usePaneCollapse('board-rail')
  const [scope, setScope] = useState('all')
  const [onlyRun, setOnlyRun] = useState(false)
  const { call } = usePanel()
  const settings = usePoll(() => call('GET settings'), [call], 30_000)
  if (!data) return error ? <LoadState error={error} loading={false} /> : <Skeleton />
  const items = data.open.items
  const people = (Object.entries(settings.data?.blocks.policy.value.sources ?? {}) as [string, { allowed?: { id: string; name?: string }[] }][])
    .flatMap(([source, part]) => part.allowed?.length ? [{ source, entries: part.allowed,
      title: localized(t, data.sources.find(row => row.id === source)?.title ?? { en: source, zh: source }) }] : [])
  const model = modelLabel(settings.data?.blocks.executor.value.model ?? settings.data?.blocks.eval.value.model, t('boardDefaultModel'))
  /** The profile that runs a Ticket: the one fixed when it was created, else the admin of the group chat its Threads came from. */
  const profileOf = (ticket: TicketRow): AgentsView['profiles'][number] | undefined => {
    const fixed = ticket.profileId ? data.agents.profiles.find(profile => profile.id === ticket.profileId) : undefined
    if (fixed) return fixed
    const keys = ticket.threads.map(thread => thread.key)
    const group = data.agents.groups.find(item => keys.some(key => key.includes(item.chatId)))
    return data.agents.profiles.find(profile => profile.id === group?.adminProfile)
  }
  const profileOfTicket = (ticket: TicketRow) => profileOf(ticket)
  const matchesScope = (ticket: TicketRow): boolean => scope === 'all' ? true
    : scope.startsWith('p:') ? profileOfTicket(ticket)?.id === scope.slice(2)
      : ticket.threads.some(thread => thread.key.includes(scope.slice(2)))
  const visible = items.filter(matchesScope)
  const lanes = LANES.map(lane => ({ ...lane, tickets: visible.filter(lane.holds) }))
  const endedVisible = onlyRun ? [] : data.ended.items.filter(matchesScope)
  const waiting = lanes.find(lane => lane.key === 'person')?.tickets.length ?? 0
  // Ended Tickets are data too: the board is only empty when neither the open lanes nor the ended strip has a card.
  const empty = lanes.every(lane => lane.tickets.length === 0) && endedVisible.length === 0
  const recent = !onlyRun && <section className="dt-recent" aria-label={`${t('boardLaneEnded')} (${endedVisible.length})`}>
    <header className="dt-lane-head dt-recent-head">
      <span className="dt-lane-index">{String(lanes.length + 1).padStart(2, '0')}</span>
      <span className="dt-lane-name">{t('boardLaneEnded')}</span>
      <span className="dt-lane-count">{endedVisible.length}</span>
    </header>
    <div className="dt-recent-row">
      {endedVisible.map(ticket => <EndedChip key={ticket.id} ticket={ticket} profile={profileOf(ticket)} />)}
      {!endedVisible.length && <Empty>{t('boardEndedEmpty')}</Empty>}
    </div>
  </section>
  return <>
    {setup?.problem && <p className="dt-banner" role="status">{t('problemSetup')}</p>}
    <div className="dt-board-scope">
      <select className="dt-select" aria-label={t('boardScope')} value={scope} onChange={event => setScope(event.target.value)}>
        <option value="all">{t('boardScopeAll')}</option>
        {data.agents.profiles.map(profile => <option key={profile.id} value={`p:${profile.id}`}>{t('boardScopeProfile', { name: profile.name })}</option>)}
        {data.agents.groups.map(group => <option key={group.chatId} value={`g:${group.chatId}`}>{t('boardScopeGroup', { name: group.name })}</option>)}
      </select>
      <span className="dt-parallel"><i className="dt-live-dot" aria-hidden="true" />{t('boardParallel', { count: data.overview.executor.running })}</span>
      <button type="button" className={onlyRun ? 'dt-btn is-on' : 'dt-btn'} aria-pressed={onlyRun} onClick={() => setOnlyRun(!onlyRun)}>{t('boardOnlyRun')}</button>
      <div className="dt-usage">
        <span>24h <b className="dt-num">{data.overview.flow.received}</b> {t('flowReceivedLabel')}</span>
        <span>{t('boardUsageJudged')} <b className="dt-num">{data.overview.flow.judged}</b></span>
        <span>{t('boardUsageAccepted')} <b className="dt-num">{data.overview.flow.accepted}</b></span>
      </div>
    </div>
    <div className="dt-board" data-pane={collapsed ? 'collapsed' : undefined}>
      <CollapsiblePane collapsed={collapsed} onToggle={toggle} label={t(collapsed ? 'paneExpand' : 'paneCollapse')}>
        <Rail masterId={state?.masterId} model={model} overview={data.overview} sources={data.sources} people={people}
          agents={data.agents} busy={waiting} tickets={items} />
      </CollapsiblePane>
      <div className="dt-board-main">
        <FlowBar overview={data.overview} running={data.overview.executor.running} people={waiting} />
        {empty && <div className="dt-board-empty"><p className="dt-board-empty-title">{t('boardEmpty')}</p><Hint>{t('boardEmptyHint')}</Hint></div>}
        {!visible.length && recent}
        <div className="dt-lanes">
          {lanes.map((lane, laneIndex) => <section key={lane.key} className="dt-lane" data-lane={lane.key}
            aria-label={`${t(lane.label)} (${lane.tickets.length})`}>
            <header className="dt-lane-head">
              <span className="dt-lane-dot" data-state={lane.dot} aria-hidden="true" />
              <span className="dt-lane-index">{String(laneIndex + 1).padStart(2, '0')}</span>
              <span className="dt-lane-name">{t(lane.label)}</span>
              <span className="dt-lane-count">{lane.tickets.length}</span>
            </header>
            <div className="dt-lane-body">
              {lane.tickets.map(ticket => <Card key={ticket.id} ticket={ticket} profile={profileOf(ticket)} />)}
              {!lane.tickets.length && <Empty>{t('empty')}</Empty>}
            </div>
          </section>)}
        </div>
        {visible.length > 0 && recent}
      </div>
    </div>
  </>
}

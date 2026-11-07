/** Team page: the Executor profiles and the group chats they lead. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import type { AgentsView, RunRow, TicketRow } from './api.ts'
import { usePoll } from './api.ts'
import { AVATAR_INKS, Avatar, Button, CollapsiblePane, Icon, Modal, Tag, fileToAvatarDataUrl, inkOfProfile,
  usePaneCollapse } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { ProfileChip, RunBadge, avatarStateOf, runAvatarStateOf } from './team-kit.tsx'
import { LoadState, When } from './widgets.tsx'

type Profile = AgentsView['profiles'][number]
type Group = AgentsView['groups'][number]
const modelLabel = (profile: Profile): string | undefined => profile.model ? `${profile.model.provider} / ${profile.model.model}` : undefined
/** How many ended runs the detail lists before it says how many older ones it left out. */
const HISTORY_LIMIT = 12
/** Tickets that arrived through one of `chats`, matched by the chat id their Thread keys carry. */
const ticketsIn = (tickets: TicketRow[], chats: string[]): TicketRow[] =>
  tickets.filter(ticket => ticket.threads.some(thread => chats.some(chat => thread.key.includes(chat))))
/** The runs the Executor fixed to a profile, which need no group chat to belong to it. */
const runsOf = (runs: RunRow[], profile: Profile): RunRow[] => runs.filter(run => run.profileId === profile.id)
/** The open Tickets a profile shows: those it runs, and those in the chats it leads. */
const ticketsOf = (profile: Profile, groups: Group[], tickets: TicketRow[], runs: RunRow[]): TicketRow[] => {
  const runIds = new Set(runsOf(runs, profile).map(run => run.ticketId))
  const led = new Set(ticketsIn(tickets, groups.filter(group => group.adminProfile === profile.id).map(group => group.chatId))
    .map(ticket => ticket.id))
  return tickets.filter(ticket => runIds.has(ticket.id) || led.has(ticket.id))
}
const badgeOf = (runs: RunRow[]) => ({ running: runs.filter(run => run.state === 'running').length,
  waiting: runs.filter(run => run.state === 'waiting').length, queued: runs.filter(run => run.state === 'queued').length })
type DropEdge = 'before' | 'after'

/** A compact delete action whose confirmation names the profile and what clearing its references does. */
function DeleteProfileButton({ profile, disabled, onDelete }: { profile: Profile; disabled: boolean
  onDelete: () => Promise<unknown> }) {
  const { t } = usePanel()
  const [open, setOpen] = useState(false)
  const remove = useAction(onDelete)
  return <>
    <Button className="dt-person-delete" variant="ghost" size="sm" icon={<Icon name="trash" size={14} />}
      aria-label={t('teamProfileDelete')} title={t('teamProfileDelete')} disabled={disabled}
      onClick={() => setOpen(true)} />
    <Modal open={open} onClose={() => setOpen(false)} title={t('teamProfileDelete')} closeLabel={t('close')}
      description={t('teamProfileDeleteConfirm', { name: profile.name })} footer={<>
        <Button variant="ghost" onClick={() => setOpen(false)}>{t('cancel')}</Button>
        <Button variant="primary" disabled={remove.busy}
          onClick={() => { void remove.run().then(done => { if (done) setOpen(false) }) }}>{t('confirm')}</Button>
      </>} />
  </>
}

function PersonRow({ profile, groups, tickets, runs, selected, dragging, drop, busy, onSelect, onDelete, onDragStart,
  onDragOver, onDrop, onDragEnd }: { profile: Profile; groups: Group[]; tickets: TicketRow[]; runs: RunRow[]
  selected: boolean; dragging: boolean; drop?: DropEdge; busy: boolean; onSelect: () => void
  onDelete: () => Promise<unknown>; onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void; onDrop: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void }) {
  const { t } = usePanel()
  const mine = groups.filter(group => group.adminProfile === profile.id)
  const theirTickets = ticketsOf(profile, groups, tickets, runs)
  const own = runsOf(runs, profile)
  const badge = badgeOf(own)
  const state = avatarStateOf(theirTickets)
  const running = badge.running > 0 || state === 'working'
  const meta = [profile.role, modelLabel(profile), mine.length ? t('teamGroupCount', { count: mine.length }) : ''].filter(Boolean).join(' · ')
  return <div className={selected ? 'dt-person-card is-profile is-selected' : 'dt-person-card is-profile'}
    style={{ '--dt-person-ink': profile.avatar.color } as CSSProperties}
    data-running={running ? 'true' : undefined} data-dragging={dragging ? 'true' : undefined} data-drop={drop}
    draggable={!busy} title={t('teamProfileDrag')}
    onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}>
    <button type="button" className="dt-person-select" aria-pressed={selected} onClick={onSelect}>
      <Avatar name={profile.name} color={profile.avatar.color} image={profile.avatar.image} size={36} state={state}
        sparkle={selected} />
      <span className="dt-person-meta">
        <span className="dt-person-name">{profile.name}</span>
        <span className="dt-person-role">{meta || t('teamModelDefault')}</span>
      </span>
      <RunBadge {...badge} />
    </button>
    <DeleteProfileButton profile={profile} disabled={busy} onDelete={onDelete} />
  </div>
}

/**
 * The profile's identity: the picture that can be replaced, the name renamed on a double click, and its ink.
 * A name is saved on blur or Enter; a refusal keeps the draft open so another name can be picked without retyping it.
 */
function IdentityBlock({ profile, reload }: { profile: Profile; reload: () => Promise<unknown> }) {
  const { t, call } = usePanel()
  const { run: saveAvatar, busy: savingAvatar } = useAction((patch: { color?: string; image?: string | null }) =>
    call('PUT agents/profiles/:id', { id: profile.id, body: patch }), { reload })
  const rename = useAction((name: string) => call('PUT agents/profiles/:id', { id: profile.id, body: { name } }), { reload })
  const fileRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.name)
  const [error, setError] = useState('')
  useEffect(() => { setName(profile.name) }, [profile.name, profile.id])
  useEffect(() => { if (editing) { nameRef.current?.focus(); nameRef.current?.select() } }, [editing])
  const busy = savingAvatar || rename.busy
  const upload = async (file?: File): Promise<void> => {
    if (!file) return
    setError('')
    try { await saveAvatar({ image: await fileToAvatarDataUrl(file) }) }
    catch { setError(t('teamAvatarUploadFailed')) }
  }
  const saveName = async (): Promise<void> => {
    const value = name.trim()
    if (!value) { setName(profile.name); setEditing(false); return }
    if (value === profile.name) { setEditing(false); return }
    if (await rename.run(value)) setEditing(false)
  }
  return <section className="dt-section dt-profile-identity">
    <div className="dt-profile-id">
      <button type="button" className="dt-avatar-preview" aria-label={t('teamAvatarUpload')} title={t('teamAvatarUpload')}
        disabled={busy} onClick={() => fileRef.current?.click()}>
        <Avatar key={`${profile.avatar.color}-${profile.avatar.image ?? 'whale'}`} name={profile.name}
          color={profile.avatar.color} image={profile.avatar.image} size={64} />
        <span className="dt-avatar-upload-mark" aria-hidden="true"><Icon name="upload" size={13} /></span>
      </button>
      <div className="dt-profile-id-main">
        {editing ? <input ref={nameRef} className="dt-name-input" value={name} maxLength={40} disabled={rename.busy}
          aria-label={t('teamProfileName')}
          onChange={event => setName(event.target.value)} onBlur={() => { void saveName() }}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur()
            else if (event.key === 'Escape') { setName(profile.name); setEditing(false) }
          }} />
          : <button type="button" className="dt-name-view" title={t('teamProfileNameHint')}
            onDoubleClick={() => setEditing(true)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); setEditing(true) } }}>
            {profile.name}</button>}
        <div className="dt-avatar-choice">
          <div className="dt-swatches">{AVATAR_INKS.map(ink => <button type="button" key={ink.name} className="dt-color"
            style={{ background: ink.color }} title={ink.name} aria-label={ink.name} disabled={busy}
            aria-pressed={ink.color.toLowerCase() === profile.avatar.color.toLowerCase()} onClick={() => { void saveAvatar({ color: ink.color }) }} />)}</div>
          <div className="dt-avatar-actions">
            <button type="button" className="dt-btn dt-btn-ghost dt-btn-sm dt-avatar-reset" disabled={busy}
              onClick={() => { void saveAvatar({ image: null, color: inkOfProfile(profile.id) }) }}>{t('teamAvatarReset')}</button>
            {profile.avatar.image && <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => { void saveAvatar({ image: null }) }}>{t('teamAvatarRemove')}</Button>}
          </div>
          {error && <p className="dt-hint" role="alert">{error}</p>}
        </div>
      </div>
    </div>
    <input ref={fileRef} type="file" accept="image/*" className="dt-avatar-file" aria-label={t('teamAvatarUpload')}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file) }} />
  </section>
}

/** One run on a profile's timeline: what it ran, where it stands, and when it started or ended; clicking opens the Ticket. */
function RunNode({ run, tickets }: { run: RunRow; tickets: TicketRow[] }) {
  const { t, navigate } = usePanel()
  return <button type="button" className="dt-run-row" data-state={run.state}
    onClick={() => navigate({ page: 'execution', id: run.ticketId })}>
    <Avatar name={run.profileName} color={run.avatar?.color} image={run.avatar?.image} size={18} state={runAvatarStateOf(run, tickets)} />
    <div className="dt-profile-run-text"><span className="dt-team-name">#{run.number} {run.title}</span>
      <span className="dt-team-meta">{t(`runState.${run.state}`)} · <When at={run.endedAt ?? run.startedAt ?? run.createdAt} /></span></div>
  </button>
}

/** The selected profile: its identity, instructions, the runs it is on now and has finished, then capabilities and groups. */
function ProfilePane({ profile, groups, tickets, runs, reload }: {
  profile: Profile; groups: Group[]; tickets: TicketRow[]; runs: RunRow[]; reload: () => Promise<unknown>
}) {
  const { t, call, notify } = usePanel()
  const [restartNeeded, setRestartNeeded] = useState(false)
  const toggleMcp = async (name: string, enabled: boolean): Promise<void> => {
    const result = await call('PUT profiles/:id/mcp', { id: profile.id, body: { name, enabled } })
    setRestartNeeded(result.synced)
    notify(t('mcpSaved'))
    await reload()
  }
  const mine = groups.filter(group => group.adminProfile === profile.id)
  const own = runsOf(runs, profile)
  const active = own.filter(run => run.state !== 'ended')
  // Newest first: an ended run carries its end time, a run still on a Ticket its latest report.
  const history = own.filter(run => run.state === 'ended')
    .sort((a, b) => (b.endedAt ?? b.updatedAt).localeCompare(a.endedAt ?? a.updatedAt))
  return <>
    <IdentityBlock profile={profile} reload={reload} />
    <section className="dt-section dt-profile-instructions">
      <h3 className="dt-section-title"><span className="dt-section-name">{t('teamInstructions')}</span></h3>
      <p className="dt-team-instructions">{profile.instructions || t('teamNoInstructions')}</p>
    </section>
    <div className="dt-detail-cols">
      <section className="dt-section">
        <h3 className="dt-section-title"><span className="dt-section-name">{t('teamSkills')}</span></h3>
        {profile.skills?.length ? <div className="dt-cap-list">{profile.skills.map(skill =>
          <div className="dt-cap-row" key={skill}>
            <span className="dt-cap-icon" aria-hidden="true"><Icon name="skill" size={14} /></span>
            <span className="dt-cap-name dt-mono">{skill}</span>
            <Tag tone="neutral">{t('teamBuiltinSkill')}</Tag>
          </div>)}</div> : <p className="dt-hint">{t('teamNoSkills')}</p>}
      </section>
      <section className="dt-section">
        <h3 className="dt-section-title"><span className="dt-section-name">{t('teamMcp')}</span></h3>
        {profile.mcp?.length ? <div className="dt-cap-list">{profile.mcp.map(server => {
          const startable = server.name === 'codegraph' || server.name === 'drawio'
          return <button type="button" className="dt-cap-row is-action" key={server.name} disabled={!startable}
            aria-pressed={server.enabled} aria-label={server.name}
            onClick={() => { if (startable) void toggleMcp(server.name, !server.enabled) }}>
            <span className="dt-cap-icon" data-state={server.enabled ? 'on' : 'off'} aria-hidden="true"><Icon name="mcp" size={14} /></span>
            <span className="dt-cap-name dt-mono">{server.name}</span>
            <Tag tone={!startable ? 'quiet' : server.enabled ? 'success' : 'warning'}>
              {t(server.enabled ? 'teamCapOn' : !startable ? 'mcpNotStartable' : 'teamMcpOff')}</Tag>
          </button>})}</div> : <p className="dt-hint">{t('teamNoMcp')}</p>}
        {restartNeeded && <p className="dt-hint" role="status">{t('mcpRestartHint')}</p>}
      </section>
    </div>
    <section className="dt-section dt-profile-timeline">
      <h3 className="dt-section-title"><span className="dt-section-name">{t('teamRunTimeline')}</span><span className="dt-muted">{t('teamRunTimelineHint')}</span></h3>
      <p className="dt-run-timeline-head">{t('teamRunNow')}<span className="dt-muted">{active.length}</span></p>
      {active.length ? <div className="dt-run-timeline">{active.map(run => <RunNode key={run.id} run={run} tickets={tickets} />)}</div>
        : <p className="dt-hint">{t('teamNoRuns')}</p>}
      <p className="dt-run-timeline-head">{t('teamRunHistory')}<span className="dt-muted">{history.length}</span></p>
      {history.length ? <div className="dt-run-timeline is-history">
        {history.slice(0, HISTORY_LIMIT).map(run => <RunNode key={run.id} run={run} tickets={tickets} />)}</div>
        : <p className="dt-hint">{t('teamNoHistory')}</p>}
      {history.length > HISTORY_LIMIT && <p className="dt-hint">{t('teamRunHistoryMore', { count: history.length - HISTORY_LIMIT })}</p>}
    </section>
    <section className="dt-section">
      <h3 className="dt-section-title"><span className="dt-section-name">{t('teamLedGroups')}</span></h3>
      {mine.length ? <ul className="dt-team-detail-list">{mine.map(group => <li key={group.chatId}>{group.name}
        <span className="dt-mono"> {group.chatId}</span></li>)}</ul> : <p className="dt-hint">{t('teamNoGroups')}</p>}
    </section>
  </>
}

function GroupRow({ group, profiles, selected, onSelect }: { group: Group; profiles: Profile[]; selected: boolean; onSelect: () => void }) {
  const { t } = usePanel()
  const admin = profiles.find(profile => profile.id === group.adminProfile)
  return <button type="button" className={selected ? 'dt-person-card is-selected' : 'dt-person-card'} aria-pressed={selected} onClick={onSelect}>
    <Avatar size={36} icon="message" />
    <span className="dt-person-meta">
      <span className="dt-person-name">{group.name}</span>
      <span className="dt-person-role">{admin ? t('teamAdmin') : t('teamAdminNone')} · {t('boardGroupsMembers', { count: group.members.length })}</span>
    </span>
  </button>
}

/** The selected group: its leading profile, the runs in each member's lane, and its memory scope. */
function GroupPane({ group, profiles, tickets, runs }: { group: Group; profiles: Profile[]; tickets: TicketRow[]; runs: RunRow[] }) {
  const { t } = usePanel()
  const admin = profiles.find(profile => profile.id === group.adminProfile)
  const ids = new Set(ticketsIn(tickets, [group.chatId]).map(ticket => ticket.id))
  const own = runs.filter(run => ids.has(run.ticketId))
  const lanes = profiles.map(profile => ({ profile, runs: own.filter(run => run.profileId === profile.id) }))
    .filter(lane => lane.runs.length > 0)
  return <>
    <div className="dt-panel-head">
      {admin ? <ProfileChip profile={admin} role state={avatarStateOf(ticketsIn(tickets, [group.chatId]))} />
        : <span className="dt-muted">{t('teamAdminNone')}</span>}
      <span className="dt-chip is-accent dt-mono" style={{ marginLeft: 'auto' }}>{group.chatId}</span>
    </div>
    <p className="dt-callout is-info">{t('groupRouteHint')}</p>
    {lanes.length ? <div className="dt-duty-lanes">{lanes.map(({ profile, runs: rows }) => <section className="dt-duty-lane" key={profile.id}>
      <div className="dt-duty-lane-head"><span className="dt-lane-dot" data-state={rows.some(run => run.state === 'running') ? 'running'
        : rows.some(run => run.state === 'waiting') ? 'waiting' : undefined} aria-hidden="true" />
        {profile.name}<span className="dt-tag" data-tone="neutral">{rows.length}</span></div>
      {rows.map(run => <article className="dt-group-run" data-state={run.state} key={run.id}>
        <p className="dt-group-run-title">#{run.number} {run.title}</p>
        <div className="dt-group-run-meta"><span>{t(`runState.${run.state}`)}</span>
          <span style={{ marginLeft: 'auto' }}><Avatar name={run.profileName} color={run.avatar?.color} image={run.avatar?.image} size={24} state={runAvatarStateOf(run, tickets)} /></span></div>
      </article>)}</section>)}</div> : <p className="dt-hint">{t('groupNoRuns')}</p>}
    <div className="dt-detail-cols">
      <section className="dt-section">
        <h3 className="dt-section-title"><span className="dt-section-name">{t('groupSummary')}</span><span className="dt-muted">{t('groupSummaryHint')}</span></h3>
        <p className="dt-hint">{own.length ? t('groupSummaryCount', { count: own.length }) : t('groupSummaryNone')}</p>
      </section>
      <section className="dt-section">
        <h3 className="dt-section-title"><span className="dt-section-name">{t('groupMemory')}</span><span className="dt-muted">{t('groupMemoryHint')}</span></h3>
        <dl className="dt-kv">
          <dt>scope</dt><dd className="dt-mono">group/{group.chatId}</dd>
          <dt>{t('teamMembers')}</dt><dd>{group.members.length ? <ul className="dt-team-detail-list">{group.members.map(member => <li key={member} className="dt-mono">{member}</li>)}</ul> : t('empty')}</dd>
          <dt>{t('groupNotice')}</dt><dd>{group.notice || t('groupNoNotice')}</dd>
          <dt>{t('teamCreated')}</dt><dd><When at={group.createdAt} /></dd>
        </dl>
      </section>
    </div>
  </>
}

export function TeamPage() {
  const { t, call, newSession, notify } = usePanel()
  const [pickedProfile, setPickedProfile] = useState<string>()
  const [pickedGroup, setPickedGroup] = useState<string>()
  const [draggedProfile, setDraggedProfile] = useState<string>()
  const [profileDrop, setProfileDrop] = useState<{ id: string; edge: DropEdge }>()
  // The two side lists share one detail panel, which shows whichever row was clicked last.
  const [shown, setShown] = useState<'profile' | 'group'>('profile')
  const { collapsed, toggle } = usePaneCollapse('team-list')
  const splitRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLElement>(null)
  // The shared row keeps the natural height the page opened with; a shorter profile scrolls inside instead of shrinking it.
  const lockedHeight = useRef(0)
  const { data, error, reload } = usePoll(() => Promise.all([call('GET agents'), call('GET tickets', { query: { state: 'open', limit: 200 } }),
    call('GET runs')]).then(([agents, tickets, runs]) => ({ agents, tickets: tickets.items, runs: runs.runs })), [call], 5000)
  const reorderProfiles = useAction((ids: string[]) => call('PUT agents/profiles/order', { body: { ids } }), { reload })
  useLayoutEffect(() => {
    const split = splitRef.current
    const detail = detailRef.current
    if (!split || !detail) return
    // Stacked below 900px the split has two rows; the lock only applies to the side-by-side row.
    if (getComputedStyle(split).gridTemplateRows.trim().split(/\s+/).length !== 1) return
    const content = detail.scrollHeight + (detail.offsetHeight - detail.clientHeight)
    const natural = Math.max(split.getBoundingClientRect().height, content)
    if (natural > lockedHeight.current + 1) {
      lockedHeight.current = natural
      split.style.setProperty('--dt-team-h', `${natural}px`)
    }
  }, [data, shown, pickedProfile, pickedGroup])
  if (!data) return <LoadState error={error} loading={!error} />
  const { profiles, groups } = data.agents
  const profile = profiles.find(item => item.id === pickedProfile) ?? profiles[0]
  const group = groups.find(item => item.chatId === pickedGroup)
  const moveProfile = (sourceId: string, targetId: string, edge: DropEdge): void => {
    if (sourceId === targetId || reorderProfiles.busy) return
    const remaining = profiles.filter(item => item.id !== sourceId)
    const target = remaining.findIndex(item => item.id === targetId)
    if (target < 0) return
    const ids = remaining.map(item => item.id)
    ids.splice(target + (edge === 'after' ? 1 : 0), 0, sourceId)
    if (ids.every((id, index) => id === profiles[index]?.id)) return
    void reorderProfiles.run(ids)
  }
  const deleteProfile = async (id: string): Promise<void> => {
    const result = await call('DELETE agents/profiles/:id', { id })
    if (pickedProfile === id) setPickedProfile(undefined)
    await reload()
    notify(t('teamProfileDeleted', { name: result.removed.name }))
  }
  return <div className="dt-team-split" ref={splitRef} data-pane={collapsed ? 'collapsed' : undefined}>
    <CollapsiblePane collapsed={collapsed} onToggle={toggle} label={t(collapsed ? 'paneExpand' : 'paneCollapse')}>
      <div className="dt-team-pane">
        <section className="dt-card dt-panel dt-team-list" aria-label={t('teamProfiles')}>
          <div className="dt-panel-head"><h2 className="dt-h2">{t('teamProfiles')}</h2><span className="dt-team-count">{profiles.length}</span>
            <Button className="dt-team-new" size="sm" icon={<Icon name="plus" size={14} />} title={t('teamProfileNewHint')}
              onClick={() => newSession(t('teamProfilePrompt'))}>{t('teamProfileNew')}</Button></div>
          {profiles.length ? <div className="dt-person-list">{profiles.map(item => <PersonRow key={item.id} profile={item} groups={groups}
            tickets={data.tickets} runs={data.runs} selected={item.id === profile?.id}
            dragging={draggedProfile === item.id} drop={profileDrop?.id === item.id ? profileDrop.edge : undefined}
            busy={reorderProfiles.busy}
            onSelect={() => { setPickedProfile(item.id); setShown('profile') }}
            onDelete={() => deleteProfile(item.id)}
            onDragStart={event => {
              if (reorderProfiles.busy) return
              setPickedProfile(item.id)
              setShown('profile')
              setDraggedProfile(item.id)
              event.dataTransfer?.setData('text/plain', item.id)
              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={event => {
              if (!draggedProfile || draggedProfile === item.id || reorderProfiles.busy) return
              event.preventDefault()
              const box = event.currentTarget.getBoundingClientRect()
              setProfileDrop({ id: item.id, edge: event.clientY < box.top + box.height / 2 ? 'before' : 'after' })
            }}
            onDrop={event => {
              event.preventDefault()
              const box = event.currentTarget.getBoundingClientRect()
              if (draggedProfile) moveProfile(draggedProfile, item.id,
                event.clientY < box.top + box.height / 2 ? 'before' : 'after')
              setDraggedProfile(undefined)
              setProfileDrop(undefined)
            }}
            onDragEnd={() => { setDraggedProfile(undefined); setProfileDrop(undefined) }} />)}</div>
            : <p className="dt-hint">{t('teamEmptyProfiles')}</p>}
        </section>
        <section className="dt-card dt-panel dt-team-groups" aria-label={t('teamGroups')}>
          <div className="dt-panel-head"><h2 className="dt-h2">{t('teamGroups')}</h2><span className="dt-team-count">{groups.length}</span></div>
          {groups.length ? <div className="dt-person-list">{groups.map(item => <GroupRow key={item.chatId} group={item} profiles={profiles}
            selected={shown === 'group' && item.chatId === group?.chatId}
            onSelect={() => { setPickedGroup(item.chatId); setShown('group') }} />)}</div>
            : <p className="dt-hint">{t('teamEmptyGroups')}</p>}
        </section>
      </div>
    </CollapsiblePane>
    <section className="dt-card dt-panel dt-team-detail-panel" ref={detailRef} aria-label={shown === 'group' ? t('teamGroups') : t('teamProfiles')}>
      {shown === 'group' && group ? <GroupPane group={group} profiles={profiles} tickets={data.tickets} runs={data.runs} />
        : profile ? <ProfilePane profile={profile} groups={groups} tickets={data.tickets} runs={data.runs} reload={reload} />
        : <p className="dt-hint">{t(shown === 'group' ? 'teamPickGroup' : 'teamPickProfile')}</p>}
    </section>
  </div>
}

/** Chain page: one Ticket's path from the message that started it, through its Eval and Decision, to its Executor and end. */
import { useEffect, useState } from 'react'
import type { RunRow, TicketPageView, TicketRow } from './api.ts'
import { usePoll } from './api.ts'
import { Avatar, Icon } from './controls.tsx'
import type { AvatarState, IconName } from './controls.tsx'
import { runAvatarStateOf } from './team-kit.tsx'
import { ticketMark } from './marks.ts'
import { usePanel } from './provider.tsx'
import { localized, valueLabel, type T } from './text.ts'
import { Section, SessionButton, When } from './widgets.tsx'

/** A measured span of a node: `live` when its end is still open, so the card shows it counting from now. */
interface NodeSpan { from: string; to?: string; live?: boolean }
interface NodeAttachment { name: string; url?: string; kind: 'image' | 'link' }
/** One step of the track; `state` drives dot, plate and edge colours. */
interface Step { key: string; label: string; icon: 'inbox' | 'decision' | 'review' | 'queue' | 'running' | 'stop' | 'ask'
  state: 'done' | 'working' | 'waiting'; body: string[]; duration?: NodeSpan; input: string[]; output: string[]; attachments: NodeAttachment[] }

/** A node's text, flattened and capped so the detail card stays readable without measuring the message. */
const excerpt = (text: string | undefined, max = 400): string[] => {
  const flat = text?.replace(/\s+/g, ' ').trim() ?? ''
  return flat ? [flat.length > max ? `${flat.slice(0, max)}…` : flat] : []
}
const channelLinks = (t: T, ticket: TicketPageView | undefined): NodeAttachment[] =>
  (ticket?.channels ?? []).flatMap(channel => channel.url
    ? [{ name: localized(t, channel.label), url: channel.url, kind: 'link' as const }] : [])
const mergeLinks = (...groups: NodeAttachment[][]): NodeAttachment[] => {
  const merged = new Map<string, NodeAttachment>()
  for (const item of groups.flat()) merged.set(item.url ?? `name:${item.name}`, item)
  return [...merged.values()]
}

function steps(t: T, ticket: TicketPageView | undefined, row: TicketRow | undefined,
  rules: Record<string, string>): Step[] {
  const source = ticket?.channels?.[0]
  const matched = ticket?.mandate?.basis?.rules ?? []
  const ruleNames = matched.map(id => rules[id] ?? id)
  const decision = ticket?.decision
  const ended = ticket?.ended
  const origin = ticket?.origin
  const strength = t(ticket?.mandate?.strength === 'inferred' ? 'strength.inferred' : 'strength.explicit')
  const actor = ticket?.mandate?.actor?.id
  const title = ticket?.title ?? row?.title ?? '—'
  const mark = row ? ticketMark(t, row).label : ''
  const assignment = ticket?.assignments?.[0]
  const count = Array.isArray(ticket?.assignments) ? ticket.assignments.length : row?.assignments ?? 0
  const outcome = decision ? valueLabel(t, 'decision', decision.outcome) : '—'
  const message = origin?.text ? excerpt(origin.text) : excerpt(row?.threads[0]?.title)
  const files = origin?.attachments ?? []
  const channels = channelLinks(t, ticket)
  return [
    { key: 'source', label: t('chainSource'), icon: 'inbox', state: 'done', body: [source?.label ? localized(t, source.label) : row?.threads[0]?.source ?? '—',
      ...source?.url ? [source.url] : []],
      // From the message's arrival to the verdict, which is how long intake and assessment took together.
      duration: origin?.at ? { from: origin.at, to: decision?.at, live: !decision?.at } : undefined,
      input: message,
      output: [source?.label ? localized(t, source.label) : row?.threads[0]?.source ?? '—', ...row?.threads[0]?.key ? [row.threads[0].key] : []],
      attachments: mergeLinks(files, channels) },
    { key: 'eval', label: t('chainEval'), icon: 'review', state: 'done', body: [strength, ...ruleNames.length ? [ruleNames.join(' · ')] : []],
      duration: origin?.at ? { from: origin.at, to: decision?.at, live: !decision?.at } : undefined,
      input: message, output: [strength, ...ruleNames.length ? [ruleNames.join(' · ')] : []], attachments: files },
    { key: 'decision', label: t('chainDecision'), icon: 'decision', state: 'done', body: [outcome, ...actor ? [actor] : []],
      duration: decision?.at ? { from: decision.at, to: ticket?.createdAt, live: !ticket?.createdAt } : undefined,
      input: [ruleNames.length ? ruleNames.join(' · ') : strength],
      output: [outcome, ...actor ? [actor] : []], attachments: [] },
    { key: 'ticket', label: t('term.ticket'), icon: 'queue', state: 'done', body: [title, ...mark ? [mark] : []],
      duration: ticket?.createdAt ? { from: ticket.createdAt, to: assignment?.startedAt ?? ended?.at,
        live: !assignment?.startedAt && !ended } : undefined,
      input: [outcome], output: [title, ...mark ? [mark] : []], attachments: channels },
    { key: 'executor', label: t('term.executor'), icon: 'running',
      state: ended ? 'done' : row?.stage === 'person' ? 'waiting' : 'working',
      body: [t('chainAssignments', { count }),
      ...ticket?.summary ? [ticket.summary.replace(/\s+/g, ' ').slice(0, 160) + (ticket.summary.length > 160 ? '…' : '')] : []],
      duration: assignment?.createdAt ? { from: assignment.createdAt, to: assignment.endedAt ?? ended?.at,
        live: !assignment.endedAt && !ended } : undefined,
      input: [title], output: [t('chainAssignments', { count }), ...ticket?.summary ? [ticket.summary] : []], attachments: channels },
    { key: 'end', label: t('chainEnd'), icon: ended ? 'stop' : 'ask', state: ended ? 'done' : 'waiting', body: [ended ? valueLabel(t, 'outcome', ended.outcome)
      : ticket?.attention?.question ?? t('stage.working')],
      duration: ticket?.createdAt ? { from: ticket.createdAt, to: ended?.at, live: !ended } : undefined,
      input: excerpt(ticket?.summary),
      output: [ended ? valueLabel(t, 'outcome', ended.outcome) : ticket?.attention?.question ?? t('stage.working')],
      attachments: channels },
  ]
}

/** Cuts text to the widest string that fits a node without measuring, so the SVG stays static. */
const clip = (text: string, max: number): string => text.length > max ? text.slice(0, Math.max(0, max - 1)) + '…' : text
/** One run's state label, typed so the locale key is checked. */
const stateLabel = (t: T, state: RunRow['state']): string => t(state === 'running' ? 'runState.running' : state === 'waiting' ? 'runState.waiting'
  : state === 'queued' ? 'runState.queued' : 'runState.ended')

type GStatus = 'done' | 'working' | 'waiting'
type GEdgeState = GStatus | 'active'
/** One node of the layered DAG; `run` groups it with a track so hover can dim the other tracks. */
interface GNode { id: string; stepKey: string; label: string; sub: string; status: GStatus; kind: string; run: string
  x: number; y: number; num: string; icon?: IconName; color?: string; image?: string | null; name?: string; avatarState?: AvatarState
  duration?: NodeSpan; input: string[]; output: string[]; attachments: NodeAttachment[] }
interface GEdge { id: string; from: string; to: string; state: GEdgeState; run: string }
interface GLane { run: string; label: string; y: number }
interface Graph { nodes: GNode[]; edges: GEdge[]; lanes: GLane[]; height: number; ticketId: string; live: number }

const WIDTH = 1080
const HEIGHT = 520
/* Track labels live in a left gutter, so no row of a multi-run Ticket can print over the shared Source node. */
const GUTTER_X = 20
const SHARED_X = [180, 296, 412, 528]
const LANE_X = [648, 764, 880]
const END_X = 1012
const CENTER_Y = 260
const laneYs = (count: number): number[] => count === 2 ? [170, 350] : count === 3 ? [110, 260, 410]
  : count >= 4 ? [80, 200, 320, 440] : [CENTER_Y]
const edgeStateOf = (status: GStatus): GEdgeState => status === 'working' ? 'active' : status
const statusText = (t: T, status: GStatus): string =>
  t(status === 'done' ? 'chainStatusDone' : status === 'working' ? 'chainStatusWorking' : 'chainStatusWaiting')
/** Formats a node's span from its start to its end, or to now while it is still open. */
function durationText(t: T, span: NodeSpan): string {
  const from = Date.parse(span.from)
  const to = span.to ? Date.parse(span.to) : Date.now()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '—'
  const seconds = Math.max(0, Math.floor((to - from) / 1000))
  const text = seconds < 60 ? t('chainDurationSec', { n: seconds })
    : seconds < 3600 ? t('chainDurationMin', { m: Math.floor(seconds / 60), s: seconds % 60 })
      : seconds < 86_400 ? t('chainDurationHour', { h: Math.floor(seconds / 3600), m: Math.floor(seconds % 3600 / 60) })
        : t('chainDurationDay', { d: Math.floor(seconds / 86_400), h: Math.floor(seconds % 86_400 / 3600) })
  return span.live ? t('chainDurationLive', { span: text }) : text
}

/**
 * Builds the preview's layered DAG: the shared Trigger / Eval / Decision / Ticket line, one lane per Assignment, and the
 * deliver node where the lanes converge. Without runs the lane still shows the Executor's pending Assignment, Worker and Report.
 */
function graphOf(t: T, track: Step[], ticketId: string, rows: TicketRow[], runs: RunRow[]): Graph {
  const nodes: GNode[] = []
  const edges: GEdge[] = []
  const lanes: GLane[] = []
  const shared = track.slice(0, 4)
  shared.forEach((step, index) => nodes.push({
    id: step.key, stepKey: step.key, label: step.label,
    sub: clip(step.key === 'ticket' ? track[4]?.body[0] ?? '' : step.body[0] ?? '', 18),
    status: step.state, kind: step.key, run: 'shared', x: SHARED_X[index] ?? 80, y: CENTER_Y,
    num: String(index).padStart(2, '0'), icon: step.icon,
    duration: step.duration, input: step.input, output: step.output, attachments: step.attachments,
  }))
  shared.slice(0, -1).forEach((step, index) =>
    edges.push({ id: `shared-${index}`, from: step.key, to: shared[index + 1]!.key, state: 'done', run: 'shared' }))
  const own = runs.filter(run => run.ticketId === ticketId).sort((a, b) => a.number - b.number).slice(0, 4)
  const ys = laneYs(Math.max(own.length, 1))
  const executor = track[4]
  const end = track[5]
  const endStatus: GStatus = end?.state ?? 'waiting'
  if (!own.length) {
    const y = ys[0]!
    lanes.push({ run: 'pending', label: t('chainNoRuns'), y })
    const assignStatus: GStatus = endStatus === 'done' ? 'done' : 'waiting'
    const reportStatus: GStatus = endStatus === 'done' ? 'done' : 'waiting'
    nodes.push(
      { id: 'pending-assign', stepKey: 'executor', label: t('chainAssignment'), sub: clip(executor?.body[0] ?? '', 18), status: assignStatus,
        kind: 'assignment', run: 'pending', x: LANE_X[0]!, y, num: '10', icon: 'queue', input: executor?.input ?? [],
        output: [t('chainAssignment'), statusText(t, assignStatus)], attachments: [] },
      { id: 'pending-worker', stepKey: 'executor', label: executor?.label ?? '', sub: clip(executor?.body[0] ?? '', 18),
        status: executor?.state ?? 'waiting', kind: 'executor', run: 'pending', x: LANE_X[1]!, y, num: '11', icon: 'running',
        input: executor?.input ?? [], output: executor?.output ?? [], attachments: [] },
      { id: 'pending-report', stepKey: 'executor', label: t('chainReport'), sub: clip(end?.body[0] ?? t('chainReportPending'), 18),
        status: reportStatus, kind: 'report', run: 'pending', x: LANE_X[2]!, y, num: '12', icon: 'review',
        input: [t('chainReportPending')], output: end?.output ?? [], attachments: [] },
    )
    edges.push(
      { id: 'pending-0', from: 'ticket', to: 'pending-assign', state: edgeStateOf(assignStatus), run: 'pending' },
      { id: 'pending-1', from: 'pending-assign', to: 'pending-worker', state: edgeStateOf(executor?.state ?? 'waiting'), run: 'pending' },
      { id: 'pending-2', from: 'pending-worker', to: 'pending-report', state: edgeStateOf(reportStatus), run: 'pending' },
      { id: 'pending-3', from: 'pending-report', to: 'end', state: endStatus, run: 'pending' },
    )
  }
  own.forEach((run, index) => {
    const y = ys[index]!
    lanes.push({ run: run.id, label: clip(`#${run.number} · ${run.profileName ?? t('chainNoProfile')}`, 16), y })
    const assign: GStatus = run.state === 'queued' ? 'waiting' : 'done'
    const worker: GStatus = run.state === 'running' ? 'working' : run.state === 'queued' || run.state === 'waiting' ? 'waiting' : 'done'
    const report: GStatus = run.state === 'ended' ? 'done' : 'waiting'
    const state = stateLabel(t, run.state)
    const files = run.attachments ?? []
    nodes.push(
      { id: `${run.id}-assign`, stepKey: 'executor', label: t('chainAssignment'),
        sub: clip(run.slot ? t('chainSlot', { slot: run.slot }) : state, 18), status: assign, kind: 'assignment', run: run.id,
        x: LANE_X[0]!, y, num: `${index + 1}1`, icon: 'queue',
        duration: { from: run.createdAt, to: run.startedAt ?? run.endedAt, live: !run.startedAt && !run.endedAt },
        input: [`#${run.number}`, run.title], output: [state, ...run.slot ? [t('chainSlot', { slot: run.slot })] : []], attachments: [] },
      { id: `${run.id}-worker`, stepKey: 'executor', label: run.profileName ?? t('chainNoProfile'), sub: clip(state, 18),
        status: worker, kind: 'worker', run: run.id, x: LANE_X[1]!, y, num: `${index + 1}2`, color: run.avatar?.color,
        image: run.avatar?.image, name: run.profileName, avatarState: runAvatarStateOf(run, rows),
        duration: run.startedAt ? { from: run.startedAt, to: run.endedAt, live: !run.endedAt && run.state !== 'ended' } : undefined,
        input: [`#${run.number}`, run.title], output: [run.report?.summary || state, ...run.sessionId ? [run.sessionId] : []], attachments: files },
      { id: `${run.id}-report`, stepKey: 'executor', label: t('chainReport'),
        sub: clip(run.report?.summary || (run.report ? run.report.state : t('chainReportPending')), 18), status: report,
        kind: 'report', run: run.id, x: LANE_X[2]!, y, num: `${index + 1}3`, icon: 'review',
        duration: { from: run.startedAt ?? run.createdAt, to: run.report ? run.updatedAt : run.endedAt,
          live: !run.report && !run.endedAt && run.state !== 'ended' },
        input: [state], output: [run.report?.summary || t('chainReportPending'),
          ...run.report ? [valueLabel(t, 'report', run.report.state)] : []], attachments: files },
    )
    edges.push(
      { id: `e-${run.id}-0`, from: 'ticket', to: `${run.id}-assign`, state: edgeStateOf(assign), run: run.id },
      { id: `e-${run.id}-1`, from: `${run.id}-assign`, to: `${run.id}-worker`, state: edgeStateOf(worker), run: run.id },
      { id: `e-${run.id}-2`, from: `${run.id}-worker`, to: `${run.id}-report`, state: report === 'done' ? 'done' : 'waiting', run: run.id },
      { id: `e-${run.id}-3`, from: `${run.id}-report`, to: 'end', state: endStatus, run: run.id },
    )
  })
  nodes.push({ id: 'end', stepKey: 'end', label: end?.label ?? '', sub: clip(end?.body[0] ?? '', 18), status: endStatus,
    kind: 'end', run: 'shared', x: END_X, y: CENTER_Y, num: '99', icon: end?.icon, duration: end?.duration,
    input: end?.input ?? [], output: end?.output ?? [], attachments: end?.attachments ?? [] })
  return { nodes, edges, lanes, height: HEIGHT, ticketId, live: own.filter(run => run.state !== 'ended').length }
}

/** True when this panel should run quiet: the graph then starts with its flow, scan and particles off. */
const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const nodeLines = (lines: string[]) => lines.length
  ? lines.map((line, at) => <span key={at} className="dt-node-line">{line}</span>)
  : <span className="dt-node-line">—</span>

export function ChainPage({ initial }: { initial?: string }) {
  const { t, call } = usePanel()
  const [selected, setSelected] = useState<string | undefined>(initial)
  const [picked, setPicked] = useState<string>()
  const [flow, setFlow] = useState(() => !prefersReducedMotion())
  // A link from a Source's message history picks that Ticket even while this page is already mounted.
  useEffect(() => { if (initial) { setSelected(initial); setPicked(undefined) } }, [initial])
  const { data, error } = usePoll(() => Promise.all([call('GET tickets', { query: { state: 'open', limit: 100 } }),
    call('GET tickets', { query: { state: 'ended', limit: 10 } }), call('GET settings')])
    .then(([open, ended, settings]) => ({ rows: [...open.items, ...ended.items], settings })), [call], 5000)
  const detail = usePoll(() => selected ? call('GET tickets/:id', { id: selected }) : Promise.resolve(undefined as TicketPageView | undefined), [call, selected], 5000)
  const runs = usePoll(() => call('GET runs'), [call], 5000)
  if (!data) return error ? <p className="dt-error" role="alert">{error.message}</p> : <p className="dt-hint">{t('loading')}</p>
  const rules: Record<string, string> = Object.fromEntries(settingsRules(data.settings).map(rule => [rule.id, rule.name]))
  const row = data.rows.find(item => item.id === selected)
  const track = selected ? steps(t, detail.data, row, rules) : []
  const graph = selected ? graphOf(t, track, selected, data.rows, runs.data?.runs ?? []) : undefined
  const lanes = (runs.data?.runs ?? []).filter(run => run.state !== 'ended')
  const current = graph ? graph.nodes.find(item => item.id === picked) ?? graph.nodes.find(item => item.status === 'working')
    ?? graph.nodes.find(item => item.status === 'waiting' && (item.kind === 'executor' || item.kind === 'worker'))
    ?? graph.nodes.find(item => item.status === 'waiting' && item.run !== 'shared')
    ?? graph.nodes.find(item => item.id === 'end') ?? graph.nodes.at(-1) : undefined
  return <>
    {lanes.length > 0 && <Section title={t('chainRuns')} count={lanes.length} hint={t('chainRunsHint')}>
      <ul className="dt-run-list">{lanes.map(run => <li key={run.id} className="dt-run-row" data-state={run.state}>
        <span className="dt-run-num">#{run.number}</span>
        <Avatar name={run.profileName} color={run.avatar?.color} image={run.avatar?.image} size={18} state={runAvatarStateOf(run, data.rows)} />
        <span className="dt-run-profile">{run.profileName ?? t('chainNoProfile')}</span>
        <span className="dt-run-ticket">{run.title}</span>
        <span className="dt-run-state">{t(`runState.${run.state}`)}{run.slot ? ` · ${t('chainSlot', { slot: run.slot })}` : ''}</span>
        <span className="dt-run-age"><When at={run.updatedAt} /></span>
        {run.sessionId && <SessionButton variant="ghost" sessionId={run.sessionId} />}
      </li>)}</ul>
    </Section>}
    <Section title={t('chainTickets')} count={data.rows.length} hint={t('chainHint')}>
      {data.rows.length ? <ul className="dt-chain-list">{data.rows.map(item => {
        const mark = ticketMark(t, item)
        return <li key={item.id}>
          <button type="button" className={item.id === selected ? 'dt-chain-row is-active' : 'dt-chain-row'}
            aria-pressed={item.id === selected} onClick={() => { setSelected(item.id); setPicked(undefined) }}>
            <span className="dt-chain-row-mark" data-state={mark.dot}><Icon name={mark.icon} size={12} /></span>
            <span className="dt-chain-row-title">{item.title}</span>
            <span className="dt-chain-row-stage">{mark.label}</span>
            <span className="dt-chain-row-age"><When at={item.updatedAt} /></span>
          </button>
        </li>
      })}</ul> : <p className="dt-team-empty">{t('chainEmpty')}</p>}
    </Section>
    {selected && <Section title={t('chainTrack')} hint={t('chainTrackHint')}
      action={<span className="dt-chain-switch">
          <span className="dt-chain-viewmode">{t('chainGraphView')}</span>
          <button type="button" className={flow ? 'is-active' : ''} aria-pressed={flow}
            onClick={() => setFlow(!flow)}>{flow ? t('chainFlowOn') : t('chainFlowOff')}</button>
        </span>}>
      {detail.error && <p className="dt-error" role="alert">{detail.error.message}</p>}
      {!detail.data && !detail.error && <p className="dt-hint">{t('loading')}</p>}
      {detail.data && <div className="dt-chain-two">
        <div className="dt-chain-main">
          {graph && <ChainGraph graph={graph} picked={picked} flow={flow} onPick={node => setPicked(node.id)} />}
        </div>
        <aside className="dt-chain-inspector dt-node-detail" aria-label={t('chainNodeDetail')}>
          <div className="dt-inspector-head">
            <Avatar size={36} icon={current?.kind === 'worker' ? undefined : current?.icon}
              name={current?.name ?? current?.label} color={current?.color} image={current?.image}
              state={current?.avatarState} />
            <div className="dt-inspector-identity">
              <p className="dt-chain-eyebrow">{t('chainNodeDetail')}</p>
              <h3>{current?.label ?? t('chainNodeEmpty')}</h3>
              <p>{current ? statusText(t, current.status) : t('chainNodeHint')}</p>
            </div>
          </div>
          {current ? <>
            <div className="dt-inspector-metrics">
              <span><b>{statusText(t, current.status)}</b><small>{t('chainNodeStatus')}</small></span>
              <span><b className="dt-mono">{current.run === 'shared' ? t('chainSharedRun') : current.run}</b><small>{t('chainNodeRun')}</small></span>
              <span><b className="dt-mono">{current.duration ? durationText(t, current.duration) : '—'}</b><small>{t('chainNodeDuration')}</small></span>
            </div>
            <section className="dt-inspector-block" data-section="received">
              <h4>{t('chainNodeInput')}</h4>
              <div className="dt-node-lines">{nodeLines(current.input)}</div>
            </section>
            <section className="dt-inspector-block" data-section="produced">
              <h4>{t('chainNodeOutput')}</h4>
              <div className="dt-node-lines">{nodeLines(current.output)}</div>
            </section>
            <section className="dt-inspector-block" data-section="evidence">
              <h4>{t('chainNodeAttachments')}</h4>
              {current.attachments.length ? <div className="dt-node-attachments">{current.attachments.map((item, at) => item.url
                ? <a key={at} className="dt-node-attach" href={item.url} target="_blank" rel="noreferrer noopener" title={item.url}>
                  <Icon name={item.kind === 'image' ? 'detail' : 'external'} size={11} /><span>{item.name}</span></a>
                : <span key={at} className="dt-node-attach" title={item.name}>
                  <Icon name="detail" size={11} /><span>{item.name}</span></span>)}</div>
                : <span className="dt-hint">{t('chainNodeNoAttachments')}</span>}
            </section>
            <p className="dt-inspector-ticket">{t('ticketId')}：<span className="dt-mono">{selected}</span></p>
          </> : <p className="dt-hint">{t('chainNodeEmpty')}</p>}
        </aside>
      </div>}
      <div className="dt-glegend" aria-hidden="true">
        <span><i data-tone="run" />{t('chainLegendRun')}</span>
        <span><i data-tone="done" />{t('chainLegendDone')}</span>
        <span><i data-tone="wait" />{t('chainLegendWait')}</span>
        <span><i data-tone="run" />{t('chainLegendAvatar')}</span>
        <span className="dt-mono">{t('chainLegendNote')}</span>
      </div>
    </Section>}
  </>
}

/** One curved edge from a node's centre to the next node's centre, matching the preview's `curve()`. */
const curve = (a: GNode, b: GNode): string =>
  `M${a.x} ${a.y} C${(a.x + b.x) / 2} ${a.y} ${(a.x + b.x) / 2} ${b.y} ${b.x} ${b.y}`

/** The original layered graph, with richer cards in place of its small avatar plates. */
function ChainGraph({ graph, picked, flow, onPick }: { graph: Graph; picked?: string; flow: boolean; onPick: (node: GNode) => void }) {
  const { t } = usePanel()
  const [hover, setHover] = useState<string>()
  const [focused, setFocused] = useState<string>()
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const focus = hover ?? focused ?? byId.get(picked ?? '')?.run
  const dim = (run: string): boolean => !!focus && run !== focus && run !== 'shared'
  const pick = (node: GNode) => { setFocused(node.run); onPick(node) }
  return <div className="dt-graph-scroll">
    <svg className="dt-graph" viewBox={`0 0 ${WIDTH} ${graph.height}`} role="img" aria-label={t('chainGraphAlt')}
      data-flow={flow ? 'on' : 'off'}>
      <defs>
        <pattern id="dt-g-grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" className="dt-ggrid" /></pattern>
        <radialGradient id="dt-g-glow"><stop offset="0" style={{ stopColor: 'var(--dt-accent)', stopOpacity: 0.11 }} /><stop offset="1" style={{ stopColor: 'var(--dt-accent)', stopOpacity: 0 }} /></radialGradient>
      </defs>
      <rect width={WIDTH} height={graph.height} fill="url(#dt-g-grid)" />
      <ellipse cx={WIDTH / 2} cy={CENTER_Y} rx="450" ry="235" className="dt-glow" />
      <text className="dt-gmeta" x="18" y="24">{t('chainGraphMeta', { scope: graph.ticketId.slice(0, 12), width: WIDTH, height: graph.height })}</text>
      <text className="dt-gmeta" x={WIDTH - 18} y="24" textAnchor="end">{t('chainGraphLive', { count: graph.live })}</text>
      {graph.lanes.map(lane => <text key={lane.run} className="dt-gtrack" x={GUTTER_X} y={lane.y + 4} role="button" tabIndex={0}
        onMouseDown={event => event.preventDefault()}
        onClick={() => setFocused(lane.run === focused ? undefined : lane.run)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setFocused(lane.run === focused ? undefined : lane.run) } }}>
        {lane.label}</text>)}
      {graph.edges.map(edge => {
        const from = byId.get(edge.from)
        const to = byId.get(edge.to)
        if (!from || !to) return null
        const d = curve(from, to)
        return <g key={edge.id} className={dim(edge.run) ? 'is-dim' : undefined}>
          <path id={edge.id} className="dt-gedge" data-state={edge.state} data-run={edge.run} d={d} />
          {(edge.state === 'done' || edge.state === 'active') &&
            <path className={`dt-gflow ${edge.state === 'active' ? 'is-active' : 'is-idle'}`} data-run={edge.run} d={d} />}
          {edge.state === 'active' && flow && <circle className="dt-gparticle" r="3" data-run={edge.run}>
            <animateMotion dur="2.6s" repeatCount="indefinite"><mpath href={`#${edge.id}`} /></animateMotion>
          </circle>}
        </g>
      })}
      {graph.nodes.map(node => <g key={node.id}
        className={`dt-gnode${node.id === picked ? ' is-picked' : ''}${dim(node.run) ? ' is-dim' : ''}`}
        data-id={node.id} data-run={node.run} data-status={node.status}
        onMouseDown={event => event.preventDefault()}
        onMouseEnter={() => setHover(node.run)} onMouseLeave={() => setHover(undefined)}>
        <circle className="dt-g-halo" cx={node.x} cy={node.y} r="30" />
        <foreignObject className="dt-gnode-cardbox" x={node.x - 54} y={node.y - 38} width="108" height="76">
          <button type="button" className="dt-gnode-card" data-id={node.id} data-kind={node.kind} data-status={node.status}
            data-picked={node.id === picked ? 'true' : undefined} aria-pressed={node.id === picked}
            aria-label={`${node.label} ${node.sub}`} title={node.input.join(' · ')} onClick={() => pick(node)}>
            <span className="dt-gnode-head">
              <span className="dt-gnode-icon"><Avatar size={24} icon={node.kind === 'worker' ? undefined : node.icon}
                name={node.name ?? node.label} color={node.color} image={node.image} state={node.avatarState} /></span>
              <span className="dt-gnode-label">{clip(node.label, 12)}</span>
              <span className="dt-gnode-num">{node.num}</span>
            </span>
            <strong className="dt-gnode-main">{clip(node.sub, 20)}</strong>
            <span className="dt-gnode-foot">
              <span data-state={node.status}>{statusText(t, node.status)}</span>
              {node.duration && <span>{durationText(t, node.duration)}</span>}
            </span>
          </button>
        </foreignObject>
      </g>)}
    </svg>
  </div>
}

/** Rule ids and names from the settings view, so a chain can name the rules that accepted a Ticket. */
function settingsRules(settings: unknown): { id: string; name: string }[] {
  const blocks = (settings as { blocks?: { policy?: { rules?: unknown } } } | undefined)?.blocks
  const rules = blocks?.policy?.rules
  if (!Array.isArray(rules)) return []
  return rules.flatMap(rule => {
    const value = rule as { id?: unknown; name?: unknown }
    return typeof value.id === 'string' && typeof value.name === 'string' ? [{ id: value.id, name: value.name }] : []
  })
}

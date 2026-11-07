/** Per-Source cards: each one's live state inside the card, the scan that connects it, and its settings behind a press on the card. */
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { FieldSpec } from '../sources/kind.ts'
import { usePoll, type DroppedReply, type SentMessageRow, type SourceStatusRow, type SourceView } from './api.ts'
import { Button, DisclosureRow, Dot, Drawer, Icon, InfoTip, Modal, Switch, Tag } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { DingTalkConnect } from './dingtalk-connect.tsx'
import { FeishuConnect } from './feishu-connect.tsx'
import { sourceMark } from './marks.ts'
import { usePanel, usePanelData } from './provider.tsx'
import { settingsRoute, setupPage, type Route } from './route.ts'
import { ConfigHistory, Fields, SettingsProvider, SourceField, useBlockDraft, useSettings } from './settings-kit.tsx'
import { actorName, healthText, localized, readableMarkers, reasonLabel, valueLabel, when, type T } from './text.ts'
import { CheckSetupButton, Hint, LabelValue, LoadState, SetupMessage, StatusHead, When } from './widgets.tsx'

/** The saved value of one field as text: the choice's own words, a resolved label, and never a secret. */
function fieldText(t: T, spec: FieldSpec, source: SourceView): ReactNode {
  const value = source.value.config[spec.key]
  const missing = value === undefined || value === null || value === ''
  switch (spec.type) {
    case 'switch': return value === true ? t('yes') : t('no')
    case 'fact': return localized(t, source.facts[spec.key]) || t('empty')
    case 'select': {
      const option = spec.options.find(item => item.value === String(missing ? spec.options[0]!.value : value))
      return option ? localized(t, option.label) : t('unsetValue')
    }
    case 'number': return missing ? t('unsetValue') : String(value)
    case 'text': {
      if (spec.secret) return missing ? t('unsetValue') : t('sourceSecretSaved')
      return missing ? t('unsetValue') : source.labels[String(value)] ?? String(value)
    }
    case 'rows': {
      const rows = Array.isArray(value) ? value as Record<string, string>[] : []
      if (!rows.length) return t('empty')
      const key = spec.columns[0]!.key
      const named = spec.columns[1]?.type === 'text' ? spec.columns[1].key : undefined
      return rows.map(row => (named ? row[named] : '') || source.labels[row[key] ?? ''] || row[key] || t('empty'))
        .join(t('listSeparator'))
    }
  }
}

/** What the Source keeps, without any inputs: its switch and each field's saved value. */
function SourceDetail({ source }: { source: SourceView }) {
  const { t } = usePanel()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const row = (spec: FieldSpec) => <Fragment key={spec.key}>
    <dt>{localized(t, spec.label)}</dt><dd>{fieldText(t, spec, source)}</dd>
  </Fragment>
  const advanced = source.fields.filter(spec => spec.advanced)
  return <div className="dt-source-detail">
    <dl className="dt-kv">
      <dt>{t('sourceRunningLabel')}</dt><dd>{source.value.enabled ? t('yes') : t('no')}</dd>
      {source.fields.filter(spec => !spec.advanced).map(row)}
    </dl>
    {advanced.length > 0 && <DisclosureRow icon={<Icon name="settings" />} title={t('advanced')} open={advancedOpen}
      onToggle={() => setAdvancedOpen(!advancedOpen)}>
      <div className="dt-disclosure-body"><dl className="dt-kv">{advanced.map(row)}</dl></div>
    </DisclosureRow>}
    <p className="dt-hint">{t('sourceSavedRevision', { revision: source.revision })}</p>
  </div>
}

/**
 * The editable settings of one Source: its switch, its kind's fields, and the save. The Settings tab puts it on a
 * card and the Source card puts it in a dialog, so both read and write the same block.
 */
function SourceForm({ source, id, className = 'dt-card' }: { source: SourceView; id?: string; className?: string }) {
  const { t, call } = usePanel()
  const { running } = usePanelData()
  const { reload } = useSettings()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const refreshLabels = async () => { const { added } = await call('POST sources/:id/labels', { id: source.id }); await reload(); return added }
  const draft = useBlockDraft(`source:${source.id}`, source.value, source.revision)
  const value = draft.value
  const { problem, value: saved } = source
  const changed = (key: string) => String(value.config[key] ?? '') !== String(saved.config[key] ?? '')
  // Saving a modified setup-sensitive field restarts dsh-superagent-plus, interrupting running Assignments.
  const restarts = draft.dirty && source.restarts.some(changed)
  const description = localized(t, source.description)
  // Hide derived facts for unsaved field edits until the new value is saved.
  const field = (spec: FieldSpec) => <SourceField key={spec.key} field={spec} value={value.config[spec.key]} saved={saved.config[spec.key]}
    labels={source.labels}
    refreshLabels={refreshLabels} fact={spec.type === 'fact' || !changed(spec.key) ? source.facts[spec.key] : undefined}
    onChange={next => draft.edit({ ...value, config: { ...value.config, [spec.key]: next } })} />
  const advanced = source.fields.filter(spec => spec.advanced)
  return <form id={id} className={className} onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <div className="dt-card-head">
        <div className="dt-row-main">
          <div className="dt-row-title">
            <span className="dt-card-title">{localized(t, source.title)}</span>{description && <InfoTip text={description} />}
            {!source.installed && <Tag tone="warning">{t('sourceNotInstalled')}</Tag>}
          </div>
        </div>
        {source.installed && <Switch checked={value.enabled} onChange={enabled => draft.edit({ ...value, enabled })}
          label={t('sourceEnable', { name: localized(t, source.title) })} />}
      </div>
      {problem && <div className="dt-row-buttons">
        <p className="dt-error" role="status"><SetupMessage problem={problem} lead /></p><CheckSetupButton />
      </div>}
      {!source.installed && <Hint>{t('sourceNotInstalledHint')}</Hint>}
      {source.installed && source.fields.filter(spec => !spec.advanced).map(field)}
      {source.installed && advanced.length > 0 && <DisclosureRow icon={<Icon name="settings" />} title={t('advanced')} open={advancedOpen}
        onToggle={() => setAdvancedOpen(!advancedOpen)}>
        <div className="dt-disclosure-body">{advanced.map(field)}</div>
      </DisclosureRow>}
    </Fields>
    <SaveBar {...draft} status={restarts && running > 0 ? t('restartInterrupts', { count: running }) : undefined}
      onDiscard={draft.discard} />
  </form>
}

/**
 * Whether the Source plugins are still attaching. Each kind registers itself after dsh-superagent's own routes answer, so a
 * moment with no installed kind is a startup step; showing its stored Sources as uninstalled would read as data loss.
 * The moment lasts a poll or two, so it is only reported as starting until a quarter minute has passed without any kind.
 */
function useSourcesStarting(rows: readonly { installed: boolean }[] | undefined): boolean {
  const [expired, setExpired] = useState(false)
  const settled = !!rows?.some(row => row.installed)
  useEffect(() => { if (settled) setExpired(false) }, [settled])
  const starting = !!rows && !settled && !expired
  useEffect(() => {
    if (!starting) return
    const timer = setTimeout(() => setExpired(true), 15_000)
    return () => clearTimeout(timer)
  }, [starting])
  return starting
}

export function SourceSettings({ focus }: { focus?: string }) {
  const { t } = usePanel()
  const { sources } = useSettings().settings
  const starting = useSourcesStarting(sources)
  useEffect(() => { if (focus) document.getElementById(`dt-source-${focus}`)?.scrollIntoView?.({ block: 'start' }) }, [focus, starting])
  return <div className="dt-form">
    {starting ? <Hint>{t('loading')}</Hint> : <>
      {sources.map(source => <SourceForm key={source.id} id={`dt-source-${source.id}`} source={source} />)}
      <ConfigHistory blocks={['source:']} />
    </>}
  </div>
}

function DroppedReplies({ items }: { items: DroppedReply[] }) {
  const { t, navigate } = usePanel()
  const [open, setOpen] = useState(false)
  // Link to the message's Ticket, or fall back to its Thread for messages queued before receipts recorded `ticketId`.
  const target = (item: DroppedReply): { route: Route; name: string } | undefined => item.ticket
    ? { route: { page: 'execution', id: item.ticket.id }, name: item.ticket.title }
    : item.thread ? { route: { page: 'trigger', id: item.thread }, name: t('term.thread') } : undefined
  return <DisclosureRow icon={<Icon name="dismiss" />} title={<>{t('sourceDroppedTitle')} <span
    className="dt-count">{items.length}</span></>} open={open}
    onToggle={() => setOpen(!open)}>
    <div className="dt-disclosure-body">
      <Hint>{t('sourceDroppedHint')}</Hint>
      <ul className="dt-list">{items.map(item => {
        const link = target(item)
        return <li key={item.id} className="dt-row"><Dot state="idle" /><div className="dt-row-main">
          <div className="dt-row-title dt-line">{readableMarkers(t, item.preview) || t('empty')}</div>
          <div className="dt-row-meta">
            <Tag tone="neutral">{reasonLabel(t, item.dropped.reason)}</Tag><When at={item.dropped.at} />
            {link && <button type="button" className="dt-textlink" onClick={() => navigate(link.route)}>{link.name}</button>}
          </div>
        </div></li>
      })}</ul>
    </div>
  </DisclosureRow>
}

/** The Source's settled messages as a timeline; a message with a Ticket opens that Ticket's chain. */
function SourceMessages({ source, title, onClose }: { source: string; title: string; onClose: () => void }) {
  const { t, call, navigate } = usePanel()
  const { data, error } = usePoll(() => call('GET sources/:id/messages', { id: source, query: { limit: 50 } }), [call, source], 10_000)
  const items = data?.items ?? []
  const open = (item: SentMessageRow) => {
    if (!item.ticket) return
    onClose()
    navigate({ page: 'chain', query: { ticket: item.ticket.id } })
  }
  return <Drawer open onClose={onClose} title={t('sourceMessagesTitle', { name: title })} closeLabel={t('close')}>
    <p className="dt-hint">{t('sourceMessagesHint')}</p>
    {error && <p className="dt-error" role="alert">{error.message}</p>}
    {!data && !error && <p className="dt-hint">{t('loading')}</p>}
    {data && (items.length ? <ol className="dt-track">{items.map((item, at) => {
      const last = at === items.length - 1
      return <li key={item.id} className="dt-track-step" data-state={item.status === 'dropped' ? 'waiting' : 'done'}
        data-last={last ? 'true' : undefined} role={item.ticket ? 'button' : undefined} tabIndex={item.ticket ? 0 : undefined}
        aria-label={item.ticket ? t('sourceMessagesOpen') : undefined} onClick={() => open(item)}
        onKeyDown={event => { if (item.ticket && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(item) } }}>
        <span className="dt-track-icon"><Icon name={item.status === 'dropped' ? 'dismiss' : 'message'} size={14} /></span>
        <span className="dt-track-label"><When at={item.at} /></span>
        <span className="dt-track-body">
          <span className="dt-track-main">{item.text || t('empty')}</span>
          <span className="dt-track-said">
            <Tag tone={item.status === 'dropped' ? 'warning' : 'success'}>{t(item.status === 'dropped' ? 'messageStatus.dropped'
              : 'messageStatus.sent')}</Tag>
            {item.ticket && <span>{item.ticket.title}</span>}
          </span>
        </span>
      </li>
    })}</ol> : <p className="dt-hint">{t('sourceMessagesEmpty')}</p>)}
  </Drawer>
}

/** The one action a card offers on its own: scan to connect, for the two kinds that are set up that way. */
const connectOf = (id: string) => id === 'feishu' ? <FeishuConnect /> : id === 'dingtalk' ? <DingTalkConnect /> : undefined

/** One Source as the panel shows it: its state and counts, the scan, and its settings behind a click on the card. */
function SourceCardView({ status, settings }: { status: SourceStatusRow; settings: SourceView }) {
  const { t, navigate } = usePanel()
  const { setup } = usePanelData()
  const card = useRef<HTMLElement>(null)
  const [detail, setDetail] = useState(false)
  const [edit, setEdit] = useState(false)
  const [messages, setMessages] = useState(false)
  const [filteredOpen, setFilteredOpen] = useState(false)
  const { dot, label: state } = sourceMark(t, status.state)
  const { received, filtered, lastAt } = status.stats
  // Omit healthy parts and suppress per-part notes when a setup problem already explains why the Source is stopped.
  const notes = status.enabled && !status.problem && !setup?.problem ? status.health.filter(item => item.state === 'error'
    || item.state === 'paused') : []
  const connect = connectOf(status.id)
  // A press anywhere outside the card folds the detail back, as the panel's other popovers do.
  useEffect(() => {
    if (!detail) return
    const fold = (event: PointerEvent) => {
      const target = event.target as Element
      if (!target.closest?.('.dt-modal-root, .dt-tooltip') && !card.current?.contains(target)) setDetail(false)
    }
    document.addEventListener('pointerdown', fold)
    return () => { document.removeEventListener('pointerdown', fold) }
  }, [detail])
  // The card opens its detail; its controls keep their separate meaning, and the click may not come from a dialog.
  const open = (event: MouseEvent) => {
    const target = event.target as Element
    if (!card.current?.contains(target)
      || target.closest?.('a, button, input, select, textarea, label, [role="button"], [role="switch"], [role="tab"]')) return
    setDetail(true)
  }
  return <section ref={card} className="dt-card dt-source-card" id={`dt-source-card-${status.id}`} data-detail={detail || undefined}
    tabIndex={0} aria-expanded={detail} onClick={open}
    onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetail(true) }
      else if (event.key === 'Escape') setDetail(false)
    }}>
    <div className="dt-source-head">
      <Dot state={dot} label={state} />
      <p className="dt-source-title">{localized(t, status.title)}</p>
      {localized(t, settings.description) && <InfoTip text={localized(t, settings.description)} />}
      <span className="dt-status-text" data-state={dot}>{state}</span>
    </div>
    <div className="dt-source-stats">
      {received > 0 && <LabelValue label={t('sourceReceivedLabel')} value={received} />}
      {filtered > 0 && <LabelValue label={t('sourceFilteredLabel')} value={filtered} />}
      {lastAt && <LabelValue label={t('sourceLatestLabel')} value={when(lastAt, t('lang'))} />}
    </div>
    {status.problem && <p className="dt-error" role="status">
      <SetupMessage problem={status.problem} lead /> <button type="button" className="dt-textlink"
        onClick={() => navigate(settingsRoute('source', { source: status.id }))}>{t('sourceOpenSettings')}</button>
    </p>}
    {!settings.installed && <Hint>{t('sourceNotInstalledHint')}</Hint>}
    {notes.map(item => <p key={item.name} className={item.state === 'error' ? 'dt-error dt-clamp' : 'dt-hint dt-clamp'}>
      {valueLabel(t, 'health', item.name)}{t('labelSeparator')}<span className={item.code ? undefined : 'dt-mono'}>{healthText(t,
        item)}</span>
    </p>)}
    {connect && <div className="dt-source-actions">{connect}</div>}
    {detail && <SourceDetail source={settings} />}
    {status.filtered.length > 0 && <DisclosureRow icon={<Icon name="filter" />} title={t('sourceFilteredTitle')} open={filteredOpen}
      onToggle={() => setFilteredOpen(!filteredOpen)}>
      <div className="dt-disclosure-body">
        <ul className="dt-list">{status.filtered.map(item => <li key={item.id} className="dt-row"><Dot state="idle" /><div
          className="dt-row-main">
          <div className="dt-row-title">{actorName(t, item.actor)}{t('labelSeparator')}{readableMarkers(t, item.preview)
            || t('empty')}</div>
          <div className="dt-row-meta"><Tag tone="neutral">{reasonLabel(t, item.reason)}</Tag><When at={item.at} /></div>
        </div></li>)}</ul>
      </div>
    </DisclosureRow>}
    {status.dropped.length > 0 && <DroppedReplies items={status.dropped} />}
    {settings.installed && <div className="dt-source-foot">
      <Button size="sm" variant="ghost" icon={<Icon name="message" size={14} />} title={t('sourceMessages')}
        aria-label={t('sourceMessages')} aria-haspopup="dialog" onClick={() => setMessages(true)} />
      <Button size="sm" variant="ghost" icon={<Icon name="edit" size={14} />} title={t('sourceEdit')}
        aria-label={t('sourceEdit')} aria-haspopup="dialog" onClick={() => setEdit(true)} />
    </div>}
    <Modal open={edit} onClose={() => setEdit(false)} title={t('sourceEditTitle', { name: localized(t, status.title) })}
      closeLabel={t('close')}>
      <SourceForm source={settings} className="dt-source-form" />
    </Modal>
    {messages && <SourceMessages source={status.id} title={localized(t, status.title)} onClose={() => setMessages(false)} />}
  </section>
}

/** The cards read the settings they show and edit, so they sit inside the shared settings reads. */
function SourceCards({ rows }: { rows: SourceStatusRow[] }) {
  const { settings } = useSettings()
  return <div className="dt-source-grid">
    {rows.map(status => {
      const found = settings.sources.find(item => item.id === status.id)
      return found ? <SourceCardView key={status.id} status={status} settings={found} /> : null
    })}
  </div>
}

export function SourceStatus() {
  const { t, call, navigate } = usePanel()
  const { setup } = usePanelData()
  const { data, error } = usePoll(() => call('GET sources'), [])
  const starting = useSourcesStarting(data)
  // Global deployment setup problems halt all Sources and show at the top; Source-specific setup problems show on that Source's card.
  const elsewhere = setup?.problem?.place === 'deployment' ? setup.problem : undefined
  return <div className="dt-form">
    <StatusHead hint={t('sourceStatusIntro')} settings="source" />
    {elsewhere && !starting && <p className="dt-error">
      <SetupMessage problem={elsewhere} lead /> <button type="button" className="dt-textlink"
        onClick={() => navigate(setupPage(elsewhere.place))}>{t('setupFixLink')}</button>
    </p>}
    <LoadState error={error} loading={!data || starting} />
    {data && !starting && <SettingsProvider><SourceCards rows={data} /></SettingsProvider>}
  </div>
}

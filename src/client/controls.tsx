/**
 * Context-free UI primitives styled with `--dsw-alias-*` tokens.
 * Mirrors DSH ui-primitives markup and keyboard behavior without coupling to its internal package API.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent,
  type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

const ICON_PATHS = {
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  'chevron-up': 'M5 15l7-7 7 7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  question: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 8v4l3 2',
  shield: 'M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z',
  decision: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12.5l2.5 2.5 4.5-5',
  message: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4V6a1 1 0 0 1 1-1z',
  inbox: 'M4 13l2.5-8h11l2.5 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  hash: 'M10 4L8 20M16 4l-2 16M5 9h15M4 15h15',
  filter: 'M4 5h16l-6 7.5V18l-4 2v-7.5z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5',
  close: 'M6 6l12 12M18 6L6 18',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  session: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3',
  stop: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5h5v5h-5z',
  pause: 'M9 6v12M15 6v12',
  play: 'M8 5l11 7-11 7z',
  unsubscribe: 'M6 16v-5a6 6 0 0 1 10-4.5M18 11v5l2 2H8M10 20h4M4 4l16 16',
  dismiss: 'M4 4l16 16M9.9 5.2A9 9 0 0 1 21 12a12 12 0 0 1-2.4 3.2M6.3 6.4A12 12 0 0 0 3 12c2 4 5.5 6 9 6 1.4 0 2.7-.3 3.9-.9',
  pull: 'M7 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8v8M7 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 16V9a2 2 0 0 0-2-2h-4M13 5l-2 2 2 2',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  skill: 'M9.5 18.5h5M10.5 21.5h3M12 2.5a6.5 6.5 0 0 1 3.7 11.9c-.6.5-.9 1.3-.9 2.1h-5.6c0-.8-.3-1.6-.9-2.1A6.5 6.5 0 0 1 12 2.5z',
  mcp: 'M9 2.5V8M15 2.5V8M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0V8zM12 17v4.5',
  detail: 'M6 3h8l5 5v13H6zM14 3v5h5M9 12h7M9 16h7M9 20h4',
  edit: 'M4 20h4l11-11-4-4L4 16v4zM14 5l4 4',
  review: 'M9 4h6v3H9zM7 5H5v15h14V5h-2M9 13l2 2 4-4',
  ask: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  alert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5.5M12 16.5h.01',
  running: 'M12 3a9 9 0 1 0 9 9',
  blocked: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  queue: 'M4 6h16M4 12h16M4 18h10',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
} as const satisfies Record<string, string>
export type IconName = keyof typeof ICON_PATHS
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"><path d={ICON_PATHS[name]} /></svg>
}

/** The whale mark in its 100-unit box: the body, the pale decal on its head, the shade and the highlight. The eyes are
 * left out of the artwork; the profile's first letter is drawn over them instead. */
const WHALE = {
  body: 'M65.3 20.9l5.1 .1 4.8 .9 4.8 1.7 4.3 2.3 3.8 3.1 3 3.4 2.3 3.8 1.6 4.3 .9 4.3 0 4.8-.8 4.8-1.4 4.3-2.3 4.3-3.2 4.3-3.4 3.3-4.3 3.1-7.2 3.5-7.6 1.7-7.2 .1-9.6-1.6-3.3-1-2.9-1.7-8.8-8.9-6-4.7-3.3-.5-7.7 1.1-4.8-.1-4.7-1.2-1.9-1.2-1-1-.5-1.5 .4-1.4 1.1-1.3 1.9-1.3 4.7-1.5 7.7-.6 1.1-.5 .7-1 0-1.4-2.8-7.2-1.2-5.3-.1-4.3 .4-1.4 .9-1.2 1.9-.2 2 1 2.2 2.3 2.2 3.4 3.2 7.6 1.9 9.7 .5-.1 1.1-7.2 1.8-4.8 3.2-5.2 3.9-4.3 4.9-3.9 5.6-2.9 5.8-1.9z',
  decal: 'M93.3 55.8l1-.3 .1 1.2-2.4 5.3-3.4 4.8-3.8 3.8-4.8 3.4-5.7 2.8-4.8 1.5-4.8 .4 20.1-17.4 5.2-3.7z',
  shade: 'M88.6 29.5l2.4 2.9 1.9 2.8 2.4 6.3 .5 3.3 .1 5.3-1.5 6.6-1.9 4.3-2 3.3-4.8 5.4-5.7 4.3-7.2 3.3-6.2 1.5-6.7 .1-3.3-.2-9.6-1.8-3.3-1.5-2.4-1.9-8.6-8.9-5.3-3.9-3.3-.1-2.9 .2-3.3 .8-5.8 0-4.3-1-2.9-1.9 .6-.6 3.8-1.3 10.5-2.5 4.3 .9 1.4-.1 2.2-1.7 .5-1.4-.3-1.5-1.2-1.4-2.2-1.4-1.2-1.9-.6-12 .4-3.3 .5-.5 2.9 3.8 2.4 4.8 1.9 5.7 .7 5.8 .7 2.8 2.1 2.4 2.7 5.5 3.8 4.3 2.9 2.2 3.3 1 3.4-.4 6.2-3 7.1-4.5 7.3-5.6 6.6-5.9 5.9-6.5 3.7-5.3 1.7-4.2 .1-2.9z',
  light: 'M55.6 22.8l1.9-.3 1.5 .3 .6 1 .1 .9-2 4.3-3.8 5.3-5.8 6.2-5.4 4.4-4.8 2.3-1.4 0-1.2-.5-.8-1.9 .5-3.3 2.5-4.8 3.3-4.3 2.4-2.4 5.3-3.9zM19.3 28.1l-1.4 2 .3-1.1zM21.7 49.1l.6 .5-.3 .5-.8 0zM35.8 52l1.2-.4 .9 .7 .7 1.6-.4 .9-1.2 .1-2.6-.5zM7.2 52.9l-2.9 2.9 1.2-1.6z',
} as const
/** Where the whale's two eyes met: the letter's anchor in the mark's own box, so every avatar size lands it the same. */
const AVATAR_EYE = { x: 79.05, y: 45.9, size: 30 } as const
/** A four-point sparkle centred on the origin, drawn beside the eye of a picked profile. */
const SPARKLE = 'M0 -10Q2 -2 10 0Q2 2 0 10Q-2 2 -10 0Q-2 -2 0 -10Z'

export type AvatarState = 'working' | 'thinking' | 'waiting' | 'alert' | 'done' | 'idle'
/** The 12 inks of the picker; each hex is picked to read on both host themes. */
export const AVATAR_INKS: readonly { name: string; color: string }[] = [
  { name: 'blue', color: '#3B82F6' }, { name: 'violet', color: '#8B5CF6' }, { name: 'magenta', color: '#F43F85' },
  { name: 'red', color: '#FF3E51' }, { name: 'orange', color: '#FF6B1A' }, { name: 'yellow', color: '#FFB020' },
  { name: 'green', color: '#10B981' }, { name: 'cyan', color: '#06B6D4' }, { name: 'teal', color: '#0D9488' },
  { name: 'brown', color: '#9A6B44' }, { name: 'gray', color: '#8A8F98' }, { name: 'ink', color: '#3F4650' },
]
/** The ink a profile falls back to when nobody has chosen one: the same id always maps to the same colour. */
export const inkOfProfile = (id: string): string => AVATAR_INKS[[...id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 997, 7)
  % AVATAR_INKS.length]!.color
/** Maps a run's state onto what its avatar shows: running works, a queued run thinks, a waiting one waits. */
export function runAvatarState(state: string): AvatarState {
  return state === 'running' ? 'working' : state === 'queued' ? 'thinking' : state === 'waiting' ? 'waiting'
    : state === 'ended' ? 'done' : 'idle'
}
/**
 * A profile's avatar, one circle at `data-size` 18/24/36/64: the uploaded picture when there is one, otherwise the
 * whale mark in the profile's ink with the name's first letter standing in for its eye. The letter is a separate layer
 * anchored in the mark's own 100-unit box, so it keeps its place however far the avatar is scaled up. `icon` swaps both
 * for a glyph (for groups), `data-state` lets the stylesheet mark work in flight, and `sparkle` twinkles two stars beside
 * the eye where the detail card shows the picked profile.
 */
export function Avatar({ name, color, image, size = 18, state = 'idle', icon, sparkle = false }: {
  name?: string; color?: string; image?: string | null; size?: 18 | 24 | 36 | 64; state?: AvatarState; icon?: IconName
  sparkle?: boolean
}) {
  const kind = icon ? 'glyph' : image ? 'image' : 'whale'
  return <span className="dt-avatar" data-size={size} data-state={state} data-kind={kind}
    style={kind === 'whale' ? { color } : undefined} aria-hidden="true">
    {icon ? <Icon name={icon} size={Math.round(size * 0.55)} />
      : image ? <img className="dt-avatar-img" src={image} alt="" />
      : <svg className="dt-avatar-whale" viewBox="0 0 100 100">
        <g className="dt-avatar-body">
          <path d={WHALE.body} fill="currentColor" />
          <path d={WHALE.decal} fill="#fff" />
          <path d={WHALE.shade} fill="#000" fillOpacity=".14" />
          <path d={WHALE.light} fill="#fff" fillOpacity=".16" />
        </g>
        <text className="dt-avatar-eye" transform={`translate(${AVATAR_EYE.x} ${AVATAR_EYE.y})`}
          fontSize={AVATAR_EYE.size} fontWeight={700} textAnchor="middle" dominantBaseline="central">
          {(name?.trim()[0] ?? '?').toUpperCase()}</text>
        {sparkle && <g className="dt-avatar-sparkles">
          <path className="dt-avatar-star" d={SPARKLE} transform="translate(64 28) scale(.72)" />
          <path className="dt-avatar-star is-second" d={SPARKLE} transform="translate(57 57) scale(.45)" />
        </g>}
      </svg>}
  </span>
}

/**
 * Read an image file into a square, centre-cropped data URL. Keeping it at 128px bounds what the profile record holds
 * while staying sharp at the largest avatar the panel draws.
 */
export async function fileToAvatarDataUrl(file: File, size = 128): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
  const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('decode failed'))
    image.src = source
  })
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return source
  const side = Math.min(picture.width, picture.height)
  context.drawImage(picture, (picture.width - side) / 2, (picture.height - side) / 2, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/png')
}

/** Which side panes this operator put away, kept across tab changes and restarts. */
export function usePaneCollapse(key: string): { collapsed: boolean; toggle: () => void } {
  const storageKey = `dsh-superagent-plus.pane.${key}`
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(storageKey) === 'collapsed' } catch { return false } })
  const toggle = useCallback(() => setCollapsed(current => {
    const next = !current
    try { localStorage.setItem(storageKey, next ? 'collapsed' : 'open') } catch { /* a panel with no storage simply forgets the choice */ }
    return next
  }), [storageKey])
  return { collapsed, toggle }
}
/** A left column that can be put away: collapsed it takes no width and leaves only the handle on the seam. */
export function CollapsiblePane({ collapsed, onToggle, label, children }: {
  collapsed: boolean; onToggle: () => void; label: string; children: ReactNode
}) {
  return <div className="dt-pane" data-collapsed={collapsed ? 'true' : undefined}>
    <div className="dt-pane-body">{children}</div>
    <button type="button" className="dt-pane-seam" aria-expanded={!collapsed} aria-label={label} onClick={onToggle}>
      <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={12} />
    </button>
  </div>
}

type ButtonProps = { variant?: 'primary' | 'ghost' | 'outline'; size?: 'md' | 'sm'; icon?: ReactNode; className?: string }
  & ButtonHTMLAttributes<HTMLButtonElement>
export function Button({ variant = 'ghost', size = 'md', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx('dt-btn', `dt-btn-${variant}`, `dt-btn-${size}`, className)} {...rest}>
    {icon !== undefined && <span className="dt-btn-icon">{icon}</span>}{children}
  </button>
}

export type TagTone = 'outline' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'
export function Tag({ tone = 'outline', title, children }: { tone?: TagTone; title?: string; children: ReactNode }) {
  return <span className="dt-tag" data-tone={tone} title={title}>{children}</span>
}

export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={cx('dt-pill', active && 'dt-pill-active')} aria-pressed={active}
    onClick={onClick}>{children}</button>
}

function walk<V extends string>(event: KeyboardEvent, values: readonly V[], value: V, onChange: (next: V) => void) {
  const index = values.indexOf(value)
  const steps: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: values.length - 1 }
  const next = steps[event.key]
  if (next === undefined) return
  event.preventDefault()
  const target = values[(next + values.length) % values.length]!
  if (target !== value) onChange(target)
  const list = event.currentTarget as HTMLElement
  requestAnimationFrame(() => list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus())
}
interface TabItem<V extends string> { value: V; label: string; id: string; panelId: string; tail?: boolean }
/** Page-level tab bar that re-emits `onChange` when clicking the active tab so callers can reset to the tab root. */
export function SegmentedTabs<V extends string>({ items, value, onChange, label, className }: {
  items: readonly TabItem<V>[]; value: V; onChange: (next: V) => void; label: string; className?: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState<'start' | 'end' | 'both'>()
  const measure = useCallback(() => {
    const element = list.current
    if (!element) return
    const start = element.scrollLeft > 1, end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    setMore(start && end ? 'both' : start ? 'start' : end ? 'end' : undefined)
  }, [])
  // Observe both the tablist container (pane resize) and individual tabs (locale label changes).
  useEffect(() => {
    measure()
    if (!list.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list.current)
    for (const tab of list.current.children) observer.observe(tab)
    return () => { observer.disconnect() }
  }, [measure, items.length])
  return <div ref={list} role="tablist" aria-label={label} className={cx('dt-tabs', className)} data-more={more} onScroll={measure}
    onKeyDown={event => walk(event, items.map(item => item.value), value, onChange)}>
    {items.map(item => <button key={item.value} type="button" role="tab" id={item.id} aria-controls={item.panelId}
      aria-selected={item.value === value} tabIndex={item.value === value ? 0 : -1} className="dt-tab"
      data-tail={item.tail ? '' : undefined}
      onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>
}
/** Inline sub-navigation under a page title: the page tab language at a smaller scale. */
export function Subtabs<V extends string>({ items, value, onChange, label, className }: {
  items: readonly { value: V; label: string }[]; value: V; onChange: (next: V) => void; label: string; className?: string
}) {
  return <div role="tablist" aria-label={label} className={cx('dt-subtabs', className)}
    onKeyDown={event => walk(event, items.map(item => item.value), value, onChange)}>
    {items.map(item => <button key={item.value} type="button" role="tab" className="dt-subtab"
      aria-selected={item.value === value} tabIndex={item.value === value ? 0 : -1}
      onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>
}
export function SegmentedControl<V extends string>({ options, value, onChange, label, disabled, className }: {
  options: readonly { value: V; label: string; title?: string }[]; value: V; onChange: (next: V) => void; label: string; disabled?: boolean
  className?: string
}) {
  return <div role="tablist" aria-label={label} className={cx('dt-segmented', className)}
    style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    onKeyDown={event => { if (!disabled) walk(event, options.map(option => option.value), value, onChange) }}>
    {options.map(option => <button key={option.value} type="button" role="tab" aria-selected={option.value === value}
      tabIndex={option.value === value ? 0 : -1}
      title={option.title} disabled={disabled} className="dt-segment"
        onClick={() => { if (option.value !== value) onChange(option.value) }}>{option.label}</button>)}
  </div>
}

export function Input({ icon, className, ...rest }: { icon?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <span className={cx('dt-input', className)}>{icon !== undefined && <span
    className="dt-input-icon">{icon}</span>}<input {...rest} /></span>
}

export function Switch({ checked, onChange, label,
  className }: { checked: boolean; onChange: (next: boolean) => void; label: string; className?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={cx('dt-switch', className)}
    onClick={() => onChange(!checked)}>
    <span className="dt-switch-thumb" />
  </button>
}

export type DotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'
export function StateDot({ state, className }: { state: DotState; className?: string }) {
  if (state === 'ongoing') {
    return <svg className={cx('dt-spinner', className)} data-state="ongoing" width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
      <g><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="12" r="9.5" /></g>
    </svg>
  }
  return <span className={cx('dt-state-dot', className)} data-state={state} aria-hidden="true" />
}
export function Dot({ state, label }: { state: DotState; label?: string }) {
  const dot = <StateDot className="dt-dot" state={state} />
  return label ? <span className="dt-dot-wrap" title={label} role="img" aria-label={label}>{dot}</span> : dot
}

export function DisclosureRow({ icon, title, open, onToggle, collapsedContent, children }: {
  icon: ReactNode; title: ReactNode; open: boolean; onToggle: () => void; collapsedContent?: ReactNode; children?: ReactNode
}) {
  return <div className="dt-disclosure" data-open={open || undefined}>
    <div className="dt-disclosure-row" role="button" tabIndex={0} aria-expanded={open} data-disclosure-row onClick={onToggle}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle() } }}>
      <span className="dt-disclosure-lead">
        <span className="dt-disclosure-icon">{icon}</span>
        <span className="dt-disclosure-chevron"><Icon name={open ? 'chevron-up' : 'chevron-down'} /></span>
      </span>
      <span className="dt-disclosure-title">{title}</span>
      {!open && collapsedContent}
    </div>
    {open && children}
  </div>
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
function trapTab(event: globalThis.KeyboardEvent, dialog: HTMLElement) {
  // Query `*` and filter so elements stay in document order across all DOM implementations.
  const items = [...dialog.querySelectorAll<HTMLElement>('*')].filter(element => element.matches(FOCUSABLE))
  const first = items[0], last = items.at(-1), active = document.activeElement
  const target = event.shiftKey ? last : first
  if (!target || !dialog.contains(active) || active === dialog || active === (event.shiftKey ? first : last)) {
    event.preventDefault()
    target?.focus()
  }
}
/** Accessible modal dialog with focus trapping, Escape/backdrop dismissal, and focus restoration. */
export function Modal({ open, onClose, title, closeLabel, description, footer, className, children }: {
  open: boolean; onClose: () => void; title: string; closeLabel: string; description?: string; footer?: ReactNode; className?: string
  children?: ReactNode
}) {
  const dialog = useRef<HTMLDivElement>(null)
  // Keep `onClose` in a ref so parent re-renders (e.g., background polls) do not re-run the effect and reset focus.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    dialog.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      else if (event.key === 'Tab' && dialog.current) trapTab(event, dialog.current)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); opener?.focus() }
  }, [open])
  if (!open) return null
  return createPortal(<div className="dt-modal-root" role="presentation">
    <div className="dt-modal-mask" aria-hidden="true" onClick={onClose} />
    <div ref={dialog} className={cx('dt-modal', className)} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <div className="dt-modal-header">
        <h2>{title}</h2>
        <button type="button" className="dt-modal-close" aria-label={closeLabel} onClick={onClose}><Icon name="close" size={14} /></button>
      </div>
      {description && <p className="dt-modal-description">{description}</p>}
      {children !== undefined && <div className="dt-modal-body">{children}</div>}
      {footer !== undefined && <div className="dt-modal-footer">{footer}</div>}
    </div>
  </div>, document.body)
}

/** Right-side dialog for detail that opens beside the page: Escape, backdrop dismissal, and focus restoration. */
export function Drawer({ open, onClose, title, closeLabel, className, children }: {
  open: boolean; onClose: () => void; title: string; closeLabel: string; className?: string; children?: ReactNode
}) {
  const panel = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    panel.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      else if (event.key === 'Tab' && panel.current) trapTab(event, panel.current)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); opener?.focus() }
  }, [open])
  if (!open) return null
  return createPortal(<div className="dt-drawer-root" role="presentation">
    <div className="dt-drawer-mask" aria-hidden="true" onClick={onClose} />
    <aside ref={panel} className={cx('dt-drawer', className)} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <div className="dt-drawer-head"><h2>{title}</h2>
        <button type="button" className="dt-drawer-close" aria-label={closeLabel} onClick={onClose}><Icon name="close" size={14} /></button>
      </div>
      <div className="dt-drawer-body">{children}</div>
    </aside>
  </div>, document.body)
}

/** Portaled tooltip trigger supporting hover, keyboard focus, and touch toggle. */
export function InfoTip({ text, icon = 'question', warn }: { text: string; icon?: IconName; warn?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const target = anchor.current, element = bubble.current
    if (!open || !target || !element) return
    const margin = 12, gap = 8
    const a = target.getBoundingClientRect(), b = element.getBoundingClientRect()
    const above = a.top - gap - b.height >= margin
    element.style.left = `${Math.max(margin, Math.min(a.left + a.width / 2 - b.width / 2, window.innerWidth - margin - b.width))}px`
    element.style.top = `${above ? a.top - gap - b.height : a.bottom + gap}px`
    element.style.visibility = 'visible'
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [open])
  return <>
    <button ref={anchor} type="button" className={warn ? 'dt-info dt-info-warn' : 'dt-info'} aria-label={text}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onBlur={() => setOpen(false)}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setOpen(true) }}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}
      onPointerUp={event => { if (event.pointerType === 'touch') setOpen(!open) }}
      onClick={event => { if (event.detail > 0 && (event.nativeEvent as PointerEvent).pointerType !== 'touch') setOpen(false) }}>
      <Icon name={icon} size={14} />
    </button>
    {open && createPortal(<span ref={bubble} role="tooltip" className="dt-tooltip" style={{ visibility: 'hidden' }}>{text}</span>,
      document.body)}
  </>
}

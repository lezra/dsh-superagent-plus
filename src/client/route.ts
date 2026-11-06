/** Typed panel routes, route parser, and sessionStorage location history. */
import { THREAD_FILTERS, TICKET_FILTERS, type ThreadFilter, type TicketFilter } from '../app/api.ts'
import type { SetupPlace } from '../setup.ts'
import { DECISION_FILTERS, type DecisionFilter } from './api.ts'
import type { T } from './text.ts'

export const TABS = ['board', 'team', 'chain', 'overview', 'source', 'trigger', 'eval', 'execution', 'settings'] as const
export type Tab = typeof TABS[number]
/** The tabs the panel shows: the diagnostic views stay routable but out of the top bar, so the main line keeps four work tabs. */
export const NAV_TABS = ['board', 'team', 'chain', 'source', 'settings'] as const
export type NavTab = typeof NAV_TABS[number]
/** The visible tab a hidden view belongs to, so a deep link still lights up its section instead of leaving the bar blank. */
export const NAV_OWNER: Record<Tab, NavTab> = { board: 'board', team: 'team', chain: 'chain', overview: 'board',
  source: 'source', trigger: 'source', eval: 'chain', execution: 'board', settings: 'settings' }
export const SETTINGS_GROUPS = ['source', 'eval', 'execution', 'prompts', 'deployment'] as const
export type SettingsGroup = typeof SETTINGS_GROUPS[number]
export type Route = { page: 'board' | 'team' | 'chain' | 'overview' | 'source'; id?: undefined; query?: undefined }
  | { page: 'trigger'; id?: undefined; query?: { filter?: ThreadFilter } }
  | { page: 'trigger'; id: string; query?: { trigger?: string } }
  | { page: 'eval'; id?: undefined; query?: { filter?: DecisionFilter; window?: '24h' } }
  | { page: 'execution'; id?: undefined; query?: { filter?: TicketFilter } }
  | { page: 'execution'; id: string; query?: undefined }
  | { page: 'settings'; id?: undefined; query: { group: SettingsGroup; source?: string; version?: string } }
export const HOME: Route = { page: 'board' }
export const settingsRoute = (group: SettingsGroup, query: { source?: string; version?: string } = {}): Route =>
  ({ page: 'settings', query: { group, ...query } })
export const setupPage = (place: SetupPlace): Route =>
  place === 'deployment' ? settingsRoute('deployment') : settingsRoute('source', { source: place })
export const routeLabel = (t: T, route: Route): string =>
  route.id ? t(route.page === 'trigger' ? 'term.thread' : 'term.ticket') : t(`tab.${route.page}`)

const pick = <V extends string>(values: readonly V[], value: unknown): V | undefined => values.find(item => item === value)
function compact<Q extends object>(query: Q): Q | undefined {
  const set = Object.entries(query).filter(([, value]) => value !== undefined)
  return set.length ? Object.fromEntries(set) as Q : undefined
}
/** Validate and normalize a stored route, dropping unrecognized query filters or removed tabs (such as the legacy `policy` tab). */
export function parseRoute(value: unknown): Route | undefined {
  const { page, id, query } = (value ?? {}) as { page?: unknown; id?: unknown; query?: Record<string, unknown> }
  const text = (name: string) => typeof query?.[name] === 'string' ? query[name] as string : undefined
  const record = typeof id === 'string' && id ? id : undefined
  switch (page) {
    case 'board': case 'team': case 'chain': case 'overview': case 'source': return { page }
    case 'trigger': return record ? { page, id: record, query: compact({ trigger: text('trigger') }) }
      : { page, query: compact({ filter: pick(THREAD_FILTERS, query?.filter) }) }
    case 'eval': return { page, query: compact({ filter: pick(DECISION_FILTERS, query?.filter),
      window: query?.window === '24h' ? '24h' as const : undefined }) }
    case 'execution': return record ? { page, id: record } : { page, query: compact({ filter: pick(TICKET_FILTERS, query?.filter) }) }
    case 'settings': return { page, query: { group: pick(SETTINGS_GROUPS, query?.group) ?? 'source',
      ...compact({ source: text('source'), version: text('version') }) } }
    default: return undefined
  }
}

const ROUTE_KEY = 'dsh-superagent/route'
/** Storage key of one panel instance's route; panels without an instance share the legacy key. */
export const routeKey = (instance?: string): string => instance ? `${ROUTE_KEY}:${instance}` : ROUTE_KEY
export interface Location { route: Route; stack: Route[]; group?: SettingsGroup | undefined }
export const lastSettingsGroup = ({ route, group }: Location): SettingsGroup => route.page === 'settings' ? route.query.group
  : group ?? 'source'
/** Reads the stored location for `key`, falling back to the legacy key so an upgraded panel keeps its page. */
export function initialLocation(key = ROUTE_KEY): Location {
  for (const name of key === ROUTE_KEY ? [key] : [key, ROUTE_KEY]) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(name) ?? 'null') as { route?: unknown; stack?: unknown; group?: unknown } | null
      const route = parseRoute(stored?.route)
      const stack = Array.isArray(stored?.stack) ? stored.stack as unknown[] : []
      if (route) return { route, stack: stack.flatMap(item => parseRoute(item) ?? []), group: pick(SETTINGS_GROUPS, stored?.group) }
    } catch (error) {
      // Route memory is a convenience; an unreadable value falls back to HOME.
      void error
    }
  }
  return { route: HOME, stack: [] }
}
export function remember(location: Location, key = ROUTE_KEY): void {
  try { sessionStorage.setItem(key, JSON.stringify(location)) } catch (failure) { void failure /* Route memory is a convenience. */ }
}

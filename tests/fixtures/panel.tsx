/** DOM rendering and interaction helpers for panel tests. */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, vi } from 'vitest'
import { App } from '../../src/client/app.tsx'
import { usePageForm } from '../../src/client/deployment.tsx'
import { zh } from '../../src/client/locales.ts'
import type { T } from '../../src/client/text.ts'
import { server, usePanelServer } from './panel-server.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

export const translator = (dictionary: Record<string, string>): T => ((key: string, params?: Record<string, unknown>) => {
  const template = dictionary[key] ?? key
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match) : template
}) as T
function Panel({ t }: { t: T }) {
  return <App t={t} openSession={async id => { server.opened.push(id) }}
    newSession={prompt => { server.started++; server.drafts.push(prompt) }}
    deploymentForm={usePageForm(server.form)} />
}
let root: Root | undefined
let container: HTMLElement | undefined
function unmount() {
  act(() => { root?.unmount() })
  root = undefined
  container?.remove()
}
export const usePanel = () => usePanelServer(unmount)

/** Flush pending fake-server responses and React state updates. */
export async function settle() {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(server.pending).toBe(0)
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
/**
 * Mount the panel on `route`, or on the overview for a first mount (the panel's own default is the board, which
 * `tests/client.spec.tsx` covers). A remount keeps the route the panel remembered, as the App itself does.
 */
export async function mount(dictionary: Record<string, string> = zh, route?: object) {
  if (route) at(route)
  else if (!sessionStorage.getItem('dsh-superagent-plus/route')) at({ page: 'overview' })
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<Panel t={translator(dictionary)} />) })
  await settle()
}
export async function remount(dictionary: Record<string, string> = zh) { unmount(); await mount(dictionary) }

export const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
const CONTROLS = 'button, [role="button"], [role="tab"], [role="switch"], a'
export function find(name: string, selector = CONTROLS): HTMLElement {
  const match = all(selector).find(element => element.textContent?.trim() === name || element.getAttribute('aria-label') === name)
  if (!match) throw new Error(`No ${selector} named ${name}`)
  return match
}
export const tab = (name: string) => find(name, '[role="tab"]')
export async function click(target: string | HTMLElement) {
  const element = typeof target === 'string' ? find(target) : target
  await act(async () => { element.click() })
  await settle()
}
export async function type(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
  await settle()
}
/** The page's text without its stylesheet. */
export const text = () => [...document.body.querySelectorAll('style')].reduce((all, style) => all.replace(style.textContent ?? '', ''),
  document.body.textContent ?? '')
export function field<E extends HTMLElement>(label: string): E {
  const labelled = (element: HTMLElement) => !!element.id && all('label').some(item => (item as HTMLLabelElement).htmlFor === element.id
    && item.textContent === label)
  const match = all('input, textarea, select').find(element => element.getAttribute('aria-label') === label || labelled(element))
  if (!match) throw new Error(`No field ${label}`)
  return match as unknown as E
}
export const at = (route: object) => sessionStorage.setItem('dsh-superagent-plus/route', JSON.stringify({ route, stack: [] }))
interface StoredLocation { route?: { page?: string; query?: { group?: string } }; group?: string }
/**
 * Opens a view by route: the diagnostic views keep their routes but no longer hold a tab in the top bar. Like the tab
 * bar, opening one keeps the last settings group, so the Settings tab reopens where the person left it.
 */
export async function open(route: object) {
  const keys = Object.keys(sessionStorage).filter(key => key.startsWith('dsh-superagent-plus/route'))
  // The instance key is written last and follows the app's own navigation; the legacy key may be a stale `at`.
  const current = keys.map(key => {
    try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') as StoredLocation | null } catch { return null }
  }).filter(stored => stored?.group !== undefined).at(-1)
  const group = current?.route?.page === 'settings' ? current.route.query?.group : current?.group
  const location = JSON.stringify({ route, stack: [], ...group === undefined ? {} : { group } })
  for (const key of keys.length ? keys : ['dsh-superagent-plus/route']) sessionStorage.setItem(key, location)
  await remount()
}

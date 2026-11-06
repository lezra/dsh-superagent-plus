// @vitest-environment jsdom
// Panel search, glossary, route persistence, and host-down fallback.
import { act } from 'react'
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, settle, all, click, type, text, field } from './fixtures/panel.tsx'
import { server, found, ticketSummary } from './fixtures/panel-server.ts'

usePanel()
it('states why a filtered search result has no Thread instead of opening an empty one', async () => {
  server.search = { items: [found('e9', '2026-09-20T00:00:00Z', { source: 'github', actor: { source: 'github', id: 'someone' },
    preview: 'issue text', threads: ['github:7'],
    filtered: 'source_disabled' })], threads: [] }
  await mount()
  await type(field<HTMLInputElement>(zh.searchLabel), 'issue')
  await act(async () => { field<HTMLInputElement>(zh.searchLabel).closest('form')!.requestSubmit() }); await settle()
  expect(text()).toContain('被来源过滤：来源已停用')
  expect(all('.dt-search-results button').some(button => button.textContent === 'issue text')).toBe(false)
})

it('opens a search result older than the newest page around its Trigger', async () => {
  server.search = { items: [found('e1', '2026-09-20T00:00:00Z')], threads: [] }
  await mount()
  await type(field<HTMLInputElement>(zh.searchLabel), 'message')
  await act(async () => { field<HTMLInputElement>(zh.searchLabel).closest('form')!.requestSubmit() }); await settle()
  expect(text()).toContain('找到 0 个工单、0 个线程、1 条触发')
  await click(all('.dt-search-results button').find(button => button.textContent === 'message e1')!)
  expect(server.requests.some(request => request.path.includes('around=e1'))).toBe(true)
  expect(document.querySelector('.dt-highlight')?.textContent).toContain('message e1')
})

it('explains what can be searched when nothing matches', async () => {
  await mount()
  await type(field<HTMLInputElement>(zh.searchLabel), 'nothing')
  await act(async () => { field<HTMLInputElement>(zh.searchLabel).closest('form')!.requestSubmit() }); await settle()
  expect(text()).toContain('没有找到。可以输入触发文字')
})

it('returns to the exact page after a remount of the main panel', async () => {
  await mount()
  await click('修复回归')
  await remount()
  expect(document.querySelector('.dt-page-title h2')?.textContent).toBe('修复回归')
})

it('shows domain terms in the interface language only and lists both languages in the (?) glossary', async () => {
  await mount(en)
  expect(all('[role="tab"]').map(tab => tab.textContent)).toEqual(['Board', 'Team', 'Chain', 'Source', 'Settings'])
  await click('Glossary')
  const dialog = document.querySelector('[role="dialog"]')!
  const row = [...dialog.querySelectorAll('tr')].find(item => item.textContent?.startsWith('Ticket'))!
  expect([...row.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['Ticket', '工单', 'An authorized unit of work'])
  expect(dialog.textContent).toContain('Accept 接单')
  // Terms are grouped the way the tabs follow the flow, after the roles that act in it.
  expect([...dialog.querySelectorAll('th.dt-glossary-group')].map(cell => cell.textContent)).toEqual(['Roles', 'Source', 'Trigger', 'Eval',
    'Execution'])
  expect([...dialog.querySelectorAll('tr')].find(item => item.textContent?.startsWith('Main Session'))!.textContent).toContain('prompts call it the orchestrator')
})

it('says dsh-superagent is not answering when its routes are gone, as while it restarts', async () => {
  server.down = true
  await mount()
  expect(text()).toContain(zh.hostNotRunning)
  expect(text()).not.toContain('404')
})

it('closes search results on Escape and on a click outside the search', async () => {
  await mount()
  const search = field<HTMLInputElement>(zh.searchLabel)
  const submit = async () => { await type(search,
    'nothing'); await act(async () => { search.closest('form')!.requestSubmit() }); await settle() }
  await submit()
  expect(document.querySelector('.dt-search-results')).not.toBeNull()
  await act(async () => { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(document.querySelector('.dt-search-results')).toBeNull()
  await submit()
  await act(async () => { document.querySelector('main')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
  expect(document.querySelector('.dt-search-results')).toBeNull()
})

it('shows the answer to the latest search only', async () => {
  server.search = { items: [found('e1', '2026-09-20T00:00:00Z', { preview: 'old message' }), found('e2', '2026-09-21T00:00:00Z',
    { preview: 'new message' })], threads: [] }
  let release = () => {}
  server.searching = async query => { if (query === 'old') await new Promise<void>(resolve => { release = resolve }) }
  await mount()
  const search = field<HTMLInputElement>(zh.searchLabel)
  for (const query of ['old', 'new']) { await type(search,
    query); await act(async () => { search.closest('form')!.requestSubmit() }); await settle() }
  expect(all('.dt-search-results .dt-row-title').map(title => title.textContent)).toEqual(['new message'])
  await act(async () => { release() }); await settle()
  expect(all('.dt-search-results .dt-row-title').map(title => title.textContent)).toEqual(['new message'])
})

it('shows the profile that runs a board Ticket, from the group chat its Thread came from', async () => {
  server.agents = { profiles: [{ id: 'researcher', name: '研究员', role: '调研', instructions: '',
    model: null, workDir: '', avatar: { color: '#4D6BFE' } }],
  groups: [{ chatId: 'oc_team', name: 'A股日报', adminProfile: 'researcher', members: ['ou_alice'], notice: '',
    createdAt: '2026-11-05T00:00:00Z' }] }
  server.tickets.open = [ticketSummary({ threads: [{ key: 'feishu:oc_team:om_1', source: 'feishu', title: 'A股日报', facts: {} }] })]
  await mount()
  await click(zh['tab.board'])
  expect(text()).toContain('研究员')
  expect(all('.dt-bcard-person .dt-pchip-name')).toHaveLength(1)
})

it('shows the profile fixed on a Ticket even when no group chat was involved, as for a direct message', async () => {
  server.agents = { profiles: [{ id: 'researcher', name: '研究员', role: '调研', instructions: '',
    model: null, workDir: '', avatar: { color: '#4D6BFE' } }], groups: [] }
  server.tickets.open = [ticketSummary({ profileId: 'researcher',
    threads: [{ key: 'feishu:oc_dm:om_1', source: 'feishu', title: '私聊', facts: {} }] })]
  await mount()
  await click(zh['tab.board'])
  expect(text()).toContain('研究员')
  expect(all('.dt-bcard-person .dt-pchip-name')).toHaveLength(1)
})

it('shows a recently ended Ticket as the profile avatar that ran it, or its title initials, with the card on hover', async () => {
  server.agents = { profiles: [{ id: 'researcher', name: '研究员', role: '调研', instructions: '',
    model: null, workDir: '', avatar: { color: '#4D6BFE' } }], groups: [] }
  server.tickets.ended = [
    ticketSummary({ id: 'e1', title: '北极调研', profileId: 'researcher' }, { stage: 'ended' }),
    ticketSummary({ id: 'e2', title: '修复回归', summary: '已合并到主干' }, { stage: 'ended' }),
  ]
  await mount()
  await click(zh['tab.board'])
  const chips = all('.dt-recent .dt-ended-chip')
  expect(chips).toHaveLength(2)
  expect(chips[0]!.querySelector('.dt-avatar')).not.toBeNull()
  expect(chips[0]!.querySelector('.dt-ended-face')).toBeNull()
  expect(chips[1]!.querySelector('.dt-avatar')).toBeNull()
  expect(chips[1]!.querySelector('.dt-ended-face')?.textContent).toBe('修复')
  await act(async () => { chips[1]!.focus() })
  const pop = document.querySelector('.dt-ended-pop')
  expect(pop?.textContent).toContain('修复回归')
  expect(pop?.textContent).toContain('已合并到主干')
})

it('shows Executor profiles as a cloud of avatars that grow with their active Tickets', async () => {
  server.agents = { profiles: [
    { id: 'researcher', name: '研究员', role: '调研', instructions: '', model: null, workDir: '', avatar: { color: '#4D6BFE' } },
    { id: 'writer', name: '写手', role: '写作', instructions: '', model: null, workDir: '', avatar: { color: '#10B981' } }],
  groups: [{ chatId: 'oc_team', name: 'A股日报', adminProfile: 'researcher', members: ['ou_alice'], notice: '',
    createdAt: '2026-11-05T00:00:00Z' }] }
  const teamThread = { key: 'feishu:oc_team:om_1', source: 'feishu', title: 'A股日报', facts: {} }
  server.tickets.open = ['a', 'b', 'c'].map((id, index) => ticketSummary({ id, threads: [teamThread] },
    index === 0 ? { stage: 'working', action: 'queued' } : { stage: 'working' }))
  await mount()
  await click(zh['tab.board'])
  const items = all('.dt-cloud .dt-cloud-item')
  expect(items.map(item => item.getAttribute('data-active'))).toEqual(['true', null])
  expect(items.map(item => item.querySelector('.dt-avatar')?.getAttribute('data-size'))).toEqual(['64', '24'])
  expect(items.map(item => item.querySelector('.dt-avatar')?.getAttribute('data-state'))).toEqual(['working', 'idle'])
  expect(items[0]!.querySelector('.dt-cloud-count')?.textContent).toBe('3')
  expect(items[0]!.getAttribute('title')).toContain('研究员')
})

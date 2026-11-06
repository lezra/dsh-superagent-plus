// @vitest-environment jsdom
/** The Team page: the profiles and groups the main Session created. */
import { expect, it, vi } from 'vitest'
import { AVATAR_INKS, inkOfProfile, runAvatarState } from '../src/client/controls.tsx'
import { zh } from '../src/client/locales.ts'
import { avatarStateOf, ticketAvatarState } from '../src/client/team-kit.tsx'
import { all, click, find, mount, remount, tab, text, usePanel } from './fixtures/panel.tsx'
import { server, ticketSummary } from './fixtures/panel-server.ts'

usePanel()

const researcher = { id: 'researcher', name: '研究员', role: '调研', instructions: '跟踪行情并写日报',
  model: { provider: 'deepseek-account', model: 'deepseek-flash' }, workDir: 'D:/work/research',
  skills: ['stock-report'], mcp: [{ name: 'market-data', enabled: true }], avatar: { color: '#4D6BFE' } }
const team = { profiles: [researcher], groups: [] }

it('lists the profiles and groups the main Session created, with the work each carries', async () => {
  server.agents = { profiles: [{ id: 'researcher', name: '研究员', role: '调研', instructions: '跟踪行情并写日报',
    model: { provider: 'deepseek-account', model: 'deepseek-flash' }, workDir: 'D:/work/research', avatar: { color: '#4D6BFE' } }],
  groups: [{ chatId: 'oc_team', name: 'A股日报', adminProfile: 'researcher', members: ['ou_alice', 'ou_bob'], notice: '',
    createdAt: '2026-11-05T00:00:00.000Z' }] }
  await mount()
  await click(tab(zh['tab.team']))
  const page = text()
  expect(page).toContain('研究员')
  expect(page).toContain('调研')
  expect(page).toContain('deepseek-account / deepseek-flash')
  expect(page).toContain('跟踪行情并写日报')
  expect(page).toContain('A股日报')
  expect(page).toContain(zh.teamAdmin)
  expect(page).toContain('2 人')
  expect(page).toContain('1 个群')
})

it('maps Ticket stages onto avatar states, strongest Ticket first', async () => {
  expect([ticketAvatarState({ stage: 'person', action: 'answer' }), ticketAvatarState({ stage: 'working' }),
    ticketAvatarState({ stage: 'working', action: 'queued' }), ticketAvatarState({ stage: 'idle' }),
    ticketAvatarState({ stage: 'ended' })]).toEqual(['alert', 'working', 'thinking', 'waiting', 'idle'])
  expect([runAvatarState('running'), runAvatarState('queued'), runAvatarState('waiting'), runAvatarState('ended')])
    .toEqual(['working', 'thinking', 'waiting', 'done'])
  expect(avatarStateOf([{ stage: 'idle' }, { stage: 'working', action: 'queued' }, { stage: 'person', action: 'answer' }])).toBe('alert')
  server.agents = { profiles: [researcher], groups: [{ chatId: 'oc_team', name: 'A股日报', adminProfile: 'researcher', members: [],
    notice: '', createdAt: '2026-11-05T00:00:00.000Z' }] }
  server.tickets.open = [ticketSummary({ threads: [{ key: 'feishu:oc_team:om_1', source: 'feishu', title: '群消息', facts: {} }] },
    { stage: 'person', action: 'answer' })]
  await mount()
  await click(tab(zh['tab.team']))
  expect(document.querySelector('.dt-person-card .dt-avatar')?.getAttribute('data-state')).toBe('alert')
})

it('marks the open profile and every profile with work in flight, and lights its run cards', async () => {
  server.agents = { profiles: [{ ...researcher, id: 'researcher', name: '研究员' }, { ...researcher, id: 'writer', name: '写手' }],
    groups: [{ chatId: 'oc_a', name: 'A股日报', adminProfile: 'researcher', members: [], notice: '', createdAt: '2026-11-05T00:00:00.000Z' },
      { chatId: 'oc_b', name: '研报', adminProfile: 'writer', members: [], notice: '', createdAt: '2026-11-05T00:00:00.000Z' }] }
  server.tickets.open = [
    ticketSummary({ id: 't1', threads: [{ key: 'feishu:oc_a:om_1', source: 'feishu', title: '群消息', facts: {} }] },
      { stage: 'person', action: 'answer' }),
    ticketSummary({ id: 't2', threads: [{ key: 'feishu:oc_b:om_2', source: 'feishu', title: '群消息', facts: {} }] },
      { stage: 'working' })]
  server.runs = { runs: [{ id: 'a2', number: 2, ticketId: 't2', title: '写研报', ticketState: 'open', state: 'running', sessionId: 'worker-t2',
    createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', profileId: 'writer', attachments: [] }] }
  await mount()
  await click(tab(zh['tab.team']))
  const rows = [...document.querySelectorAll<HTMLElement>('.dt-person-list .dt-person-card')]
  // The open profile waits on a person, so its avatar alerts even though no run is in flight.
  expect(rows[0]!.classList.contains('is-selected')).toBe(true)
  expect(rows[0]!.hasAttribute('data-running')).toBe(false)
  expect(rows[0]!.querySelector('.dt-avatar')?.getAttribute('data-state')).toBe('alert')
  // The second has a run in flight: its card carries the running rail and its avatar works.
  expect(rows[1]!.getAttribute('data-running')).toBe('true')
  expect(rows[1]!.querySelector('.dt-avatar')?.getAttribute('data-state')).toBe('working')
  expect(document.querySelector('.dt-profile-head .dt-avatar')?.getAttribute('data-state')).toBe('alert')
  await click(rows[1]!)
  expect(document.querySelector('.dt-run-row')?.getAttribute('data-state')).toBe('running')
})

it('shows the running state of a profile whose Tickets belong to no group, as for a direct message', async () => {
  server.agents = { profiles: [researcher], groups: [] }
  server.tickets.open = [ticketSummary({ id: 't1', threads: [{ key: 'feishu:oc_dm:om_1', source: 'feishu', title: '私聊', facts: {} }] },
    { stage: 'working' })]
  server.runs = { runs: [{ id: 'a1', number: 1, ticketId: 't1', title: '写日报', ticketState: 'open', state: 'running', sessionId: 'worker-t1',
    createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', profileId: 'researcher', attachments: [] }] }
  await mount()
  await click(tab(zh['tab.team']))
  const row = document.querySelector<HTMLElement>('.dt-person-list .dt-person-card')!
  expect(row.getAttribute('data-running')).toBe('true')
  expect(row.querySelector('.dt-avatar')?.getAttribute('data-state')).toBe('working')
  expect(all('.dt-person-list .dt-run-badge').map(badge => badge.textContent)).toEqual(['1'])
  await click(row)
  expect(document.querySelector('.dt-run-row')?.getAttribute('data-state')).toBe('running')
  expect(text()).toContain('写日报')
})

it('says how to create one when the team is empty', async () => {
  await mount()
  await click(tab(zh['tab.team']))
  const page = text()
  expect(page).toContain(zh.teamEmptyProfiles)
  expect(page).toContain(zh.teamEmptyGroups)
})

it('selects a profile and a group inline without leaving the page', async () => {
  server.agents = { profiles: [{ id: 'researcher', name: '研究员', role: '调研', instructions: '跟踪行情并写日报',
    model: { provider: 'deepseek-account', model: 'deepseek-flash' }, workDir: 'D:/work/research', avatar: { color: '#4D6BFE' } }],
  groups: [{ chatId: 'oc_team', name: 'A股日报', adminProfile: 'researcher', members: ['ou_alice', 'ou_bob'], notice: '',
    createdAt: '2026-11-05T00:00:00Z' }] }
  await mount()
  await click(tab(zh['tab.team']))
  const rows = document.querySelectorAll<HTMLElement>('.dt-person-card')
  expect(rows.length).toBe(2)
  // The first profile is selected by default, so its detail is already in the page.
  expect(text()).toContain('跟踪行情并写日报')
  expect(text()).toContain(zh.teamLedGroups)
  // The selected card carries its own avatar ink, which the border and plate read.
  expect(rows[0]!.classList.contains('is-selected')).toBe(true)
  expect(rows[0]!.style.getPropertyValue('--dt-person-ink')).toBe('#4D6BFE')
  // Without an uploaded picture the whale is drawn in that ink, its eye the name's first letter.
  const eye = rows[0]!.querySelector('.dt-avatar-eye')!
  expect(eye.textContent).toBe('研')
  // The letter is anchored in the mark's own box, so it holds its place at every avatar size.
  expect(eye.getAttribute('transform')).toBe('translate(79.05 45.9)')
  expect(eye.getAttribute('font-size')).toBe('30')
  await click(rows[1]!)
  const page = text()
  expect(page).toContain(zh.teamMembers)
  expect(page).toContain('ou_alice')
  expect(page).toContain('oc_team')
  expect(page).toContain(zh.groupMemory)
})

it('twinkles two stars beside the eye of the picked profile on its detail card', async () => {
  server.agents = { profiles: [{ ...researcher, id: 'researcher', name: '研究员' }, { ...researcher, id: 'writer', name: '写手' }],
    groups: [] }
  await mount()
  await click(tab(zh['tab.team']))
  const head = () => document.querySelector('.dt-profile-head .dt-avatar')
  // The detail card carries the sparkle; the side list keeps plain faces so only the picked person draws the eye.
  expect(head()?.querySelectorAll('.dt-avatar-whale .dt-avatar-star').length).toBe(2)
  expect(document.querySelector('.dt-person-list .dt-avatar-star')).toBeNull()
  expect(head()?.querySelector('.dt-avatar-eye')?.textContent).toBe('研')
  await click(all('.dt-person-list .dt-person-card')[1]!)
  // Picking another person redraws the card, so the stars play again at the new eye.
  expect(head()?.querySelector('.dt-avatar-eye')?.textContent).toBe('写')
  expect(head()?.querySelectorAll('.dt-avatar-star').length).toBe(2)
})

it('saves the ink the operator picks, removes an uploaded picture, and resets to the id-derived default', async () => {
  const picture = 'data:image/png;base64,iVBORw0KGgo='
  server.agents = structuredClone(team)
  server.agents.profiles[0]!.avatar = { color: '#4D6BFE', image: picture }
  await mount()
  await click(tab(zh['tab.team']))
  expect(all('.dt-color').length).toBe(AVATAR_INKS.length)
  const file = document.querySelector<HTMLInputElement>('.dt-avatar-file')!
  expect(file.accept).toBe('image/*')
  // The uploaded picture renders as an image, and its remove action clears it.
  expect(document.querySelector('.dt-avatar-img')?.getAttribute('src')).toBe(picture)
  await click(find(zh.teamAvatarRemove))
  expect(server.agents.profiles[0]!.avatar.image).toBeNull()
  await click(all('.dt-color')[3]!)
  expect(server.agents.profiles[0]!.avatar.color).toBe(AVATAR_INKS[3]!.color)
  expect(all('.dt-color')[3]!.getAttribute('aria-pressed')).toBe('true')
  await click(find(zh.teamAvatarReset))
  expect(server.agents.profiles[0]!.avatar).toEqual({ color: inkOfProfile('researcher'), image: null })
})

it('names the skills and MCP servers with a glyph each, so a row reads as one kind of capability', async () => {
  server.agents = structuredClone(team)
  await mount()
  await click(tab(zh['tab.team']))
  const rows = all('.dt-cap-row')
  expect(rows.map(row => row.querySelector('.dt-cap-name')?.textContent)).toEqual(['stock-report', 'market-data'])
  expect(rows.every(row => !!row.querySelector('.dt-cap-icon svg'))).toBe(true)
  expect(text()).toContain(zh.teamCapOn)
})

it('lets the operator put the profile list away and back, and remembers the choice', async () => {
  server.agents = structuredClone(team)
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value) } })
  await mount()
  await click(tab(zh['tab.team']))
  await click(all('.dt-pane-seam')[0]!)
  expect(document.querySelector('.dt-team-split')?.getAttribute('data-pane')).toBe('collapsed')
  expect(all('.dt-pane-seam')[0]!.getAttribute('aria-expanded')).toBe('false')
  await remount()
  expect(kept.get('dsh-superagent-plus.pane.team-list')).toBe('collapsed')
  await click(tab(zh['tab.team']))
  expect(document.querySelector('.dt-pane')?.getAttribute('data-collapsed')).toBe('true')
  await click(all('.dt-pane-seam')[0]!)
  expect(document.querySelector('.dt-team-split')?.hasAttribute('data-pane')).toBe(false)
  expect(kept.get('dsh-superagent-plus.pane.team-list')).toBe('open')
})

it('turns a startable MCP server on and asks for a restart', async () => {
  server.agents = { profiles: [{ id: 'researcher', name: '研究员', role: '', instructions: '', model: null, workDir: '',
    avatar: { color: '#4D6BFE' }, skills: ['web'],
    mcp: [{ name: 'codegraph', enabled: false }, { name: 'ekko-studio-api', enabled: false }] }], groups: [] }
  await mount()
  await click(tab(zh['tab.team']))
  const rows = [...document.querySelectorAll<HTMLButtonElement>('.dt-cap-row.is-action')]
  expect(rows.length).toBe(2)
  expect(rows[1]!.disabled).toBe(true)
  await click(rows[0]!)
  const saved = server.requests.find(request => request.method === 'PUT' && request.path.includes('profiles/researcher/mcp'))
  expect(saved).toBeDefined()
  expect(saved!.body).toMatchObject({ name: 'codegraph', enabled: true })
  expect(text()).toContain(zh.mcpRestartHint)
})

it('starts a new Session from the Profile 人员 header so a profile can be created in conversation', async () => {
  server.agents = { profiles: [], groups: [] }
  await mount()
  await click(tab(zh['tab.team']))
  const button = all('.dt-team-list .dt-panel-head button').find(item => item.getAttribute('title') === zh.teamProfileNewHint)!
  expect(button.textContent).toContain(zh.teamProfileNew)
  await click(button)
  expect(server.started).toBe(1)
  // The fresh Session opens with the profile-making prompt already in its draft.
  expect(server.drafts).toEqual([zh.teamProfilePrompt])
  expect(zh.teamProfilePrompt).toContain('profile_save')
})

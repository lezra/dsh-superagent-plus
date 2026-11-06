/** The Executor profiles and group chats the main Session creates. */
import { describe, expect, it } from 'vitest'
import { Agents, DEFAULT_AVATAR } from '../src/app/agents.ts'

/** The two KV records the registry reads and writes, in memory. */
function store() {
  const records = new Map<string, unknown>()
  return { records, get: (key: string) => records.get(key) as never, set: (key: string, value: unknown) => { records.set(key, value) },
    atomic: <T>(run: () => T): T => run() }
}
const agents = () => new Agents(store() as never)

describe('Executor profiles', () => {
  it('creates a profile with an id from its name, one default avatar, and the model it was given', () => {
    const team = agents()
    const profile = team.create({ name: 'Stock Researcher', role: '调研', instructions: 'Read the market open and close.',
      model: 'deepseek-account/deepseek-flash', effort: 'high' })
    expect(profile).toMatchObject({ id: 'stock-researcher', name: 'Stock Researcher', role: '调研', avatar: DEFAULT_AVATAR,
      model: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' } })
    expect(team.profile('stock-researcher')).toEqual(profile)
    expect(team.profile('STOCK RESEARCHER')).toEqual(profile)
  })

  it('refuses a second profile with the same name rather than renaming it silently', () => {
    const team = agents()
    team.create({ name: 'Editor' })
    expect(() => team.create({ name: 'editor' })).toThrow('A profile named editor already exists')
  })

  it('changes only the fields it is given, and an empty directory or model clears them', () => {
    const team = agents()
    const created = team.create({ name: 'Editor', role: '编辑', workDir: '/srv/editing', model: 'deepseek/deepseek-chat',
      avatar: { color: '#0E9F6E' } })
    const renamed = team.update('Editor', { name: 'Copy Editor', instructions: 'Only copy.', workDir: '', model: '' })
    expect(renamed).toMatchObject({ id: created.id, name: 'Copy Editor', instructions: 'Only copy.', workDir: '', model: null,
      avatar: { color: '#0E9F6E' } })
    expect(() => team.update('nope', { role: 'x' })).toThrow('No profile named nope')
  })

  it('lists profiles and groups together, keeping one entry per group chat', () => {
    const team = agents()
    team.create({ name: 'Researcher' })
    const at = '2026-11-05T00:00:00.000Z'
    team.saveGroup({ chatId: 'oc_1', name: 'Stocks', adminProfile: 'researcher', members: ['ou_a'], notice: '', createdAt: at })
    team.saveGroup({ chatId: 'oc_1', name: 'Stocks daily', adminProfile: 'researcher', members: ['ou_a', 'ou_b'], notice: '', createdAt: at })
    team.saveGroup({ chatId: 'oc_2', name: 'Docs', adminProfile: '', members: [], notice: '', createdAt: at })
    expect(team.view().groups).toMatchObject([{ chatId: 'oc_1', name: 'Stocks daily', members: ['ou_a', 'ou_b'] },
      { chatId: 'oc_2', name: 'Docs' }])
    expect(team.view().profiles).toHaveLength(1)
  })
})

it('keeps the skills and MCP servers an imported profile brings', () => {
  const team = agents()
  const profile = team.create({ name: 'XSIAM Init', role: '初始化', instructions: 'Init a project.',
    skills: ['xsiam-project-init', 'optifex-xsiam-backend'], mcp: [{ name: 'codegraph' }] })
  expect(profile.skills).toEqual(['xsiam-project-init', 'optifex-xsiam-backend'])
  expect(profile.mcp).toEqual([{ name: 'codegraph', enabled: false }])
  expect(team.profile('xsiam-init')).toEqual(profile)
})

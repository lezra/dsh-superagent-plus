/** Profile resolution: person, chat, group, direct-message and default bindings, in that precedence. */
import { expect, it } from 'vitest'
import type { Group, Profile, ProfileBindings } from '../src/app/agents.ts'
import { resolveProfile } from '../src/app/profile-bindings.ts'
import type { Trigger } from '../src/core/index.ts'

const profile = (id: string, name = id): Profile => ({ id, name, role: '', instructions: '', model: null, workDir: '',
  avatar: { color: '#4D6BFE' } })
const group = (chatId: string, adminProfile: string): Group => ({ chatId, name: chatId, adminProfile, members: [], notice: '',
  createdAt: '2026-11-06T00:00:00Z' })
const bindings = (value: Partial<ProfileBindings> = {}): ProfileBindings => ({ chats: {}, actors: {}, ...value })
const trigger = (meta: Record<string, unknown>, actor = 'ou_alice'): Trigger => ({ id: 'e1', source: 'feishu',
  threads: [{ source: 'feishu', id: 'oc_team:om_root' }], actor: { source: 'feishu', id: actor }, human: true,
  at: '2026-11-06T00:00:00Z', text: 'hello', meta })
const lookup = (profiles: Profile[], groups: Group[] = []) => ({
  profile: (ref: string) => profiles.find(item => item.id === ref || item.name.toLowerCase() === ref.trim().toLowerCase()),
  groups: () => groups,
})

it('prefers an explicit choice, then the person, the chat, the group and the defaults', () => {
  const profiles = [profile('explicit'), profile('person'), profile('chat'), profile('group'), profile('direct'), profile('default')]
  const agents = lookup(profiles, [group('oc_team', 'group')])
  const all = bindings({ defaultProfileId: 'default', directProfileId: 'direct', chats: { oc_team: 'chat' },
    actors: { 'feishu:ou_alice': 'person' } })
  expect(resolveProfile(agents, all, trigger({ chatId: 'oc_team' }), 'explicit')?.id).toBe('explicit')
  expect(resolveProfile(agents, all, trigger({ chatId: 'oc_team' }))?.id).toBe('person')
  expect(resolveProfile(agents, all, trigger({ chatId: 'oc_team' }, 'ou_bob'))?.id).toBe('chat')
  expect(resolveProfile(agents, bindings({ defaultProfileId: 'default' }), trigger({ chatId: 'oc_team' }))?.id).toBe('group')
  expect(resolveProfile(agents, all, trigger({ chatId: 'oc_dm', direct: true }, 'ou_bob'))?.id).toBe('direct')
  expect(resolveProfile(agents, bindings({ defaultProfileId: 'default' }), trigger({ chatId: 'oc_other' }, 'ou_bob'))?.id)
    .toBe('default')
})

it('matches a group profile by name for records written before ids were normalized', () => {
  const agents = lookup([profile('researcher', '研究员')], [group('oc_team', '研究员')])
  expect(resolveProfile(agents, bindings(), trigger({ chatId: 'oc_team' }))?.id).toBe('researcher')
})

it('falls through bindings that no longer name an existing profile', () => {
  const agents = lookup([profile('group')], [group('oc_team', 'group')])
  const stale = bindings({ chats: { oc_team: 'deleted' }, actors: { 'feishu:ou_alice': 'gone' } })
  expect(resolveProfile(agents, stale, trigger({ chatId: 'oc_team' }))?.id).toBe('group')
  expect(resolveProfile(lookup([]), stale, trigger({ chatId: 'oc_team' }))).toBeUndefined()
})

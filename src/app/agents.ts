/**
 * The team's Executor profiles and group chats, which the main Session creates for the operator by tool call, not by
 * editing configuration files. A profile is what an Executor Session is told it is; a group is a Feishu chat this
 * deployment opened for one line of work, with the profile that leads it.
 */
import { z } from 'zod'
import { RoleModelSchema, type RoleModel } from '../policy.ts'
import { KV } from '../kv.ts'
import type { Store } from './store.ts'

/** Avatar backgrounds a profile may use, each a fixed hex so the panel and a group card agree. */
export const AVATAR_COLORS = ['#3B82F6', '#0E9F6E', '#D97706', '#DC2626', '#7C3AED', '#0891B2'] as const
/** The hex a profile's avatar may carry, so the panel and a group card agree on the same values. */
export const AvatarColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
/**
 * A profile's avatar: a background colour and an optional uploaded picture. Without a picture the panel draws the
 * name's first letter on the colour, so a profile always has an identity even before anyone picks one.
 */
export const AvatarSchema = z.object({
  color: AvatarColorSchema,
  /** A square image as a data URL, written by the panel's upload; absent or null renders the name's first letter. */
  image: z.string().max(400_000).nullable().optional(),
})
export type Avatar = z.infer<typeof AvatarSchema>
export const DEFAULT_AVATAR: Avatar = { color: AVATAR_COLORS[0] }

export const ProfileSchema = z.object({
  /** Stable id, derived from the name at creation and never rendered as the name. */
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  name: z.string().trim().min(1).max(40),
  /** Two to four characters shown under the name, as a Bot's role label is. */
  role: z.string().trim().max(12).default(''),
  /** What this Executor is responsible for and how it should work, appended to a worker's instructions. */
  instructions: z.string().trim().max(4000).default(''),
  /** Model this profile runs on; the deployment's Executor model when unset. */
  model: RoleModelSchema.nullable().default(null),
  /** Directory its tickets work in; the Execution settings' directory when unset. */
  workDir: z.string().trim().max(500).default(''),
  /** Skills this profile brings, by name; named in the worker's instructions. */
  skills: z.array(z.string().trim().min(1).max(80)).max(64).optional(),
  /** MCP servers the imported profile declared; recorded for reference and never started by this plugin. */
  mcp: z.array(z.object({ name: z.string().trim().min(1).max(80), enabled: z.boolean().default(false) }).strict())
    .max(32).optional(),
  avatar: AvatarSchema.default(() => DEFAULT_AVATAR),
}).strict()
export type Profile = z.infer<typeof ProfileSchema>

export const GroupSchema = z.object({
  /** The Feishu chat this deployment created, which is also its identity. */
  chatId: z.string().regex(/^oc_[a-zA-Z0-9]+$/),
  name: z.string().trim().min(1).max(60),
  /** Profile that leads the group; its tickets are worked by that profile. Empty while none is chosen. */
  adminProfile: z.string().default(''),
  /** People invited, by open_id. */
  members: z.array(z.string().trim().min(1)).default([]),
  /** Shared instructions every request in this group is read with; at most 2000 characters. */
  notice: z.string().trim().max(2000).default(''),
  createdAt: z.string(),
}).strict()
export type Group = z.infer<typeof GroupSchema>

/**
 * Session-level Profile bindings, which choose the Executor Profile for incoming work: one person's, one chat's, the
 * default for direct messages, or the fallback for everything else. Empty bindings keep the group's leading profile.
 */
export const ProfileBindingsSchema = z.object({
  /** Profile for work no more specific binding selects. */
  defaultProfileId: z.string().trim().min(1).optional(),
  /** Profile for direct messages whose sender has no binding of their own. */
  directProfileId: z.string().trim().min(1).optional(),
  /** Profile by chat id, keyed as the Source reports it, such as a Feishu `oc_` id. */
  chats: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
  /** Profile by `source:actor` id; outranks the chat binding, so a person keeps their profile in every chat. */
  actors: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
}).strict()
export type ProfileBindings = z.infer<typeof ProfileBindingsSchema>
const NO_BINDINGS = (): ProfileBindings => ({ chats: {}, actors: {} })

export interface AgentsView { profiles: Profile[]; groups: Group[]; bindings?: ProfileBindings }

/** A name as an id: lower-case ASCII letters and digits, joined by single hyphens. */
export function slugOf(name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28)
  return /^[a-z]/.test(slug) ? slug : `p-${slug || 'profile'}`
}
const modelOf = (value: { model?: string | null; effort?: string | null }): RoleModel | null =>
  value.model ? { provider: value.model.includes('/') ? value.model.slice(0, value.model.indexOf('/')) : 'custom',
    ...(value.model.includes('/') ? { model: value.model.slice(value.model.indexOf('/') + 1) } : { model: value.model }),
    ...(value.effort ? { reasoningEffort: value.effort } : {}) } : null
export interface ProfileInput { name: string; role?: string; instructions?: string; model?: string; effort?: string
  workDir?: string; avatar?: Partial<Avatar>; skills?: string[]; mcp?: { name: string; enabled?: boolean }[] }

/** The profile list and group list, kept as two KV records; every write replaces the whole list in one transaction. */
export class Agents {
  constructor(private readonly store: Pick<Store, 'get' | 'set' | 'atomic'>) {}
  profiles(): Profile[] { return this.store.get(KV.agents.profiles) ?? [] }
  groups(): Group[] { return this.store.get(KV.agents.groups) ?? [] }
  /** The stored bindings; malformed data resolves as no bindings rather than breaking the panel or a pass. */
  bindings(): ProfileBindings {
    const parsed = ProfileBindingsSchema.safeParse(this.store.get(KV.agents.bindings) ?? {})
    return parsed.success ? parsed.data : NO_BINDINGS()
  }
  view(): AgentsView { return { profiles: this.profiles(), groups: this.groups(), bindings: this.bindings() } }
  /** A profile by id or by name, case-insensitively; undefined when there is none. */
  profile(ref: string): Profile | undefined {
    const name = ref.trim().toLowerCase()
    return this.profiles().find(profile => profile.id === name || profile.name.toLowerCase() === name)
  }
  /** Put every profile in the exact order given; the ids must be a complete permutation of the current list. */
  reorder(ids: string[]): Profile[] {
    return this.store.atomic(() => {
      const list = this.profiles()
      const byId = new Map(list.map(profile => [profile.id, profile]))
      if (ids.length !== list.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) {
        throw new Error('Profile order must list every current profile exactly once')
      }
      const next = ids.map(id => byId.get(id)!)
      this.store.set(KV.agents.profiles, next)
      return next
    })
  }
  /** Delete one profile and clear every group lead and binding that points at it. */
  remove(ref: string): Profile {
    return this.store.atomic(() => {
      const list = this.profiles()
      const current = this.profile(ref)
      if (!current) throw new Error(`No profile named ${ref}. Profiles: ${list.map(profile => profile.name).join(', ') || 'none'}`)
      const names = new Set([current.id, current.name.toLowerCase()])
      const pointsAtCurrent = (value: string | undefined): boolean => !!value && names.has(value.trim().toLowerCase())
      this.store.set(KV.agents.profiles, list.filter(profile => profile.id !== current.id))
      const groups = this.groups()
      if (groups.some(group => pointsAtCurrent(group.adminProfile))) {
        this.store.set(KV.agents.groups, groups.map(group => pointsAtCurrent(group.adminProfile)
          ? { ...group, adminProfile: '' } : group))
      }
      const bindings = this.bindings()
      const chats = Object.fromEntries(Object.entries(bindings.chats).filter(([, id]) => !pointsAtCurrent(id)))
      const actors = Object.fromEntries(Object.entries(bindings.actors).filter(([, id]) => !pointsAtCurrent(id)))
      this.store.set(KV.agents.bindings, {
        ...(pointsAtCurrent(bindings.defaultProfileId) ? {} : bindings.defaultProfileId ? { defaultProfileId: bindings.defaultProfileId } : {}),
        ...(pointsAtCurrent(bindings.directProfileId) ? {} : bindings.directProfileId ? { directProfileId: bindings.directProfileId } : {}),
        chats,
        actors,
      })
      return current
    })
  }
  /** Create a profile; a taken name is refused rather than silently renamed, so a rule that names it keeps working. */
  create(input: ProfileInput): Profile {
    return this.store.atomic(() => {
      const list = this.profiles()
      const name = input.name.trim()
      if (list.some(profile => profile.name.toLowerCase() === name.toLowerCase())) throw new Error(`A profile named ${name} already exists`)
      const base = slugOf(name)
      const id = list.some(profile => profile.id === base) ? `${base}-${list.length + 1}` : base
      const profile = ProfileSchema.parse({ id, name, role: input.role ?? '', instructions: input.instructions ?? '',
        model: modelOf(input), workDir: input.workDir ?? '', skills: input.skills ?? [],
        mcp: (input.mcp ?? []).map(item => ({ name: item.name, enabled: item.enabled ?? false })),
        avatar: { ...DEFAULT_AVATAR, color: AVATAR_COLORS[list.length % AVATAR_COLORS.length]!, ...input.avatar } })
      this.store.set(KV.agents.profiles, [...list, profile])
      return profile
    })
  }
  /** Change named fields of one profile; `null` clears a model, an empty string clears text or a directory. */
  update(ref: string, input: Partial<Omit<ProfileInput, 'name'>> & { name?: string }): Profile {
    return this.store.atomic(() => {
      const list = this.profiles()
      const current = this.profile(ref)
      if (!current) throw new Error(`No profile named ${ref}. Profiles: ${list.map(profile => profile.name).join(', ') || 'none'}`)
      const name = input.name?.trim() || current.name
      if (list.some(profile => profile.id !== current.id && profile.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`A profile named ${name} already exists`)
      }
      const next = ProfileSchema.parse({ ...current, ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ...(input.model !== undefined || input.effort !== undefined ? { model: modelOf({ model: input.model ?? current.model?.model ?? null,
          effort: input.effort ?? current.model?.reasoningEffort ?? null }) } : {}),
        ...(input.workDir !== undefined ? { workDir: input.workDir } : {}),
        ...(input.avatar ? { avatar: { ...current.avatar, ...input.avatar } } : {}), name })
      this.store.set(KV.agents.profiles, list.map(profile => profile.id === current.id ? next : profile))
      return next
    })
  }
  /** Turn one MCP server on or off for a profile; a name the profile does not list is refused rather than added. */
  setMcp(ref: string, name: string, enabled: boolean): Profile {
    return this.store.atomic(() => {
      const list = this.profiles()
      const current = this.profile(ref)
      if (!current) throw new Error(`No profile named ${ref}. Profiles: ${list.map(profile => profile.name).join(', ') || 'none'}`)
      if (!current.mcp?.some(server => server.name === name)) throw new Error(`Profile ${current.name} has no MCP server ${name}`)
      const next = ProfileSchema.parse({ ...current, mcp: current.mcp.map(server => server.name === name ? { ...server, enabled } : server) })
      this.store.set(KV.agents.profiles, list.map(profile => profile.id === current.id ? next : profile))
      return next
    })
  }
  /** The MCP servers any profile enables. DSH starts MCP clients per deployment, so this is the deployment's set. */
  enabledMcp(): string[] {
    return [...new Set(this.profiles().flatMap(profile => (profile.mcp ?? []).filter(server => server.enabled)
      .map(server => server.name)))]
  }
  /** Replace the bindings after normalizing every profile reference to its id; an unknown profile is refused. */
  saveBindings(input: ProfileBindings): ProfileBindings {
    return this.store.atomic(() => {
      const id = (ref: string): string => {
        const profile = this.profile(ref)
        if (!profile) throw new Error(`No profile named ${ref}`)
        return profile.id
      }
      const next = ProfileBindingsSchema.parse({
        ...(input.defaultProfileId ? { defaultProfileId: id(input.defaultProfileId) } : {}),
        ...(input.directProfileId ? { directProfileId: id(input.directProfileId) } : {}),
        chats: Object.fromEntries(Object.entries(input.chats).map(([chat, ref]) => [chat, id(ref)])),
        actors: Object.fromEntries(Object.entries(input.actors).map(([actor, ref]) => [actor, id(ref)])),
      })
      this.store.set(KV.agents.bindings, next)
      return next
    })
  }
  saveGroup(group: Group): Group {
    return this.store.atomic(() => {
      const list = this.groups().filter(item => item.chatId !== group.chatId)
      const next = GroupSchema.parse(group)
      this.store.set(KV.agents.groups, [...list, next])
      return next
    })
  }
}

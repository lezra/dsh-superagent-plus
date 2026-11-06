/** Resolves the Executor Profile that runs a Trigger's work, and the compact profile list the main Session chooses from. */
import type { Trigger } from '../core/index.ts'
import type { Group, Profile, ProfileBindings } from './agents.ts'

export interface ProfileLookup {
  profile(ref: string): Profile | undefined
  groups(): Group[]
}
/** The `source:actor` key a person's binding uses. */
export const actorKey = (trigger: Trigger): string => `${trigger.source}:${trigger.actor.id}`
/** The chat id a binding uses, when the Trigger carries one. */
export const chatKey = (trigger: Trigger): string | undefined =>
  typeof trigger.meta.chatId === 'string' && trigger.meta.chatId ? trigger.meta.chatId : undefined

/**
 * Resolve the Profile for `trigger`: an explicit choice wins, then the person's binding, the chat's binding, the group's
 * leading profile, the direct-message default, and finally the deployment default. References that no longer name an
 * existing profile are skipped, so a deleted profile falls through to the next level instead of leaving work unbound.
 */
export function resolveProfile(lookup: ProfileLookup, bindings: ProfileBindings, trigger: Trigger | undefined,
  explicit?: string): Profile | undefined {
  const pick = (ref: string | undefined): Profile | undefined => ref ? lookup.profile(ref) : undefined
  const chat = trigger ? chatKey(trigger) : undefined
  const group = chat ? lookup.groups().find(item => item.chatId === chat)?.adminProfile : undefined
  return pick(explicit)
    ?? (trigger ? pick(bindings.actors[actorKey(trigger)]) : undefined)
    ?? pick(chat ? bindings.chats[chat] : undefined)
    ?? pick(group)
    ?? (trigger?.meta.direct === true ? pick(bindings.directProfileId) : undefined)
    ?? pick(bindings.defaultProfileId)
}

/** The profile list a candidate card or assessment payload carries: enough to choose one, without instructions or capabilities. */
export const profileChoices = (profiles: readonly Profile[]) =>
  profiles.map(({ id, name, role }) => ({ id, name, ...(role ? { role } : {}) }))

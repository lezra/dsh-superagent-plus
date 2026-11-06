/**
 * The DingTalk Source: one self-built robot app's Stream connection becomes Triggers, and each reply goes back to the
 * conversation the message came from. It mirrors the Feishu Source's scope, Policy part and Channel contract.
 */
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { key, type ChannelRef, type Trigger } from '../core/index.ts'
import { DingTalkApi } from './dingtalk-api.ts'
import { DingTalkStream, type StreamSocket } from './dingtalk-stream.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { SourceChannel, SourceKind } from './kind.ts'
import type { SourceRegistry } from './registry.ts'

export const SOURCE = 'dingtalk'
/** The bot message as DingTalk delivers it inside a Stream event's `data`. */
const BotMessageSchema = z.looseObject({
  msgId: z.string().min(1), conversationId: z.string().min(1), conversationType: z.string().default('2'),
  msgtype: z.string().default('text'), text: z.looseObject({ content: z.string().default('') }).optional(),
  senderStaffId: z.string().optional(), senderNick: z.string().optional(), senderId: z.string().optional(),
  createAt: z.number().or(z.string()).optional(), robotCode: z.string().optional(),
  sessionWebhook: z.string().optional(), sessionWebhookExpiredTime: z.number().or(z.string()).optional(),
  isInAtList: z.boolean().optional(), atUsers: z.array(z.looseObject({ staffId: z.string().optional() })).optional(),
})
export type DingTalkBotMessage = z.infer<typeof BotMessageSchema>

export const DingTalkConfigSchema = z.object({
  appKey: z.string().trim().default(''),
  /** Stored with the Source's configuration; use a dedicated app for this deployment. */
  appSecret: z.string().trim().default(''),
  /** Robot code that sends proactive messages; the message's own `robotCode` is preferred when present. */
  robotCode: z.string().trim().default(''),
  chats: z.array(z.object({ chatId: z.string().trim().min(4).max(200), name: z.string().trim().max(60).optional(),
    listen: z.enum(['mentions', 'all']) }).strict())
    .refine(chats => new Set(chats.map(chat => chat.chatId)).size === chats.length, 'Duplicate conversation IDs').default([]),
  directMessages: z.boolean().default(true),
  otherChats: z.enum(['none', 'mentions']).default('none'),
}).strict()
export type DingTalkConfig = z.infer<typeof DingTalkConfigSchema>
/** Settings this Source's configuration owns; changing them restarts dsh-superagent so the Stream reconnects with new credentials. */
export const DINGTALK_SETUP_FIELDS = ['appKey', 'appSecret', 'robotCode'] as const

export const dingtalkThreadId = (conversationId: string): string => `dingtalk:${conversationId}`
export const dingtalkTriggerId = (messageId: string): string => key(SOURCE, messageId)
/** The reply address of a bot message, including the temporary webhook it arrived with. */
export const dingtalkChannel = (message: DingTalkBotMessage, direct: boolean): ChannelRef => ({ source: SOURCE,
  thread: dingtalkThreadId(message.conversationId),
  address: { chatId: message.conversationId, messageId: message.msgId, ...direct ? { direct: 'true' } : {},
    ...message.sessionWebhook ? { webhook: message.sessionWebhook } : {},
    ...message.sessionWebhookExpiredTime ? { expiresAt: String(message.sessionWebhookExpiredTime) } : {},
    ...message.robotCode ? { robotCode: message.robotCode } : {},
    ...message.senderStaffId ? { userId: message.senderStaffId } : {} } })
const textOf = (message: DingTalkBotMessage): string => message.msgtype === 'text' ? message.text?.content?.trim() ?? ''
  : message.msgtype === 'picture' ? '[image]' : `[${message.msgtype}]`
const at = (value: string | number | undefined): string => {
  const time = value === undefined ? Date.now() : typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : Date.parse(value)
  return new Date(Number.isFinite(time) ? time : Date.now()).toISOString()
}
/** Converts one bot message into a Trigger; undefined for the bot's own messages and for anything without a sender. */
export function dingtalkTrigger(input: unknown): Trigger | undefined {
  const parsed = BotMessageSchema.safeParse(input)
  if (!parsed.success) return
  const message = parsed.data
  const sender = message.senderStaffId ?? message.senderId
  if (!sender) return
  const direct = message.conversationType === '1'
  const mentioned = message.isInAtList === true || (message.atUsers ?? []).some(user => !!user.staffId)
  return { id: dingtalkTriggerId(message.msgId), source: SOURCE, threads: [{ source: SOURCE, id: dingtalkThreadId(message.conversationId) }],
    actor: { source: SOURCE, id: sender }, human: !!message.senderStaffId,
    ...(direct ? { addressed: 'direct' as const } : mentioned ? { addressed: 'mention' as const } : {}),
    at: at(message.createAt), text: textOf(message), channel: dingtalkChannel(message, direct),
    meta: { chatId: message.conversationId, messageId: message.msgId, direct, mentioned, ...message.senderNick ? { actorName: message.senderNick } : {} } }
}

/** The sends the reply Channel needs; the real API implements it, and a test can pass its own. */
export interface DingTalkSender {
  replyWebhook(webhook: string, title: string, text: string): Promise<void>
  sendGroup(robotCode: string, chatId: string, title: string, text: string): Promise<void>
  sendDirect(robotCode: string, userIds: string[], title: string, text: string): Promise<void>
}
/** One live robot, shared by the Stream loop that receives and the Channel that sends; replaced on every reconnect cycle. */
let live: { api: DingTalkSender; config: DingTalkConfig } | undefined
/** Points the reply Channel at the sender and configuration a watch loop is using, and clears it when the loop stops. */
export function useDingTalkTransport(next: { api: DingTalkSender; config: DingTalkConfig } | undefined): void { live = next }
/** Points the reply Channel at the API and configuration a watch loop is using, and clears it when the loop stops. */
const channel: SourceChannel<DingTalkConfig> = {
  // A reply goes to a conversation the Source still receives.
  allowed: (address, config) => dingtalkKind.scope!({ meta: { chatId: address.chatId ?? '', direct: address.direct === 'true' } }, config).listened,
  async send(_host, message) {
    if (!live) throw new Error('The DingTalk Source is not running')
    const address = message.channel.address
    const robotCode = address.robotCode || live.config.robotCode
    const title = 'dsh-superagent'
    if (address.webhook && Number(address.expiresAt ?? 0) > Date.now()) {
      await live.api.replyWebhook(address.webhook, title, message.text)
      return 'sent'
    }
    if (address.userId) {
      await live.api.sendDirect(robotCode, [address.userId], title, message.text)
      return 'sent'
    }
    if (!address.chatId) throw new Error('Missing DingTalk conversation')
    await live.api.sendGroup(robotCode, address.chatId, title, message.text)
    return 'sent'
  },
  link: address => ({ url: '', label: { zh: '钉钉消息', en: 'DingTalk message' }, ...address.messageId ? { triggerId: dingtalkTriggerId(address.messageId) } : {} }),
}

export const dingtalkKind: SourceKind<DingTalkConfig> = {
  kind: SOURCE,
  title: { zh: '钉钉', en: 'DingTalk' },
  description: { zh: '通过自建应用的机器人接收 @ 消息与私聊，并在原会话里回复。', en: 'Receives @ mentions and direct messages through a self-built robot app, and replies in the same conversation.' },
  schema: DingTalkConfigSchema,
  fields: [
    { key: 'appKey', type: 'text', label: { zh: 'AppKey', en: 'AppKey' },
      hint: { zh: '飞书之外的企业自建应用 AppKey；机器人需要 Stream 模式与接收消息权限。', en: 'The AppKey of a self-built DingTalk app; its robot needs Stream mode and message permissions.' } },
    { key: 'appSecret', type: 'text', secret: true, label: { zh: 'AppSecret', en: 'AppSecret' },
      hint: { zh: '保存在这个部署的设置数据库里；请为它单独建一个应用。保存后重启 dsh-superagent 并重新连接 Stream。', en: 'Stored in this deployment\'s settings database; use a dedicated app. Saving restarts dsh-superagent and reconnects the Stream.' } },
    { key: 'robotCode', type: 'text', label: { zh: 'RobotCode', en: 'RobotCode' },
      hint: { zh: '主动发消息用的机器人编码；消息自带 robotCode 时优先用消息里的。', en: 'The robot code used for proactive messages; the one carried by a message wins when present.' } },
    { key: 'chats', type: 'rows', label: { zh: '接收的会话', en: 'Conversations' },
      hint: { zh: '“仅 @”只接收被 @ 的消息；“全部消息”也接收其余消息。', en: '"@ only" receives mentions; "All" also receives the rest.' },
      columns: [{ key: 'chatId', type: 'text', label: { zh: '会话 ID', en: 'Conversation ID' }, pattern: '[A-Za-z0-9+/=:_-]{4,200}' },
        { key: 'listen', type: 'select', label: { zh: '接收', en: 'Receive' }, options: [{ value: 'mentions', label: { zh: '仅 @', en: '@ only' } }, { value: 'all', label: { zh: '全部消息', en: 'All' } }] }] },
    { key: 'directMessages', type: 'switch', label: { zh: '接收私聊', en: 'Direct messages' } },
    { key: 'otherChats', type: 'select', label: { zh: '其他群', en: 'Other chats' }, options: [{ value: 'none', label: { zh: '不接收', en: 'Not received' } }, { value: 'mentions', label: { zh: '仅 @', en: '@ only' } }] },
  ],
  health: ['dingtalk'],
  scope({ meta }, config) {
    if (meta.direct === true) return config.directMessages ? { listened: true, observed: false, row: 'direct' } : { listened: false, reason: 'direct_messages_not_allowed' }
    const chat = config.chats.find(item => item.chatId === meta.chatId)
    if (chat) return { listened: true, observed: chat.listen === 'all', row: chat.chatId }
    return config.otherChats === 'mentions' ? { listened: true, observed: false, row: 'other' } : { listened: false, reason: 'chat_not_allowed' }
  },
  channel,
  policy: {
    unnamed: { person: { zh: '钉钉用户', en: 'DingTalk user' }, bot: { zh: '钉钉机器人', en: 'DingTalk bot' } },
    schema: z.object({ allowed: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), name: z.string().trim().max(100).optional() }).strict())
      .refine(users => new Set(users.map(user => user.id)).size === users.length, 'Duplicate DingTalk user ids').default([]) }).strict(),
    fields: [
      { key: 'allowed', type: 'rows', label: { zh: '能发起工作的钉钉用户', en: 'DingTalk users who may originate work' },
        columns: [{ key: 'id', type: 'text', label: { zh: 'staffId', en: 'staffId' } }, { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
    ],
    explicit: { zh: '名单内的人 @ 机器人或私聊机器人，总是明确的请求。', en: 'Someone on the list who mentions the robot or messages it directly always makes an explicit request.' },
  },
  environment: {
    variables: [{ key: 'DSH_SUPERAGENT_DINGTALK_CHAT', description: { zh: '接下工单的钉钉会话 ID；工单不是从钉钉来的时为空', en: 'Conversation ID of the DingTalk chat that started the ticket; empty when the ticket did not start on DingTalk' } }],
    values: ({ trigger }) => ({ DSH_SUPERAGENT_DINGTALK_CHAT: trigger?.source === SOURCE ? String(trigger.meta.chatId ?? '') : '' }),
  },
}

/** Reports the Source's health, then runs the Stream connection until the plugin stops. */
/** The transport a watch loop uses; tests pass fakes, production builds the API and a WebSocket from the configuration. */
export interface DingTalkTransport {
  open(): Promise<{ endpoint: string; ticket: string }>
  socket(url: string): StreamSocket
  /** The sender the reply Channel uses; production builds the API from the configuration. */
  api?: DingTalkSender
}
/** Runs the Stream watch loop until `signal` aborts, using `transport` when given. */
export async function runDingTalk(ctx: SourceContext, signal: AbortSignal, transport?: DingTalkTransport): Promise<void> {
  while (!signal.aborted) {
    const config = ctx.config<DingTalkConfig>(SOURCE)
    if (!config) {
      ctx.report('dingtalk', health('paused', 'sourceOff'))
      await delay(5000, undefined, { signal }).catch(() => {})
      continue
    }
    if (!config.appKey || !config.appSecret) {
      ctx.report('dingtalk', health('paused', 'dingtalkUnset'))
      await delay(5000, undefined, { signal }).catch(() => {})
      continue
    }
    const realApi = new DingTalkApi({ appKey: config.appKey, appSecret: config.appSecret })
    const api: DingTalkSender = transport?.api ?? realApi
    useDingTalkTransport({ api, config })
    const source: DingTalkTransport = transport ?? {
      open: () => realApi.openStream(),
      socket: url => new (globalThis as unknown as { WebSocket: new (url: string) => StreamSocket }).WebSocket(url),
    }
    const stream = new DingTalkStream({
      open: async () => { const { endpoint, ticket } = await source.open(); return `${endpoint}?ticket=${encodeURIComponent(ticket)}` },
      socket: url => source.socket(url),
      event: (_topic, data) => {
        const trigger = dingtalkTrigger(data)
        if (trigger) void ctx.receive(trigger)
      },
      report: (state, detail) => ctx.report('dingtalk', { state: state === 'ready' ? 'ready' : state === 'error' ? 'error' : 'starting', detail }),
      retry: attempt => Math.min(1000 * 2 ** attempt, 60_000),
      now: () => Date.now(),
    })
    await stream.start()
    await new Promise<void>(resolve => { signal.addEventListener('abort', () => { stream.stop(); resolve() }, { once: true }) })
    useDingTalkTransport(undefined)
    return
  }
}

export const name = 'dsh-superagent-dingtalk'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(dingtalkKind), 'dingtalk: source kind')
  ctx.effect(() => {
    const controller = new AbortController()
    const running = runDingTalk(sourceContext(ctx.orchestrator, dingtalkKind), controller.signal)
    return async () => { controller.abort(); await running }
  })
}
/** The DingTalk Source's settings, falling back to schema defaults while the DingTalk plugin is disabled. */
export const dingtalkSettings = (sources: SourceRegistry): DingTalkConfig => sources.instance<DingTalkConfig>(SOURCE)?.config ?? DingTalkConfigSchema.parse({})

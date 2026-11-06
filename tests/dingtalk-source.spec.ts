/** The DingTalk Source's trigger mapping, listening scope and configuration. */
import { expect, it } from 'vitest'
import { dingtalkChannel, DingTalkConfigSchema, dingtalkKind, dingtalkThreadId, dingtalkTrigger, dingtalkTriggerId } from '../src/sources/dingtalk.ts'

const message = {
  msgId: 'msg-1', conversationId: 'cid-group-1', conversationType: '2', msgtype: 'text',
  text: { content: '  请修一下标题  ' }, senderStaffId: 'staff-1', senderNick: 'Alex', createAt: 1762300000000,
  robotCode: 'robot-1', sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
  sessionWebhookExpiredTime: 1762303600000, isInAtList: true,
}

it('maps a group @ message into a Trigger with its reply address', () => {
  expect(dingtalkTrigger(message)).toEqual({ id: dingtalkTriggerId('msg-1'), source: 'dingtalk',
    threads: [{ source: 'dingtalk', id: dingtalkThreadId('cid-group-1') }], actor: { source: 'dingtalk', id: 'staff-1' },
    human: true, addressed: 'mention', at: new Date(1762300000000).toISOString(), text: '请修一下标题',
    channel: dingtalkChannel(message as never, false),
    meta: { chatId: 'cid-group-1', messageId: 'msg-1', direct: false, mentioned: true, actorName: 'Alex' } })
})

it('marks a direct message addressed, and keeps its webhook for the reply', () => {
  const trigger = dingtalkTrigger({ ...message, conversationType: '1', isInAtList: false })!
  expect(trigger.addressed).toBe('direct')
  expect(trigger.meta.direct).toBe(true)
  expect(trigger.channel?.address).toMatchObject({ chatId: 'cid-group-1', messageId: 'msg-1', direct: 'true',
    webhook: message.sessionWebhook, expiresAt: String(message.sessionWebhookExpiredTime), robotCode: 'robot-1', userId: 'staff-1' })
})

it('describes non-text messages, and drops a message with no sender', () => {
  expect(dingtalkTrigger({ ...message, msgtype: 'picture', text: undefined })!.text).toBe('[image]')
  expect(dingtalkTrigger({ ...message, senderStaffId: undefined, senderId: undefined })).toBeUndefined()
  expect(dingtalkTrigger({ not: 'a message' })).toBeUndefined()
})

it('listens to configured conversations, direct messages and other chats as configured', () => {
  const config = DingTalkConfigSchema.parse({ appKey: 'k', appSecret: 's',
    chats: [{ chatId: 'cid-group-1', listen: 'all' }, { chatId: 'cid-group-2', listen: 'mentions' }] })
  const scope = (meta: Record<string, unknown>) => dingtalkKind.scope!({ meta }, config)
  expect(scope({ chatId: 'cid-group-1', direct: false })).toEqual({ listened: true, observed: true, row: 'cid-group-1' })
  expect(scope({ chatId: 'cid-group-2', direct: false })).toEqual({ listened: true, observed: false, row: 'cid-group-2' })
  expect(scope({ chatId: 'cid-group-3', direct: false })).toEqual({ listened: false, reason: 'chat_not_allowed' })
  expect(scope({ chatId: 'cid-dm', direct: true })).toEqual({ listened: true, observed: false, row: 'direct' })
  const closed = DingTalkConfigSchema.parse({ appKey: 'k', appSecret: 's', directMessages: false, otherChats: 'mentions' })
  expect(dingtalkKind.scope!({ meta: { chatId: 'cid-dm', direct: true } }, closed)).toEqual({ listened: false, reason: 'direct_messages_not_allowed' })
  expect(dingtalkKind.scope!({ meta: { chatId: 'cid-other', direct: false } }, closed)).toEqual({ listened: true, observed: false, row: 'other' })
})

it('allows a reply only to a conversation the Source still receives', () => {
  const config = DingTalkConfigSchema.parse({ appKey: 'k', appSecret: 's', chats: [{ chatId: 'cid-group-1', listen: 'mentions' }] })
  expect(dingtalkKind.channel!.allowed!({ chatId: 'cid-group-1', messageId: 'm' }, config)).toBe(true)
  expect(dingtalkKind.channel!.allowed!({ chatId: 'cid-elsewhere', messageId: 'm' }, config)).toBe(false)
})

it('rejects duplicate conversations and fills defaults', () => {
  const config = DingTalkConfigSchema.parse({})
  expect(config).toMatchObject({ appKey: '', appSecret: '', robotCode: '', chats: [], directMessages: true, otherChats: 'none' })
  expect(() => DingTalkConfigSchema.parse({ chats: [{ chatId: 'cid-1', listen: 'all' }, { chatId: 'cid-1', listen: 'mentions' }] }))
    .toThrow('Duplicate conversation IDs')
})

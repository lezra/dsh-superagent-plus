/** The DingTalk reply Channel: a live webhook first, then a group or one-to-one send. */
import { afterEach, expect, it, vi } from 'vitest'
import { DingTalkConfigSchema, dingtalkKind, dingtalkTriggerId, useDingTalkTransport } from '../src/sources/dingtalk.ts'
import type { DingTalkApi } from '../src/sources/dingtalk-api.ts'
import type { SourceContext } from '../src/sources/host.ts'
import type { OutboundMessage } from '../src/core/index.ts'

const config = DingTalkConfigSchema.parse({ appKey: 'k', appSecret: 's', robotCode: 'robot-code',
  chats: [{ chatId: 'cid-group', listen: 'all' }] })
const host = {} as unknown as Pick<SourceContext, 'commands'>
const api = { replyWebhook: vi.fn(async () => {}), sendGroup: vi.fn(async () => {}), sendDirect: vi.fn(async () => {}) }
const message = (address: Record<string, string>): OutboundMessage => ({ id: 'reply-1', kind: 'reply', channel: { source: 'dingtalk', thread: 'dingtalk:cid-group',
  address }, text: '报告已完成' })
const send = (address: Record<string, string>) => dingtalkKind.channel!.send(host, message(address))

afterEach(() => { useDingTalkTransport(undefined); vi.clearAllMocks() })

it('replies through the message webhook while it is valid', async () => {
  useDingTalkTransport({ api: api as unknown as DingTalkApi, config })
  await expect(send({ chatId: 'cid-group', messageId: 'm1', webhook: 'https://oapi.dingtalk.com/robot/sendBySession?s=1',
    expiresAt: String(Date.now() + 60_000) })).resolves.toBe('sent')
  expect(api.replyWebhook).toHaveBeenCalledWith('https://oapi.dingtalk.com/robot/sendBySession?s=1', 'dsh-superagent', '报告已完成')
  expect(api.sendGroup).not.toHaveBeenCalled()
})

it('falls back to a group send with the robot code the message carries', async () => {
  useDingTalkTransport({ api: api as unknown as DingTalkApi, config })
  await send({ chatId: 'cid-group', messageId: 'm1', robotCode: 'msg-robot', webhook: 'https://expired.test/hook',
    expiresAt: String(Date.now() - 1000) })
  expect(api.sendGroup).toHaveBeenCalledWith('msg-robot', 'cid-group', 'dsh-superagent', '报告已完成')
  expect(api.replyWebhook).not.toHaveBeenCalled()
})

it('answers a direct message through the one-to-one send', async () => {
  useDingTalkTransport({ api: api as unknown as DingTalkApi, config })
  await send({ chatId: 'cid-dm', direct: 'true', userId: 'staff-1', messageId: 'm2' })
  expect(api.sendDirect).toHaveBeenCalledWith('robot-code', ['staff-1'], 'dsh-superagent', '报告已完成')
})

it('refuses to reply while the Source is not running, and only to a conversation it receives', async () => {
  await expect(send({ chatId: 'cid-group', messageId: 'm1' })).rejects.toThrow('not running')
  expect(dingtalkKind.channel!.allowed!({ chatId: 'cid-group', messageId: 'm1' }, config)).toBe(true)
  expect(dingtalkKind.channel!.allowed!({ chatId: 'cid-elsewhere', messageId: 'm1' }, config)).toBe(false)
})

it('links a reply back to its message', () => {
  const link = dingtalkKind.channel!.link({ chatId: 'cid-group', messageId: 'm1' }, { deployment: undefined } as never)
  expect(link.triggerId).toBe(dingtalkTriggerId('m1'))
  expect(link.label).toEqual({ zh: '钉钉消息', en: 'DingTalk message' })
})

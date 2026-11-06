/** The DingTalk watch loop: connect a Stream, acknowledge a bot message, and hand its Trigger to the host. */
import { expect, it, vi } from 'vitest'
import { DingTalkConfigSchema, dingtalkKind, runDingTalk, type DingTalkTransport } from '../src/sources/dingtalk.ts'
import type { StreamSocket } from '../src/sources/dingtalk-stream.ts'
import type { ChannelRef } from '../src/core/index.ts'
import type { SourceContext } from '../src/sources/host.ts'

class FakeSocket {
  readonly sent: string[] = []
  closed = false
  private readonly listeners = new Map<string, ((event?: unknown) => void)[]>()
  send(data: string): void { this.sent.push(data) }
  close(): void { this.closed = true }
  addEventListener(type: string, listener: (event?: never) => void): void {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener as (event?: unknown) => void])
  }
  listening(type: string): boolean { return (this.listeners.get(type)?.length ?? 0) > 0 }
  emit(type: string, event?: unknown): void { for (const listener of this.listeners.get(type) ?? []) listener(event) }
}

const message = { msgId: 'm1', conversationId: 'cid-1', conversationType: '2', msgtype: 'text', text: { content: ' 你好 ' },
  senderStaffId: 'staff-1', senderNick: 'Alex', createAt: 1762300000000, robotCode: 'r1', isInAtList: true }

it('connects, acknowledges a bot message, and hands its Trigger to the host', async () => {
  const socket = new FakeSocket()
  const transport: DingTalkTransport = { open: async () => ({ endpoint: 'wss://stream.test/connect', ticket: 'tk' }), socket: () => socket as unknown as StreamSocket }
  const config = DingTalkConfigSchema.parse({ appKey: 'k', appSecret: 's', directMessages: true, otherChats: 'mentions' })
  const receive = vi.fn(async (_trigger: unknown) => {})
  const report = vi.fn()
  const ctx = { config: () => config, report, receive } as unknown as SourceContext
  const controller = new AbortController()
  const running = runDingTalk(ctx, controller.signal, transport)
  await vi.waitFor(() => { expect(report).toHaveBeenCalled() })
  await vi.waitFor(() => { expect(socket.listening('message')).toBe(true) })
  socket.emit('open')
  socket.emit('message', { data: JSON.stringify({ type: 'EVENT', headers: { topic: '/v1.0/im/bot/messages/get', messageId: 'm1' },
    data: JSON.stringify(message) }) })
  await vi.waitFor(() => { expect(receive).toHaveBeenCalledTimes(1) })
  // Every event is acknowledged by its messageId, before it is handled.
  expect(socket.sent[0]).toContain('"messageId":"m1"')
  expect(receive.mock.calls[0]![0]).toMatchObject({ source: 'dingtalk', text: '你好', addressed: 'mention', actor: { id: 'staff-1' } })
  controller.abort()
  await running
  expect(socket.closed).toBe(true)
})

it('reports paused and sends nothing while the credentials are missing', async () => {
  const config = DingTalkConfigSchema.parse({})
  const receive = vi.fn(async (_trigger: unknown) => {})
  const report = vi.fn()
  const ctx = { config: () => config, report, receive } as unknown as SourceContext
  const controller = new AbortController()
  const running = runDingTalk(ctx, controller.signal, { open: async () => { throw new Error('must not connect') }, socket: () => new FakeSocket() as unknown as StreamSocket })
  await vi.waitFor(() => { expect(report).toHaveBeenCalled() })
  expect(report.mock.calls[0]![1]).toMatchObject({ state: 'paused', code: 'dingtalkUnset' })
  controller.abort()
  await running
  expect(receive).not.toHaveBeenCalled()
})

it('replies to the conversation a message came from, through its webhook', async () => {
  const socket = new FakeSocket()
  const replyWebhook = vi.fn(async () => {})
  const sendGroup = vi.fn(async () => {})
  const api = { replyWebhook, sendGroup, sendDirect: vi.fn(async () => {}) }
  const transport: DingTalkTransport = { open: async () => ({ endpoint: 'wss://stream.test/connect', ticket: 'tk' }),
    socket: () => socket as unknown as StreamSocket, api }
  const config = DingTalkConfigSchema.parse({ appKey: 'k', appSecret: 's', chats: [{ chatId: 'cid-1', listen: 'all' }] })
  const receive = vi.fn(async (_trigger: unknown) => {})
  const ctx = { config: () => config, report: vi.fn(), receive } as unknown as SourceContext
  const controller = new AbortController()
  const running = runDingTalk(ctx, controller.signal, transport)
  await vi.waitFor(() => { expect(socket.listening('message')).toBe(true) })
  const delivered = { ...message, sessionWebhook: 'https://hook.test/s', sessionWebhookExpiredTime: Date.now() + 60_000 }
  socket.emit('message', { data: JSON.stringify({ type: 'EVENT', headers: { messageId: 'm1' }, data: JSON.stringify(delivered) }) })
  await vi.waitFor(() => { expect(receive).toHaveBeenCalledTimes(1) })
  const trigger = receive.mock.calls[0]![0] as { channel: ChannelRef }
  expect(dingtalkKind.channel!.allowed!(trigger.channel.address, config)).toBe(true)
  const reply = await dingtalkKind.channel!.send({} as never, { id: 'reply-1', kind: 'reply', channel: trigger.channel, text: '收到' })
  expect(reply).toBe('sent')
  expect(replyWebhook).toHaveBeenCalledWith('https://hook.test/s', 'dsh-superagent', '收到')
  expect(sendGroup).not.toHaveBeenCalled()
  controller.abort()
  await running
})

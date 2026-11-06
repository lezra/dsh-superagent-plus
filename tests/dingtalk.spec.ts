/** The DingTalk OpenAPI adapter and the Stream frame protocol, against a fake gateway. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOT_TOPIC, DingTalkApi, DingTalkError } from '../src/sources/dingtalk-api.ts'
import { DingTalkStream, ackOf, parseFrame, type StreamHost, type StreamSocket } from '../src/sources/dingtalk-stream.ts'

const credentials = { appKey: 'ding-app', appSecret: 'secret' }
interface Call { url: string; init?: RequestInit }
/** A fetch that answers from `routes`, keyed by path suffix, and records every call. */
function gateway(routes: Record<string, (body: Record<string, unknown>) => Record<string, unknown>>) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    const route = Object.entries(routes).find(([path]) => url.includes(path))
    if (!route) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(route[1](body)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchImpl, calls, body: (index: number) => JSON.parse(String(calls[index]?.init?.body)) as Record<string, unknown> }
}
/** A socket whose listeners the test fires by hand. */
class FakeSocket implements StreamSocket {
  readonly sent: string[] = []
  readonly listeners = new Map<string, ((event: never) => void)[]>()
  closed = false
  constructor(readonly url: string) {}
  send(data: string): void { this.sent.push(data) }
  close(): void { this.closed = true }
  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener])
  }
  emit(type: string, event: unknown = {}): void { for (const listener of this.listeners.get(type) ?? []) (listener as (value: unknown) => void)(event) }
}

afterEach(() => { vi.useRealTimers() })

describe('DingTalk OpenAPI', () => {
  it('caches the access token until shortly before it expires, then asks again', async () => {
    let now = 0
    const { fetchImpl, calls } = gateway({ '/v1.0/oauth2/accessToken': () => ({ accessToken: 'token-1', expireIn: 7200 }) })
    const api = new DingTalkApi(credentials, fetchImpl, () => now)
    expect(await api.accessToken()).toBe('token-1')
    expect(await api.accessToken()).toBe('token-1')
    expect(calls).toHaveLength(1)
    now = 7200_000 + 1
    expect(await api.accessToken()).toBe('token-1')
    expect(calls).toHaveLength(2)
  })

  it('opens a Stream connection subscribed to the bot topic with the app credentials', async () => {
    const { fetchImpl, calls, body } = gateway({ '/v1.0/gateway/connections/open': () => ({ endpoint: 'wss://stream.example/connect', ticket: 't-1' }) })
    const api = new DingTalkApi(credentials, fetchImpl)
    expect(await api.openStream()).toEqual({ endpoint: 'wss://stream.example/connect', ticket: 't-1' })
    expect(calls[0]!.url).toBe('https://api.dingtalk.com/v1.0/gateway/connections/open')
    expect(body(0)).toMatchObject({ clientId: 'ding-app', clientSecret: 'secret',
      subscriptions: [{ type: 'CALLBACK', topic: BOT_TOPIC }] })
  })

  it('sends a markdown robot message to a group with the bearer token', async () => {
    const { fetchImpl, calls, body } = gateway({ '/v1.0/oauth2/accessToken': () => ({ accessToken: 'token-1', expireIn: 7200 }),
      '/v1.0/robot/groupMessages/send': () => ({ processQueryKey: 'q' }) })
    const api = new DingTalkApi(credentials, fetchImpl)
    await api.sendGroup('robot-1', 'cid-group', 'Done', '**done**')
    expect(calls[1]!.url).toBe('https://api.dingtalk.com/v1.0/robot/groupMessages/send')
    expect((calls[1]!.init?.headers as Record<string, string>)['x-acs-dingtalk-access-token']).toBe('token-1')
    expect(body(1)).toMatchObject({ robotCode: 'robot-1', openConversationId: 'cid-group', msgKey: 'sampleMarkdown' })
    expect(JSON.parse(String(body(1).msgParam))).toEqual({ title: 'Done', text: '**done**' })
  })

  it('reports the HTTP status and DingTalk code of a refused call', async () => {
    const fetchImpl = vi.fn(async (url: string) => url.includes('/v1.0/oauth2/accessToken')
      ? new Response(JSON.stringify({ accessToken: 'token-1', expireIn: 7200 }), { status: 200 })
      : new Response(JSON.stringify({ code: 'Forbidden.AccessDenied', message: 'no scope' }), { status: 403 })) as unknown as typeof fetch
    const api = new DingTalkApi(credentials, fetchImpl)
    await expect(api.sendDirect('robot-1', ['user-1'], 'Done', 'done')).rejects.toMatchObject({ name: 'DingTalkError',
      detail: 'Forbidden.AccessDenied /v1.0/robot/oToMessages/batchSend' })
    await expect(api.sendDirect('robot-1', ['user-1'], 'Done', 'done')).rejects.toBeInstanceOf(DingTalkError)
  })
})

describe('Stream frames', () => {
  it('decodes a robot callback whose data is a JSON string, and the acknowledgement it needs', () => {
    const frame = parseFrame(JSON.stringify({ type: 'CALLBACK', headers: { topic: BOT_TOPIC, messageId: 'm-1', contentType: 'application/json' },
      data: JSON.stringify({ text: { content: ' hello ' }, conversationId: 'cid' }) }))!
    expect(frame).toMatchObject({ type: 'CALLBACK', topic: BOT_TOPIC, messageId: 'm-1', data: { text: { content: ' hello ' } } })
    expect(JSON.parse(ackOf(frame))).toEqual({ code: 200, headers: { contentType: 'application/json', messageId: 'm-1' }, message: 'OK',
      data: JSON.stringify({ response: {} }) })
  })

  it('acks an event with its status and a ping by echoing its headers and data', () => {
    expect(JSON.parse(ackOf({ type: 'EVENT', messageId: 'm-2' }))).toEqual({ code: 200,
      headers: { contentType: 'application/json', messageId: 'm-2' }, message: 'OK', data: JSON.stringify({ status: 'SUCCESS' }) })
    expect(parseFrame(JSON.stringify({ type: 'SYSTEM', headers: { topic: 'ping', messageId: 'p-1' }, data: 'pong' })))
      .toMatchObject({ type: 'SYSTEM', topic: 'ping', data: 'pong' })
    expect(JSON.parse(ackOf({ type: 'SYSTEM', topic: 'ping', headers: { topic: 'ping', messageId: 'p-1' }, data: 'pong' })))
      .toEqual({ code: 200, headers: { topic: 'ping', messageId: 'p-1' }, message: 'OK', data: 'pong' })
  })

  it('ignores frames that are not JSON or carry no type', () => {
    expect(parseFrame('not json')).toBeUndefined()
    expect(parseFrame(JSON.stringify({ headers: { topic: 'ping' } }))).toBeUndefined()
  })
})

describe('Stream connection', () => {
  function host(overrides: Partial<StreamHost> = {}) {
    const sockets: FakeSocket[] = []
    const events: { topic: string; data: unknown; messageId?: string }[] = []
    const value: StreamHost = {
      open: vi.fn(async () => 'wss://stream.example/connect?ticket=t-1'),
      socket: vi.fn((url: string) => { const socket = new FakeSocket(url); sockets.push(socket); return socket }),
      event: vi.fn((topic: string, data: unknown, messageId?: string) => { events.push({ topic, data, messageId }) }),
      report: vi.fn(),
      retry: vi.fn(() => 1000),
      now: () => 0,
      ...overrides,
    }
    return { value, sockets, events }
  }

  it('acks each frame, forwards a robot callback, and reports the connection ready', async () => {
    const { value, sockets, events } = host()
    const stream = new DingTalkStream(value)
    await stream.start()
    expect(sockets[0]!.url).toBe('wss://stream.example/connect?ticket=t-1')
    sockets[0]!.emit('open')
    expect(value.report).toHaveBeenLastCalledWith('ready', expect.stringContaining('Listening'))
    sockets[0]!.emit('message', { data: JSON.stringify({ type: 'CALLBACK', headers: { topic: BOT_TOPIC, messageId: 'm-1' },
      data: { text: { content: 'hi' } } }) })
    expect(JSON.parse(sockets[0]!.sent[0]!)).toMatchObject({ code: 200, headers: { messageId: 'm-1' } })
    expect(events).toEqual([{ topic: BOT_TOPIC, data: { text: { content: 'hi' } }, messageId: 'm-1' }])
    stream.stop()
  })

  it('reconnects after a close until stopped', async () => {
    vi.useFakeTimers()
    const { value, sockets } = host()
    const stream = new DingTalkStream(value)
    await stream.start()
    sockets[0]!.emit('close', { code: 1006 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(value.open).toHaveBeenCalledTimes(2)
    stream.stop()
    sockets[1]!.emit('close', { code: 1006 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(value.open).toHaveBeenCalledTimes(2)
  })

  it('reports an error and retries when the gateway cannot be opened', async () => {
    vi.useFakeTimers()
    const { value } = host({ open: vi.fn(async () => { throw new Error('gateway down') }) })
    const stream = new DingTalkStream(value)
    await stream.start()
    expect(value.report).toHaveBeenCalledWith('error', 'Error: gateway down')
    await vi.advanceTimersByTimeAsync(1000)
    expect(value.open).toHaveBeenCalledTimes(2)
    stream.stop()
  })
})

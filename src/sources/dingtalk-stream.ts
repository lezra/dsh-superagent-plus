/**
 * The DingTalk Stream connection: the gateway speaks JSON frames over a WebSocket, every event must be acknowledged with
 * its `messageId`, and a dropped socket is reopened with the backoff its caller chooses.
 */
export interface StreamSocket {
  send(data: string): void
  close(): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: (event: { code?: number; reason?: string }) => void): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
}
/** One decoded gateway frame: `CALLBACK` carries a bot message, `EVENT` a subscribed event, `SYSTEM` ping and disconnect. */
export interface StreamFrame { type: string; topic?: string; messageId?: string; headers?: Record<string, unknown>; data?: unknown }
/** Turns a WebSocket payload into text; DingTalk sends text frames, but a binary frame is decoded as UTF-8. */
export function frameText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw)
  if (ArrayBuffer.isView(raw)) return new TextDecoder().decode(raw)
  if (raw && typeof raw === 'object' && 'toString' in raw) {
    const text = String(raw)
    return text === '[object Object]' ? undefined : text
  }
  return undefined
}
/** Decodes one frame; frames that are not JSON or lack a type are ignored, since the gateway may send other traffic. */
export function parseFrame(raw: unknown): StreamFrame | undefined {
  const text = frameText(raw)
  if (!text) return undefined
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  const frame = value && typeof value === 'object' ? value as Record<string, unknown> : undefined
  const type = typeof frame?.type === 'string' ? frame.type : undefined
  if (!frame || !type) return undefined
  const headers = frame.headers && typeof frame.headers === 'object' ? frame.headers as Record<string, unknown> : {}
  let data: unknown = frame.data
  // DingTalk sends `data` as a JSON string; keep raw text when it is not JSON.
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { /* Keep the text. */ }
  }
  return { type, headers, ...typeof headers.topic === 'string' ? { topic: headers.topic } : {},
    ...typeof headers.messageId === 'string' ? { messageId: headers.messageId } : {}, ...data === undefined ? {} : { data } }
}
/**
 * The acknowledgement a frame requires: a system frame (ping, disconnect) echoes its headers and data, while the gateway
 * expects a status for an event and a callback response for a bot message.
 */
export function ackOf(frame: StreamFrame): string {
  if (frame.type === 'SYSTEM') return JSON.stringify({ code: 200, headers: frame.headers ?? {}, message: 'OK', data: frame.data ?? null })
  const headers = { contentType: 'application/json', ...frame.messageId ? { messageId: frame.messageId } : {} }
  const data = frame.type === 'EVENT' ? { status: 'SUCCESS' } : { response: {} }
  return JSON.stringify({ code: 200, headers, message: 'OK', data: JSON.stringify(data) })
}
export interface StreamHost {
  /** Opens a fresh Stream connection and returns its `wss://…?ticket=…` URL. */
  open(): Promise<string>
  socket(url: string): StreamSocket
  /** Called for one acknowledged bot message; `topic` is the bot topic the gateway subscribed to. */
  event(topic: string, data: unknown, messageId: string | undefined): void
  /** Connection state for the Source's health entry. */
  report(state: 'connecting' | 'ready' | 'error', detail: string): void
  /** Backoff before the `attempt`th reconnect, in milliseconds. */
  retry(attempt: number): number
  now(): number
}

/** Keeps one Stream connection alive: opens it, acknowledges frames, and reconnects with the host's backoff until stopped. */
export class DingTalkStream {
  private socket?: StreamSocket
  private timer?: ReturnType<typeof setTimeout>
  private attempt = 0
  private stopped = false
  constructor(private readonly host: StreamHost) {}
  /** Opens the first connection; later failures reconnect in the background, so a single failure does not throw at startup. */
  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }
  /** Closes the socket and cancels a pending reconnect. */
  stop(): void {
    this.stopped = true
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    this.socket?.close()
    this.socket = undefined
  }
  private async connect(): Promise<void> {
    if (this.stopped) return
    this.host.report('connecting', 'Opening the DingTalk Stream connection')
    try {
      const url = await this.host.open()
      if (this.stopped) return
      this.socket = this.host.socket(url)
      this.attach(this.socket)
    } catch (error) {
      this.failed(error)
    }
  }
  private attach(socket: StreamSocket): void {
    socket.addEventListener('open', () => { this.attempt = 0; this.host.report('ready', 'Listening for DingTalk bot messages') })
    socket.addEventListener('message', event => { this.receive(socket, event) })
    socket.addEventListener('error', error => { this.failed(error) })
    socket.addEventListener('close', event => { if (!this.stopped) this.failed(new Error(`Stream closed${event.reason ? `: ${event.reason}` : ''}`)) })
  }
  private receive(socket: StreamSocket, event: { data: unknown }): void {
    const frame = parseFrame(event.data)
    if (!frame) return
    try { socket.send(ackOf(frame)) } catch { /* The socket may already be closing; the reconnect covers it. */ }
    if (frame.type === 'SYSTEM') {
      if (frame.topic === 'disconnect') { socket.close(); return }
      return
    }
    // A robot's message arrives as a CALLBACK frame for its topic; EVENT frames carry subscribed events.
    if (frame.type !== 'CALLBACK' && frame.type !== 'EVENT') return
    try { this.host.event(frame.topic ?? '', frame.data, frame.messageId) }
    catch (error) { this.host.report('error', `Could not handle a DingTalk message: ${String(error)}`) }
  }
  private failed(error: unknown): void {
    if (this.stopped) return
    this.host.report('error', String(error))
    const attempt = this.attempt++
    this.timer = setTimeout(() => { void this.connect() }, this.host.retry(attempt))
  }
}

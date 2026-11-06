/**
 * DingTalk OpenAPI for one self-built robot app: the Stream gateway a Sources' event loop connects to, robot messages, and
 * the temporary webhook a bot message carries for replying in the conversation it came from.
 */
const BASE = 'https://api.dingtalk.com'
/** Refresh an access token this long before DingTalk's own expiry, so a long poll never sends an expired one. */
const TOKEN_MARGIN_MS = 60_000
export interface DingTalkCredentials { appKey: string; appSecret: string }
/** The bot's subscription topics; a Stream connection is opened for `chatbot` messages only. */
export const BOT_TOPIC = '/v1.0/im/bot/messages/get'
/** The part of the OpenAPI response this adapter uses; DingTalk answers under `data` for some endpoints and at the root for others. */
type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' ? value as Json : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
/** One OpenAPI failure, with DingTalk's own code and message when it sent them. */
export class DingTalkError extends Error {
  readonly detail: string
  constructor(path: string, status: number, details: Json) {
    const code = text(details.code) || text(object(details.error).code) || String(status)
    const message = text(details.message) || text(object(details.error).message) || `DingTalk answered HTTP ${status}`
    super(`${message} (${code}, ${path})`)
    this.name = 'DingTalkError'
    this.detail = `${code} ${path}`
  }
}

/** Token cache, Stream gateway handshake, and the three ways a robot sends: group, direct, and its message webhook. */
export class DingTalkApi {
  private cached?: { value: string; expiresAt: number }
  constructor(private readonly credentials: DingTalkCredentials, private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now()) {}
  /** A bearer token, reused until shortly before it expires. */
  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.value
    const answer = await this.request('/v1.0/oauth2/accessToken', { appKey: this.credentials.appKey,
      appSecret: this.credentials.appSecret }, 'none')
    const value = text(answer.accessToken)
    if (!value) throw new DingTalkError('/v1.0/oauth2/accessToken', 200, answer)
    const expireIn = typeof answer.expireIn === 'number' ? answer.expireIn : 7200
    this.cached = { value, expiresAt: this.now() + Math.max(0, expireIn * 1000 - TOKEN_MARGIN_MS) }
    return value
  }
  /** Opens a Stream connection and returns the `wss://` endpoint to connect to with `ticket` as its query parameter. */
  async openStream(): Promise<{ endpoint: string; ticket: string }> {
    const answer = await this.request('/v1.0/gateway/connections/open', { clientId: this.credentials.appKey,
      clientSecret: this.credentials.appSecret, subscriptions: [{ type: 'CALLBACK', topic: BOT_TOPIC }],
      ua: 'dsh-superagent-plus' }, 'none')
    const endpoint = text(answer.endpoint), ticket = text(answer.ticket)
    if (!endpoint || !ticket) throw new DingTalkError('/v1.0/gateway/connections/open', 200, answer)
    return { endpoint, ticket }
  }
  /** Sends a markdown robot message to a group conversation. */
  async sendGroup(robotCode: string, openConversationId: string, title: string, markdown: string): Promise<void> {
    await this.request('/v1.0/robot/groupMessages/send', { robotCode, openConversationId, msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ title, text: markdown }) })
  }
  /** Sends a markdown robot message to people by DingTalk user id. */
  async sendDirect(robotCode: string, userIds: string[], title: string, markdown: string): Promise<void> {
    await this.request('/v1.0/robot/oToMessages/batchSend', { robotCode, userIds, msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ title, text: markdown }) })
  }
  /** Answers a bot message through the temporary webhook it carried, which needs no token but expires within hours. */
  async replyWebhook(url: string, title: string, markdown: string): Promise<void> {
    const answer = await this.fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text: markdown } }) })
    if (answer.ok) return
    let details: Json = {}
    try { details = object(await answer.json()) } catch { /* Non-JSON webhook diagnostics are reported below. */ }
    throw new DingTalkError('webhook', answer.status, details)
  }
  private async request(path: string, body: Json, auth: 'none' | 'token' = 'token'): Promise<Json> {
    const token = auth === 'token' ? await this.accessToken() : undefined
    const answer = await this.fetchImpl(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json',
      ...token ? { 'x-acs-dingtalk-access-token': token } : {} }, body: JSON.stringify(body) })
    let payload: unknown = {}
    try { payload = await answer.json() } catch { /* An empty body is normal for some endpoints. */ }
    if (!answer.ok) throw new DingTalkError(path, answer.status, object(payload))
    return object(payload)
  }
}

/**
 * The panel's "connect DingTalk" flow: DingTalk's app-registration device flow. `init` opens a registration, `begin` turns
 * it into a scan URL and a device code, and `poll` replies with the new app's client id and secret once someone scans.
 * The panel draws the scan URL itself, so nothing here renders an image and no dependency is added.
 */
const BASE = 'https://oapi.dingtalk.com/app/registration'
/** The code stays valid for two hours; stop polling before that so the panel offers a fresh code. */
const EXPIRES_MS = 2 * 60 * 60_000
/** DingTalk asks for one poll every two seconds; a little slower avoids burning the flow's rate limit. */
const MIN_POLL_MS = 2500

export type DingTalkSetupState = 'idle' | 'pending' | 'ready' | 'failed'
export interface DingTalkSetupStatus {
  state: DingTalkSetupState
  /** The page to open, or to draw as a QR code: DingTalk's own registration page for this attempt. */
  url?: string
  /** The AppKey the new app was created with; present once `state` is `ready`. */
  appKey?: string
  /** The AppSecret; the panel saves it into the Source's configuration. */
  appSecret?: string
  expiresAt?: string
  /** Whether the new credentials passed a live token check; absent when no check was configured. */
  verified?: boolean
  /** Why the check failed, when it did. */
  verifyError?: string
  message?: string
}
export interface DingTalkSetupHost {
  /** Injected so tests never touch the network. */
  fetch?: typeof fetch
  now?: () => number
  /** Which product opened the registration; DingTalk shows it on the scan page. */
  source?: string
  /** Checks the new credentials against DingTalk; the deployment passes a token request. */
  verify?: (appKey: string, appSecret: string) => Promise<void>
}
interface Json { [key: string]: unknown }
const object = (value: unknown): Json => value && typeof value === 'object' ? value as Json : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''

/** DingTalk itself refused the request, with the message it printed. */
class DingTalkRefused extends Error {}
/** One scan-to-create-app attempt; `status()` polls DingTalk while the attempt is pending. */
export class DingTalkSetup {
  private current: DingTalkSetupStatus = { state: 'idle' }
  private cookie = ''
  private deviceCode = ''
  private expires = 0
  private lastPoll = 0
  private busy = false
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly source: string
  private readonly verify?: (appKey: string, appSecret: string) => Promise<void>
  /** The app the last successful scan created, so the panel can re-check it after publishing. */
  private checkable?: { appKey: string; appSecret: string }
  constructor(host: DingTalkSetupHost = {}) {
    this.fetchImpl = host.fetch ?? globalThis.fetch
    this.now = host.now ?? Date.now
    this.source = host.source ?? 'DSH-Superagent'
    this.verify = host.verify
  }
  status(): DingTalkSetupStatus { return this.current }
  /** Starts a registration and returns the page whose QR code the operator scans. */
  async begin(): Promise<DingTalkSetupStatus> {
    if (this.current.state === 'pending') return this.current
    this.reset()
    this.current = { state: 'pending' }
    try {
      const initial = await this.post('/init', { source: this.source })
      const nonce = text(initial.nonce)
      if (!nonce) return this.fail('DingTalk did not return a registration nonce')
      const begun = await this.post('/begin', { nonce })
      const url = text(begun.verification_uri_complete) || text(begun.verification_uri)
      const deviceCode = text(begun.device_code)
      if (!url || !deviceCode) return this.fail('DingTalk did not return a scan URL')
      const expiresIn = typeof begun.expires_in === 'number' ? begun.expires_in : 7200
      this.deviceCode = deviceCode
      this.expires = this.now() + Math.min(expiresIn * 1000, EXPIRES_MS)
      this.current = { state: 'pending', url, expiresAt: new Date(this.expires).toISOString() }
      return this.current
    } catch (error) {
      return this.fail(error instanceof DingTalkRefused ? error.message : `DingTalk registration failed: ${String(error)}`)
    }
  }
  /** Asks DingTalk whether the scan happened; call it while `state` is `pending`. */
  async poll(): Promise<DingTalkSetupStatus> {
    if (this.current.state !== 'pending' || !this.deviceCode || this.busy) return this.current
    if (this.now() >= this.expires) return this.fail('The DingTalk QR code expired')
    if (this.now() - this.lastPoll < MIN_POLL_MS) return this.current
    this.busy = true
    this.lastPoll = this.now()
    try {
      const answer = await this.post('/poll', { device_code: this.deviceCode })
      const appKey = text(answer.client_id)
      const appSecret = text(answer.client_secret)
      if (appKey && appSecret) {
        this.reset()
        this.checkable = { appKey, appSecret }
        let verified: boolean | undefined
        let verifyError: string | undefined
        if (this.verify) {
          try { await this.verify(appKey, appSecret); verified = true }
          catch (failure) { verified = false; verifyError = failure instanceof Error ? failure.message : String(failure) }
        }
        this.current = { state: 'ready', appKey, appSecret, ...verified !== undefined ? { verified } : {},
          ...verifyError ? { verifyError } : {} }
        return this.current
      }
      const status = text(answer.status).toUpperCase()
      if (status === 'EXPIRED') return this.fail('The DingTalk QR code expired')
      if (status === 'FAIL' || status === 'FAILED') return this.fail(text(answer.fail_reason) || 'DingTalk refused the authorization')
      return this.current
    } catch (error) {
      return this.fail(error instanceof DingTalkRefused ? error.message : `DingTalk registration failed: ${String(error)}`)
    } finally {
      this.busy = false
    }
  }
  /** Re-checks the most recently created app, for when its version or robot were configured after the scan. */
  async check(): Promise<DingTalkSetupStatus> {
    if (this.current.state !== 'ready' || !this.checkable || !this.verify) return this.current
    try {
      await this.verify(this.checkable.appKey, this.checkable.appSecret)
      this.current = { ...this.current, verified: true, verifyError: undefined }
    } catch (failure) {
      this.current = { ...this.current, verified: false,
        verifyError: failure instanceof Error ? failure.message : String(failure) }
    }
    return this.current
  }
  /** Stops an attempt; the next `begin()` starts a fresh registration. */
  cancel(): DingTalkSetupStatus {
    this.reset()
    this.current = { state: 'idle' }
    return this.current
  }
  private reset(): void { this.cookie = ''; this.deviceCode = ''; this.expires = 0; this.lastPoll = 0 }
  private fail(message: string): DingTalkSetupStatus {
    this.reset()
    this.current = { state: 'failed', message }
    return this.current
  }
  /** POSTs JSON as DingTalk's registration API expects, carrying the cookies `init` set into `begin`. */
  private async post(path: string, body: Json): Promise<Json> {
    const answer = await this.fetchImpl(`${BASE}${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...this.cookie ? { cookie: this.cookie } : {} }, body: JSON.stringify(body) })
    const payload = object(await answer.json().catch(() => ({})))
    if (answer.ok && path === '/init') this.rememberCookies(answer)
    if (typeof payload.errcode === 'number' && payload.errcode !== 0) {
      throw new DingTalkRefused(text(payload.errmsg) || `DingTalk returned ${payload.errcode}`)
    }
    if (!answer.ok) throw new DingTalkRefused(`DingTalk answered ${answer.status}`)
    return payload
  }
  private rememberCookies(answer: Response): void {
    const cookies = typeof answer.headers.getSetCookie === 'function' ? answer.headers.getSetCookie()
      : (answer.headers.get('set-cookie') ?? '').split(',').filter(Boolean)
    this.cookie = cookies.map(cookie => cookie.split(';')[0]?.trim() ?? '').filter(Boolean).join('; ')
  }
}

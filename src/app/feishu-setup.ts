/**
 * The panel's "connect Feishu" flow: installs lark-cli when the deployment has none, runs `lark-cli config init --new` with
 * the deployment's bot configuration directory, reads the verification URL it prints, and renders that URL as a QR image
 * with `lark-cli auth qrcode`, so an operator scans once instead of typing an app id and secret. The deployment runs that
 * CLI as the bot, so a finished sign-in is ready only once its identity policy is `bot`; switching it asks the operator
 * first, because lark-cli treats that switch as a security decision.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { defaultLarkConfigDir } from '../deployment.ts'
import { commandOf } from '../infra/platform.ts'
import { larkCliAvailable } from './lark-cli.ts'

const run = promisify(execFile)
/** How long one sign-in may stay open before the child is stopped and the attempt reported failed. */
const TIMEOUT_MS = 10 * 60_000

export type FeishuSetupState = 'idle' | 'installing' | 'pending' | 'identity' | 'restricting' | 'ready' | 'failed'
export interface FeishuSetupStatus {
  state: FeishuSetupState
  /** The lark-cli entry the sign-in starts, once one is chosen; the panel saves it into the Feishu Source. */
  cli?: string
  /** The configuration directory the sign-in writes; the panel saves it into the Feishu Source too. */
  configDir?: string
  /** The verification URL lark-cli printed; the panel shows it as text under the QR image. */
  url?: string
  /** The verification URL as a PNG data URL, once `lark-cli auth qrcode` rendered it. */
  qr?: string
  message?: string
}
export interface FeishuSetupHost {
  readonly stateDir: string
  /** The bot lark-cli the Feishu Source names, or `lark-cli` from PATH while none is configured yet. */
  larkCli(): string
  /** The bot configuration directory to create; the deployment's when setup resolved it, else the default. */
  configDir(): string
  /** Installs the CLI that cannot start, returning the entry to start instead. */
  installCli(named: string): Promise<string>
}
/** The verification URL among lark-cli output lines, ignoring trailing punctuation and quotes. */
export function verificationUrl(output: string): string | undefined {
  const match = /https?:\/\/[^\s"'<>]+/.exec(output)
  return match?.[0].replace(/[).,;]+$/, '')
}

/** One interactive lark-cli app sign-in, with its verification URL rendered as a QR image for the panel; at most one at a time. */
export class FeishuSetup {
  private child?: ChildProcessWithoutNullStreams
  private current: FeishuSetupStatus = { state: 'idle' }
  private timer?: NodeJS.Timeout
  /** Names the attempt in flight, so a cancel during an install leaves its result unapplied. */
  private attempt = 0
  constructor(private readonly host: FeishuSetupHost) {}
  status(): FeishuSetupStatus { return this.current }
  /** Start one sign-in, installing lark-cli first when none can start; an attempt in flight is returned unchanged. */
  begin(): FeishuSetupStatus {
    if (this.current.state === 'pending' || this.current.state === 'installing' || this.current.state === 'restricting') return this.current
    this.clear()
    const attempt = ++this.attempt
    const directory = this.host.configDir()
    const named = this.host.larkCli()
    if (larkCliAvailable(this.host.stateDir, named)) this.start(named, directory, attempt)
    else {
      // An install may download lark-cli's platform binary for minutes, so it answers at once and reports through status().
      this.current = { state: 'installing' }
      void this.install(named, directory, attempt)
    }
    return this.current
  }
  /** Install the CLI an attempt needs and start the sign-in with it, unless the attempt was cancelled meanwhile. */
  private async install(named: string, directory: string, attempt: number): Promise<void> {
    let cli: string
    try { cli = await this.host.installCli(named) }
    catch (error) {
      if (attempt === this.attempt) this.current = { state: 'failed', message: `Could not install lark-cli: ${error instanceof Error ? error.message : String(error)}` }
      return
    }
    if (attempt === this.attempt) this.start(cli, directory, attempt)
  }
  /** Run one interactive sign-in; its escalation or completion only applies while this attempt is still the current one. */
  private start(cli: string, directory: string, attempt: number): void {
    this.current = { state: 'pending', cli, configDir: directory }
    const [program = cli, ...args] = commandOf(cli,
      ['config', 'init', '--new', '--force-init', '--brand', 'feishu'])
    let output = ''
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(program, args, { cwd: this.host.stateDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, LARKSUITE_CLI_CONFIG_DIR: directory, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
          LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } })
    } catch (error) {
      this.current = { state: 'failed', message: `Could not start lark-cli: ${String(error)}` }
      return
    }
    this.child = child
    const read = (chunk: Buffer): void => {
      output += chunk.toString()
      const url = verificationUrl(output)
      if (url && attempt === this.attempt && this.current.state === 'pending' && !this.current.url) void this.render(cli, directory, url)
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', error => { if (attempt === this.attempt && this.current.state === 'pending') this.fail(`lark-cli failed: ${String(error)}`) })
    child.on('exit', code => {
      if (attempt !== this.attempt || this.current.state !== 'pending') return
      this.clearTimer()
      if (code === 0) void this.settle(cli, directory, attempt)
      else this.fail(output.trim().split('\n').slice(-3).join(' / ') || `lark-cli exited with code ${code ?? 'unknown'}`)
    })
    this.timer = setTimeout(() => { if (attempt === this.attempt) this.fail('The Feishu sign-in did not finish in time') }, TIMEOUT_MS)
  }
  /**
   * Report a finished sign-in ready for a bot-only CLI; a CLI that still allows a user identity asks the operator to
   * restrict it first, since the deployment runs it for workers as the bot.
   */
  private async settle(cli: string, directory: string, attempt: number): Promise<void> {
    let mode: string | undefined
    try { mode = await this.identity(cli, directory) } catch { /* An unreadable policy is treated as one that is not bot. */ }
    if (attempt !== this.attempt || this.current.state !== 'pending') return
    this.current = mode === 'bot' ? { state: 'ready', cli, configDir: directory } : { state: 'identity', cli, configDir: directory }
  }
  /** Restrict the signed-in CLI to the bot identity; the panel asks the operator before this security switch. */
  restrict(): FeishuSetupStatus {
    if (this.current.state !== 'identity' || !this.current.cli || !this.current.configDir) return this.current
    const { cli, configDir } = this.current
    const attempt = this.attempt
    this.current = { state: 'restricting', cli, configDir }
    void this.enforce(cli, configDir, attempt)
    return this.current
  }
  /** Apply the restriction and report the outcome, unless the attempt was cancelled meanwhile. */
  private async enforce(cli: string, directory: string, attempt: number): Promise<void> {
    const message = await this.botOnly(cli, directory)
    if (attempt !== this.attempt || this.current.state !== 'restricting') return
    this.current = message === undefined ? { state: 'ready', cli, configDir: directory } : { state: 'failed', cli, configDir: directory, message }
  }
  /**
   * Set the identity policy to bot and read it back. The global level covers every profile of the configuration; the
   * profile level is set as well because an explicit profile value overrides the global one.
   */
  private async botOnly(cli: string, directory: string): Promise<string | undefined> {
    let message = ''
    for (const args of [['config', 'strict-mode', 'bot', '--global'], ['config', 'strict-mode', 'bot']]) {
      const [program = cli, ...rest] = commandOf(cli, args)
      try { await run(program, rest, { cwd: this.host.stateDir, timeout: 60_000, windowsHide: true, env: this.environment(directory) }) }
      catch (error) { message = error instanceof Error ? error.message : String(error); continue }
      try { if (await this.identity(cli, directory) === 'bot') return undefined }
      catch (error) { message = error instanceof Error ? error.message : String(error) }
    }
    return message || 'lark-cli did not report strict mode bot'
  }
  /** The identity policy lark-cli reports for `directory`, or undefined when it reports none. */
  private async identity(cli: string, directory: string): Promise<string | undefined> {
    const [program = cli, ...args] = commandOf(cli, ['config', 'strict-mode'])
    const { stdout } = await run(program, args, { cwd: this.host.stateDir, timeout: 30_000, windowsHide: true,
      encoding: 'utf8', env: this.environment(directory) })
    return /strict-mode:\s*(\w+)/.exec(stdout)?.[1]
  }
  /** The environment every lark-cli call of this flow runs with: the bot configuration directory and no update notices. */
  private environment(directory: string): NodeJS.ProcessEnv {
    return { ...process.env, LARKSUITE_CLI_CONFIG_DIR: directory, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' }
  }
  /** Stop a sign-in, an install or a restriction; the attempt is reported idle so the panel can offer a fresh QR code. */
  cancel(): FeishuSetupStatus {
    this.attempt++
    this.clear()
    this.current = { state: 'idle' }
    return this.current
  }
  /** Render the verification URL into the panel-sized QR image; a failure keeps the URL so the operator can still open it. */
  private async render(cli: string, directory: string, url: string): Promise<void> {
    const file = join(this.host.stateDir, 'feishu-setup-qr.png')
    try {
      const [program = cli, ...args] = commandOf(cli,
        ['auth', 'qrcode', url, '--output', file, '--size', '320'])
      await run(program, args, { cwd: this.host.stateDir, timeout: 30_000,
        env: { ...process.env, LARKSUITE_CLI_CONFIG_DIR: directory, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
          LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } })
      const qr = `data:image/png;base64,${readFileSync(file).toString('base64')}`
      if (this.current.state === 'pending') this.current = { ...this.current, url, qr }
      rmSync(file, { force: true })
    } catch {
      if (this.current.state === 'pending') this.current = { ...this.current, url }
    }
  }
  private fail(message: string): void {
    this.clear()
    this.current = { state: 'failed', ...this.current.url ? { url: this.current.url } : {}, ...this.current.qr ? { qr: this.current.qr } : {}, message }
  }
  private clearTimer(): void { if (this.timer) { clearTimeout(this.timer); this.timer = undefined } }
  private clear(): void {
    this.clearTimer()
    const child = this.child
    this.child = undefined
    if (child && child.exitCode === null) child.kill('SIGTERM')
  }
}

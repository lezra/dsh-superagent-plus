/**
 * The panel's "connect Feishu" flow: runs `lark-cli config init --new` with the deployment's bot configuration directory,
 * reads the verification URL it prints, and renders that URL as a QR image with `lark-cli auth qrcode`, so an operator scans
 * once instead of typing an app id and secret.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { defaultLarkConfigDir } from '../deployment.ts'
import { commandOf } from '../infra/platform.ts'

const run = promisify(execFile)
/** How long one sign-in may stay open before the child is stopped and the attempt reported failed. */
const TIMEOUT_MS = 10 * 60_000

export type FeishuSetupState = 'idle' | 'pending' | 'ready' | 'failed'
export interface FeishuSetupStatus {
  state: FeishuSetupState
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
  constructor(private readonly host: FeishuSetupHost) {}
  status(): FeishuSetupStatus { return this.current }
  /** Start one sign-in; while one is pending this returns it unchanged, so a double click cannot open two apps. */
  async begin(): Promise<FeishuSetupStatus> {
    if (this.current.state === 'pending') return this.current
    this.clear()
    this.current = { state: 'pending' }
    const directory = this.host.configDir()
    const [program = this.host.larkCli(), ...args] = commandOf(this.host.larkCli(),
      ['config', 'init', '--new', '--force-init', '--brand', 'feishu'])
    let output = ''
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(program, args, { cwd: this.host.stateDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, LARKSUITE_CLI_CONFIG_DIR: directory, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
          LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' } })
    } catch (error) {
      this.current = { state: 'failed', message: `Could not start lark-cli: ${String(error)}` }
      return this.current
    }
    this.child = child
    const read = (chunk: Buffer): void => {
      output += chunk.toString()
      const url = verificationUrl(output)
      if (url && this.current.state === 'pending' && !this.current.url) void this.render(directory, url, output)
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', error => { if (this.current.state === 'pending') this.fail(`lark-cli failed: ${String(error)}`) })
    child.on('exit', code => {
      if (this.current.state !== 'pending') return
      this.clearTimer()
      if (code === 0) this.current = { ...this.current, state: 'ready', message: undefined }
      else this.fail(output.trim().split('\n').slice(-3).join(' / ') || `lark-cli exited with code ${code ?? 'unknown'}`)
    })
    this.timer = setTimeout(() => this.fail('The Feishu sign-in did not finish in time'), TIMEOUT_MS)
    return this.current
  }
  /** Stop a pending sign-in; the attempt is reported idle so the panel can offer a fresh QR code. */
  cancel(): FeishuSetupStatus {
    this.clear()
    this.current = { state: 'idle' }
    return this.current
  }
  /** Render the verification URL into the panel-sized QR image; a failure keeps the URL so the operator can still open it. */
  private async render(directory: string, url: string, output: string): Promise<void> {
    const file = join(this.host.stateDir, 'feishu-setup-qr.png')
    try {
      const [program = this.host.larkCli(), ...args] = commandOf(this.host.larkCli(),
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

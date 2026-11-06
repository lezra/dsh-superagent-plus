/** Plugin configuration and startup verification for repository access and agent CLI identities. */
import { LIMITS } from './limits.ts'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { Volatile } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { runAsWorker, sameDirectory, withoutDirectory, workerBin } from './infra/environment.ts'
import { WINDOWS, commandOf, isWindowsScript, windowsCandidates } from './infra/platform.ts'
import { SetupError } from './setup.ts'

const reason = (error: unknown): string => error instanceof Error ? error.message : String(error)
/** An absolute path on POSIX (`/…`) or on Windows (`C:\…`, `C:/…`, `\\server\…`). */
const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/
const absolute = (description: string) => s.string().pattern(ABSOLUTE).description(`${description} Absolute path.`)
/** Plugin configuration of the dsh-superagent entry. Volatile fields apply without a restart because dsh-superagent reads them on each use; changing `stateDir` remounts the plugin. */
export const Config = s.object({
  /** Defaults under $DSH_HOME so a Desktop install from the Plugin Manager needs no profile patch; a profile may override it. */
  stateDir: absolute('Directory for the database, locks, worker shims, the agent\'s git configuration and, by default, the ticket directories.')
    .description('Defaults to $DSH_HOME/state/dsh-superagent. Absolute path.').default(defaultStateDir()),
  promptMaxChars: s.number().min(LIMITS.promptMaxChars.min).max(LIMITS.promptMaxChars.max).step(1).default(100000)
    .description('Largest saved prompt configuration, in characters.').volatile(),
  admissionContextMaxPages: s.number().min(LIMITS.admissionContextMaxPages.min).max(LIMITS.admissionContextMaxPages.max).step(1).default(10)
    .description('Pages of thread context one assessment may read.').volatile(),
  /** Profile whose cordis.patch.yml receives the managed MCP block; unset disables automatic MCP startup. */
  dshProfileDir: s.string().pattern(/^$|^(?:\/|[A-Za-z]:[\\/]|\\\\)/)
    .description('Absolute DSH profile directory whose cordis.patch.yml receives the managed MCP servers; empty records only.')
    .default(''),
  admissionContextTimeoutMs: s.number().min(LIMITS.admissionContextTimeoutMs.min).max(LIMITS.admissionContextTimeoutMs.max).step(1)
    .default(15000).description('Time limit of one context read during an assessment, in milliseconds.').volatile(),
})
export type DeploymentConfig = ReturnType<typeof Config>
export interface Machine {
  stateDir: string
  dshProfileDir?: string | undefined
  promptMaxChars: Volatile<number>
  admissionContextMaxPages: Volatile<number>
  admissionContextTimeoutMs: Volatile<number>
}
const MOVED: Record<string, string> = {
  repository: 'on the GitHub Source', branchPrefix: 'in the prepare command of the Execution settings', github: 'on the GitHub Source',
  feishu: 'on the Feishu Source', author: 'prompt text', repositoryPath: 'in the prepare command of the Execution settings',
  worktreeRoot: 'the ticket directory of the Execution settings', blockedCommands: 'in the Execution settings',
}

/** Read machine settings and reject unknown configuration keys (naming where deprecated keys moved). */
export function machineOf(config: DeploymentConfig): Machine {
  const unknown = Object.keys(config).filter(key => !(key in (Config.dict ?? {})))
  if (unknown.length) throw new Error(`dsh-superagent configuration has keys it does not use: ${unknown.map(key => MOVED[key] ? `${key} (now ${MOVED[key]})` : key).join(', ')}; docs/006-deployment.md lists the keys`)
  const { stateDir, dshProfileDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs } = config
  return { stateDir, ...dshProfileDir ? { dshProfileDir } : {}, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs }
}
/** The state directory a deployment uses when its configuration names none: under the DSH home so an install needs no patch. */
export function defaultStateDir(environment: NodeJS.ProcessEnv = process.env): string {
  const home = environment.DSH_HOME ?? join(environment.USERPROFILE ?? environment.HOME ?? '.', '.dsh')
  return join(home, 'state', 'dsh-superagent')
}

export const GithubAccountsSchema = z.object({
  repository: z.string().trim().regex(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?$/, 'owner/name').default(''),
  cli: z.string().trim().default(''),
})
export const FeishuBotSchema = z.object({ cli: z.string().trim().default(''),
  /** Directory of the bot-only lark-cli configuration; empty means `~/.lark-cli-dsh-superagent`. */
  configDir: z.string().trim().default('') })
/** Source configuration keys that affect deployment setup and trigger a restart when changed. */
export const SETUP_FIELDS: Readonly<Record<string, readonly string[]>> = { github: Object.keys(GithubAccountsSchema.shape), feishu: Object.keys(FeishuBotSchema.shape),
  // DingTalk has no CLI: its credentials ride in the Source's configuration, and changing them must reconnect the Stream.
  dingtalk: ['appKey', 'appSecret', 'robotCode'] }

/** The GitHub Source's resolved facts; absent when this deployment configures no GitHub Source. */
export interface GithubDeployment { repository: string; github: { cli: string; login: string; noreply: string } }
/** At least one Source is configured: a deployment may run with GitHub, with Feishu, or with both. */
export interface Deployment extends Machine, Partial<GithubDeployment> {
  feishu?: FeishuBot
}
export interface FeishuBot { cli: string; configDir: string; appId: string; brand: 'feishu' | 'lark'; botId: string; name: string }
/** The lark-cli configuration directory a deployment uses when its Feishu Source names none. */
export function defaultLarkConfigDir(environment: NodeJS.ProcessEnv = process.env): string {
  return join(environment.USERPROFILE ?? environment.HOME ?? '.', '.lark-cli-dsh-superagent')
}

/**
 * The lark-cli a deployment can sign in with before its bot is configured: the npm global install when it exists, since a
 * Windows `.cmd` shim cannot be started directly, and otherwise the command name for a PATH install on other systems.
 */
export function defaultLarkCli(environment: NodeJS.ProcessEnv = process.env): string {
  const profiles = [environment.APPDATA, environment.LOCALAPPDATA].filter((value): value is string => !!value)
  const candidates = [...profiles.flatMap(root => [join(root, 'npm/node_modules/@larksuite/cli/scripts/run.js'),
    join(root, 'pnpm/global/5/node_modules/@larksuite/cli/scripts/run.js')]),
    join(environment.USERPROFILE ?? environment.HOME ?? '.', 'AppData/Roaming/npm/node_modules/@larksuite/cli/scripts/run.js')]
  return candidates.find(candidate => existsSync(candidate)) ?? 'lark-cli'
}

/** Resolve a command name or absolute path to an executable file, ignoring the worker shim directory. */
export function executable(name: string, path: string, exclude?: string): string {
  if ((name.includes('/') || name.includes('\\')) && !isAbsolute(name)) throw new Error(`${name} must be a command name or an absolute path`)
  const candidates = isAbsolute(name) ? [name] : path.split(delimiter).filter(dir => isAbsolute(dir) && !(exclude && sameDirectory(dir, exclude)))
    .flatMap(dir => windowsCandidates(name).map(candidate => join(dir, candidate)))
  for (const candidate of candidates) {
    let file = false
    try { file = statSync(candidate).isFile() } catch { /* Not an executable file here; try the next candidate. */ }
    if (!file) continue
    // Node cannot start a Windows command script directly, and cmd.exe would re-parse the arguments.
    if (isWindowsScript(candidate)) throw new Error(`${name} is a Windows command script; name the Node entry it runs or the executable instead`)
    try { accessSync(candidate, constants.X_OK); return candidate }
    catch { /* Not executable; try the next candidate. */ }
  }
  throw new Error(`${name} is not an executable file${isAbsolute(name) ? '' : ' on PATH'}`)
}

export type Probe = (argv: string[], env?: Record<string, string>) => Promise<string>
/** Run startup checks through DSH's worker subprocess service with worker shims removed from PATH so a CLI wrapper script reaches the real binary. */
export function workerProbe(subprocess: SubprocessRuntime, stateDir: string, cwd: string, signal: AbortSignal): Probe {
  const path = withoutDirectory(process.env.PATH ?? '', workerBin(stateDir))
  const environment = (extra?: Record<string, string>): Record<string, string> => ({ PATH: path, ...extra })
  const deadline = (): AbortSignal => AbortSignal.any([signal, AbortSignal.timeout(60_000)])
  // POSIX prepends `env` with the shim-free PATH; Windows passes the same overrides to the spawn it already controls.
  return (argv, extra) => WINDOWS
    ? runAsWorker(subprocess, argv, cwd, deadline(), environment(extra))
    : runAsWorker(subprocess, ['env', ...Object.entries(environment(extra)).map(([key, value]) => `${key}=${value}`), ...argv], cwd, deadline())
}

const GithubUser = z.object({ login: z.string().regex(/^[A-Za-z0-9-]+$/), id: z.number().int().positive() })
const RepositoryAccess = z.object({ name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), push: z.boolean().nullable() })
function parsed<T>(schema: z.ZodType<T>, text: string): T | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined /* Non-JSON output; the caller surfaces the setup failure. */ }
  const result = schema.safeParse(value)
  return result.success ? result.data : undefined
}
/**
 * Verify the agent's GitHub CLI identity and push access to the configured repository.
 * Returns undefined when the GitHub Source names neither a repository nor a CLI, so a Feishu-only deployment needs no GitHub account.
 */
export async function resolveGithub(machine: Machine, github: unknown, probe: Probe, path = process.env.PATH ?? ''): Promise<GithubDeployment | undefined> {
  const { stateDir } = machine
  const accounts = GithubAccountsSchema.parse(github ?? {})
  const remote = accounts.repository
  if (!remote && !accounts.cli) return undefined
  if (!remote) throw new SetupError('repositoryUnset')
  if (!accounts.cli) throw new SetupError('agentCliUnset')
  let cli: string
  try { cli = executable(accounts.cli, path, workerBin(stateDir)) } catch (error) { throw new SetupError('agentCliMissing', { output: reason(error) }) }
  const text = await probe(commandOf(cli, ['api', 'user'])).catch((error: unknown) => { throw new SetupError('agentCliSignedOut', { output: reason(error) }) })
  const agent = parsed(GithubUser, text)
  if (!agent) throw new SetupError('agentCliNoAccount')
  // Use the canonical repository name returned by GitHub so renamed repositories match incoming notifications.
  const access = parsed(RepositoryAccess, await probe(commandOf(cli, ['api', `repos/${remote}`, '--jq', '{name: .full_name, push: .permissions.push}'])).catch((error: unknown) => {
    throw new SetupError('repositoryUnreadable', { account: agent.login, repository: remote, output: reason(error) })
  }))
  if (!access) throw new SetupError('repositoryUnreported', { repository: remote })
  const repository = access.name
  if (access.push !== true) throw new SetupError('repositoryReadOnly', { account: agent.login, repository })
  return { repository, github: { cli, login: agent.login, noreply: `${agent.id}+${agent.login}@users.noreply.github.com` } }
}

const AuthStatus = z.object({ appId: z.string().regex(/^cli_[A-Za-z0-9]+$/), brand: z.enum(['feishu', 'lark']).default('feishu'), identities: z.object({ bot: z.object({ status: z.string() }) }) })
const BotInfo = z.object({ bot: z.object({ open_id: z.string().regex(/^ou_[A-Za-z0-9]+$/), app_name: z.string().default('') }) })
/**
 * Verify that the configured Feishu CLI is authenticated as a bot and restricted to strict mode `bot`.
 * Workers invoke this CLI as `lark-cli`, so a CLI that also permits a user identity would let workers act as that user.
 */
export async function resolveFeishuBot(machine: Machine, feishu: unknown, probe: Probe, path = process.env.PATH ?? ''): Promise<FeishuBot | undefined> {
  const { cli: name, configDir } = FeishuBotSchema.parse(feishu ?? {})
  if (!name) return undefined
  // The bot's configuration directory travels with every lark-cli call, so a Desktop install needs no launcher environment.
  const directory = configDir && isAbsolute(configDir) ? configDir : defaultLarkConfigDir()
  const fail = (error: unknown): never => { throw error instanceof SetupError ? error : new SetupError('feishuCliFailed', { output: reason(error) }) }
  let cli = ''
  try { cli = executable(name, path, workerBin(machine.stateDir)) } catch (error) { fail(error) }
  const run = (...args: string[]): Promise<string> => probe(commandOf(cli, args),
    { LARKSUITE_CLI_CONFIG_DIR: directory, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' }).catch(fail)
  const text = await run('auth', 'status')
  const status = parsed(AuthStatus, text.slice(text.indexOf('{')))
  if (!status) return fail(new SetupError('feishuNoApp'))
  if (status.identities.bot.status !== 'ready') fail(new SetupError('feishuBotNotReady', { app: status.appId, status: status.identities.bot.status }))
  const mode = /strict-mode:\s*(\w+)/.exec(await run('config', 'strict-mode'))?.[1]
  if (mode !== 'bot') fail(new SetupError('feishuUserIdentity', { mode: mode ?? 'unknown' }))
  // `--format json` unwraps only `data`, whereas this endpoint returns the payload under `bot`.
  const info = parsed(BotInfo, (await run('api', 'GET', '/open-apis/bot/v3/info', '--as', 'bot', '--format', 'ndjson')).split('\n')[0] ?? '')
  if (!info) return fail(new SetupError('feishuNoBot'))
  return { cli, configDir: directory, appId: status.appId, brand: status.brand, botId: info.bot.open_id, name: info.bot.app_name }
}

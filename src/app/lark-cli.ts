/**
 * The lark-cli a deployment needs before a Feishu bot exists: the CLI the operator named or installed globally, or a copy
 * this deployment installs into its own tools directory with the npm beside this runtime. The copy stays out of the global
 * npm prefix, so a Desktop deployment needs no administrator rights, and it goes away with the state directory.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { executable, managedLarkCli, toolsDir } from '../deployment.ts'
import { npmProgram } from '../infra/platform.ts'

const exec = promisify(execFile)
/** A first install downloads lark-cli's platform binary, so it may take minutes. */
const INSTALL_TIMEOUT_MS = 10 * 60_000
const PACKAGE = '@larksuite/cli'
/** npm runs a package's install scripts only when the manifest allows them, and lark-cli downloads its binary in one. */
const MANIFEST = { private: true, allowScripts: { [PACKAGE]: true } }
/** Runs one npm install in `directory`; tests replace it to record the command without a network install. */
export type Installer = (directory: string) => Promise<void>

async function execNpm(directory: string): Promise<void> {
  const program = npmProgram()
  await exec(program.file, [...program.prefix, 'install', PACKAGE, '--no-fund', '--no-audit'], { cwd: directory,
    timeout: INSTALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, npm_config_update_notifier: 'false' } })
    .catch((error: unknown) => {
      throw new Error(`npm could not install ${PACKAGE}: ${error instanceof Error ? error.message : String(error)}`)
    })
}

/** True when `cli` starts as named: a file when it has a path, a command on PATH otherwise. */
export function usableCli(cli: string, path = process.env.PATH ?? ''): boolean {
  try { executable(cli, path); return true } catch { return false }
}

/**
 * Installs lark-cli into the deployment's tools directory and returns its Node entry.
 * @throws Error when npm fails or leaves no entry behind.
 */
export async function installLarkCli(stateDir: string, install: Installer = execNpm): Promise<string> {
  const directory = toolsDir(stateDir)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(MANIFEST, null, 2))
  await install(directory)
  const entry = managedLarkCli(stateDir)
  if (!entry) throw new Error(`npm finished without installing ${PACKAGE}`)
  return entry
}

/** True when the named CLI or the deployment's own copy can start, so no install is needed. */
export function larkCliAvailable(stateDir: string, named: string): boolean {
  if (usableCli(named)) return true
  const managed = managedLarkCli(stateDir)
  return managed !== undefined && usableCli(managed)
}

/** The CLI to use: the one named, the deployment's own copy, or a fresh install. */
export async function ensureLarkCli(stateDir: string, named: string, install?: Installer): Promise<string> {
  if (usableCli(named)) return named
  if (larkCliAvailable(stateDir, named)) return managedLarkCli(stateDir)!
  return installLarkCli(stateDir, install)
}

/** One-time moves from the directories the fork used before it was renamed to `dsh-superagent-plus`. */
import { existsSync, renameSync, symlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { defaultLarkConfigDir, defaultStateDir } from '../deployment.ts'

/**
 * Moves a legacy directory into place when the target is absent and no running deployment holds it.
 * Returns the target path when it moved, so startup can report it; a failed move keeps the old directory and starts fresh.
 */
function move(from: string, to: string): string | undefined {
  if (from === to || existsSync(to) || !existsSync(from) || existsSync(`${from}.lock`)) return undefined
  try {
    renameSync(from, to)
    return to
  } catch {
    return undefined
  }
}

/**
 * Keeps the pre-rename path resolvable, because DSH stores a Session's working directory when it is created: the main
 * Session and every worker Session recorded before the rename name the old path, and a turn fails to start once it is gone.
 * A link also repairs deployments that moved the directory on an earlier start.
 */
function link(from: string, to: string): void {
  if (from === to || existsSync(from) || !existsSync(to)) return
  try {
    symlinkSync(to, from, process.platform === 'win32' ? 'junction' : 'dir')
  } catch {
    // Without the link those Sessions still cannot start; their Evals report the timeout.
  }
}

/** Moves the pre-rename state and lark-cli configuration directories; only the default paths are inferred. */
export function migrateLegacyDirectories(stateDir: string, environment: NodeJS.ProcessEnv = process.env): string[] {
  const moved: string[] = []
  if (stateDir === defaultStateDir(environment) && basename(stateDir) === 'dsh-superagent-plus') {
    const legacy = join(dirname(stateDir), 'dsh-superagent')
    const target = move(legacy, stateDir)
    if (target) moved.push(target)
    link(legacy, stateDir)
  }
  const current = defaultLarkConfigDir(environment)
  const target = move(join(dirname(current), '.lark-cli-dsh-superagent'), current)
  if (target) moved.push(target)
  return moved
}

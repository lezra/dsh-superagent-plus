/**
 * The few places where Windows differs from the POSIX systems this deployment was first written for: starting a CLI that is
 * a Node entry rather than an executable, and running the prepare command with a shell the operating system has.
 * A Windows command script (`.cmd`/`.bat`) is never started directly: Node refuses it, and cmd.exe would re-parse the
 * arguments, so a deployment names the Node entry or the executable instead and this module starts it as one.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, delimiter, dirname, extname, join } from 'node:path'

/** True on Windows, where POSIX shell scripts, `env`, `sh -c` and executable script files are unavailable. */
export const WINDOWS = process.platform === 'win32'

/** A CLI resolved to something a process can start: an executable, or a Node entry run by this runtime's Node. */
export interface Program { readonly file: string; readonly prefix: readonly string[] }

/** True for a JavaScript entry, which this runtime's Node starts directly so Windows needs no `.cmd` shim of its own. */
export const isNodeEntry = (path: string): boolean => /\.(?:js|mjs|cjs)$/i.test(path)

/** True for a Windows command script, which cannot be started directly. */
export const isWindowsScript = (path: string): boolean => /\.(?:cmd|bat)$/i.test(path)

/**
 * A packaged CLI often ships a native executable beside its scripts (for example `bin\lark-cli.exe` next to
 * `scripts\run.js`). Starting that executable instead of re-entering this runtime's Node gives Windows a console
 * process whose window `windowsHide` can suppress, and it avoids the extra console a Node entry's own native child
 * would otherwise create.
 */
export const nativeSibling = (path: string): string | undefined => {
  if (process.platform !== 'win32' || !isNodeEntry(path)) return undefined
  const root = join(path, '..', '..')
  const bin = join(root, 'bin')
  try { return readdirSync(bin).filter(name => name.toLowerCase().endsWith('.exe')).map(name => join(bin, name))[0] } catch { return undefined }
}
/** The executable and leading arguments that start `path`. */
export const programOf = (path: string): Program => isNodeEntry(path)
  ? { file: nativeSibling(path) ?? process.execPath, prefix: nativeSibling(path) ? [] : [path] }
  : { file: path, prefix: [] }

/** The argv that starts `path` with `args`. */
export const commandOf = (path: string, args: readonly string[]): string[] => {
  const program = programOf(path)
  return [program.file, ...program.prefix, ...args]
}

/**
 * The shell that runs the prepare command. On Windows that is PowerShell: the well-known PowerShell 7 install, then a
 * `pwsh.exe` on PATH, then the Windows PowerShell 5.1 every Windows has — the same order DeepSeek Harness resolves for
 * its own pwsh shell, so a machine without PowerShell 7 still runs a prepare command.
 */
export const POWERSHELL = ((): string => {
  if (!WINDOWS) return 'sh'
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const onPath = (process.env.PATH ?? '').split(';')
    .map(entry => entry.trim().replace(/^"|"$/g, ''))
    .filter(entry => entry.length > 0)
    .map(entry => join(entry, 'pwsh.exe'))
  const candidates = [join(programFiles, 'PowerShell', '7', 'pwsh.exe'), ...onPath,
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]
  for (const candidate of candidates) {
    try { if (statSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) return candidate } catch { /* Try the next candidate. */ }
  }
  return 'powershell.exe'
})()

/** The argv that runs one prepare command line in the shell this operating system has. */
export const shellCommand = (command: string): string[] => WINDOWS
  ? [POWERSHELL, '-NoProfile', '-NonInteractive', '-Command', command]
  : ['sh', '-c', command]

/** Extensions Windows appends to a command name on PATH, in PATHEXT order; unused for an absolute path. */
export const windowsCandidates = (name: string): string[] => {
  if (!WINDOWS || extname(name)) return [name]
  const extensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(extension => extension.trim()).filter(Boolean)
  // A Node CLI installed globally also runs as its entry, which is the form this deployment starts.
  return [name, ...extensions.map(extension => extension.toLowerCase()), `${name}.js`]
}

/**
 * The Node entry a Windows command script starts from its own directory. A `.cmd` shim cannot be spawned directly, and
 * the entry it names is what a deployment starts under this runtime's Node.
 */
export function shimEntry(script: string): string | undefined {
  if (!WINDOWS) return undefined
  let text = ''
  try { text = readFileSync(script, 'utf8') } catch { return undefined }
  const directory = dirname(script)
  const entries = [...text.matchAll(/"([^"]*%~dp0[^"]*\.js)"/gi)]
    .map(([, quoted]) => join(directory, quoted!.replace(/%~dp0/gi, '').replace(/^[\\/]+/, '')))
    .filter(entry => existsSync(entry))
  // A shim names several files; the command itself is a CLI entry, not the prefix or help script beside it.
  return entries.find(entry => ['npm-cli.js', 'cli.js', 'bin.js'].includes(basename(entry))) ?? entries[0]
}

/**
 * The npm that runs as an ordinary command on Windows: a Node installation's own `npm-cli.js` when one is on PATH,
 * otherwise the entry the `npm.cmd` shim names. Desktop is an Electron app, so it has no `node.exe` of its own to run
 * npm's entry with, and this runtime's process is only the last resort.
 * @throws Error when Windows has neither npm's entry nor a Node to run it.
 */
export function npmProgram(environment: NodeJS.ProcessEnv = process.env): Program {
  if (!WINDOWS) return { file: 'npm', prefix: [] }
  const directories = (environment.PATH ?? '').split(delimiter).filter(Boolean)
  const node = [join(dirname(process.execPath), 'node.exe'), ...directories.map(directory => join(directory, 'node.exe'))]
    .find(candidate => existsSync(candidate))
  const beside = node ? join(dirname(node), 'node_modules/npm/bin/npm-cli.js') : undefined
  const entry = beside && existsSync(beside) ? beside
    : directories.map(directory => join(directory, 'npm.cmd')).map(shimEntry).find((candidate): candidate is string => !!candidate)
  if (!entry) throw new Error('npm was not found on PATH')
  return { file: node ?? process.execPath, prefix: [entry] }
}

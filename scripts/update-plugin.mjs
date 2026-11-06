#!/usr/bin/env node
/**
 * Rebuild dsh-superagent-plus, install it into a DSH deployment, restart that deployment and prove the new bundle loaded.
 * Two routes: `desktop` (the profile DSH Desktop owns, installed with its own pnpm) and `cli` (a profile the `dsh` CLI
 * owns, installed with `dsh plugin add`). Windows and macOS default to Desktop, Linux defaults to the CLI.
 *
 *   node scripts/update-plugin.mjs [--mode auto|desktop|cli] [--profile <name>] [--url <management-url>]
 *                                  [--no-restart] [--no-bump] [--force-quit] [--check] [--dry-run] [--help]
 *
 * Desktop is stopped, not closed: a window that only hides to the tray keeps the old bundle loaded. --force-quit skips the
 * polite window close and stops the process straight away. On npm, npx and dsh Windows runs the JS entry behind the `.cmd`
 * shim directly, because a shim cannot find its own files once a shell has quoted its name.
 *
 * Exit 0: installed and running. 1: a step failed. 2: running, but a Source reports an error.
 * Every command runs with this repository as its working directory, so the script works from any shell location.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = realpathSync(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(HERE))
const PKG = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
const PNPM = '11.28.5'
const DEPLOYMENT = 'dsh-superagent-plus'
const APP = process.env.DSH_DESKTOP_APP || 'DeepSeek Harness'
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const WINDOWS = process.platform === 'win32'
const PACKAGE = PKG.name.replace(/^@/, '').replace('/', '-')

/** Thrown by fail() so the run ends without process.exit(), which can abort Node while a spawned handle is still closing. */
class Stop extends Error {}
let DRY = false
let CHECK = false
let BUMP = true
let MODE = 'desktop'
let PROFILE = 'desktop'
let API = 'http://127.0.0.1:3082'

function fail(text) { console.error(`FAIL ${text}`); throw new Stop(text) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const md5 = path => createHash('md5').update(readFileSync(path)).digest('hex')

/**
 * Windows puts npm, npx and dsh in `.cmd` shims that locate their own JS entry with `%~dp0`, which becomes the current
 * directory as soon as the shim's name is quoted in a shell command, so the entry is read from the shim and run with node.
 * `read: true` marks a probe, which also runs under --dry-run because reading state changes nothing.
 */
const shims = new Map()
function entryOf(cmd) {
  if (!shims.has(cmd)) {
    const batch = (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, `${cmd}.cmd`)).find(existsSync)
    // A shim names several files and only the one that is the command itself is a usable entry: the Node installation's
    // npm.cmd names npm-prefix.js first, which prints a directory and exits successfully instead of running the build.
    const names = [`${cmd}-cli.js`, 'cli.js', 'bin.js']
    const target = batch && readFileSync(batch, 'utf8').match(/"[^"]*%~?dp0%?[^"]*\.js"/g)
      ?.map(text => text.slice(1, -1)).find(text => names.includes(basename(text.replaceAll('\\', '/'))))
    const candidates = [target && join(dirname(batch), target.replace(/%~?dp0%?/g, '').replace(/^\\/, '').replaceAll('\\', '/'))]
    // A shell whose PATH has no npm, as a conda prompt often has, still has it beside the Node that runs this script.
    // npx lives inside the npm package rather than in a package of its own, so both layouts are tried.
    for (const dir of [dirname(process.execPath), join(dirname(process.execPath), '..', 'lib')]) {
      for (const owner of [cmd, 'npm']) candidates.push(join(dir, 'node_modules', owner, 'bin', `${cmd}-cli.js`))
    }
    shims.set(cmd, candidates.find(path => path && existsSync(path)))
  }
  return shims.get(cmd)
}
function execute(cmd, args, { show = true, capture = false, read = false } = {}) {
  const line = [cmd, ...args].join(' ')
  if (show) console.log(`$ ${line}`)
  if (DRY && !read) return { status: 0, stdout: '' }
  const options = { cwd: REPO, ...(capture ? { encoding: 'utf8' } : { stdio: show ? 'inherit' : 'ignore' }) }
  const entry = WINDOWS ? entryOf(cmd) : undefined
  let answer = entry ? spawnSync(process.execPath, [entry, ...args], options) : spawnSync(cmd, args, options)
  if (answer.error && WINDOWS && !entry) {
    // Last resort: let cmd.exe find the shim, with its name unquoted so the shim still locates its own files.
    answer = spawnSync([cmd, ...args].map(part => (part.includes(' ') ? `"${part}"` : part)).join(' '),
      undefined, { ...options, shell: true })
  }
  if (answer.error) {
    fail(`${cmd} could not run: ${answer.error.message}` +
      (WINDOWS && !entry ? `; no ${cmd}.cmd entry is on this shell's PATH and none sits beside ${process.execPath}` : ''))
  }
  return { status: answer.status, stdout: answer.stdout ?? '' }
}
/** Talks to PowerShell through base64 UTF-16LE, so a script with quotes never has to survive the Windows command line. */
function ps(script) {
  const answer = execute('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { show: false, capture: true, read: true })
  return String(answer.stdout).trim()
}

/** Replaces one version string in package.json, so a bump can be undone when a later step fails. */
function writeVersion(from, to) {
  const raw = readFileSync(join(REPO, 'package.json'), 'utf8')
  if (!raw.includes(`"version": "${from}"`)) fail(`package.json has no "version": "${from}" line to replace`)
  if (!DRY) writeFileSync(join(REPO, 'package.json'), raw.replace(`"version": "${from}"`, `"version": "${to}"`))
}
function bumpVersion() {
  const parts = PKG.version.split('.')
  if (parts.length !== 3 || parts.some(part => !/^\d+$/.test(part))) { console.log(`version ${PKG.version} is not major.minor.patch; leaving it`); return PKG.version }
  const next = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`
  console.log(`version ${PKG.version} -> ${next}`)
  writeVersion(PKG.version, next)
  return next
}

const profileDir = () => join(DSH_HOME, 'profiles', PROFILE)
const installedDir = () => join(profileDir(), 'node_modules', PKG.name)
function installDesktop(tgz) {
  if (!existsSync(profileDir())) fail(`no profile directory at ${profileDir()}; install the plugin once before updating it`)
  const manifest = join(profileDir(), 'package.json')
  const list = JSON.parse(readFileSync(manifest, 'utf8'))
  if (!list.dependencies?.[PKG.name]) fail(`${manifest} has no ${PKG.name} dependency; add the plugin once before updating it`)
  // A profile pins the exact tarball it installed, which is how the Plugin Manager and `dsh plugin add` write it, so a new
  // bundle is only copied after the dependency names it; installing alone leaves the previous version silently in place.
  const spec = `file:${tgz.replaceAll('\\', '/')}`
  if (list.dependencies[PKG.name] !== spec) {
    console.log(`profile dependency ${PKG.name}: ${list.dependencies[PKG.name]} -> ${spec}`)
    if (!DRY) {
      list.dependencies[PKG.name] = spec
      writeFileSync(manifest, JSON.stringify(list, null, 2))
    }
  }
  // Without a version change the spec is unchanged, so the unpacked copy must go and pnpm must be forced.
  if (!BUMP) {
    console.log(`remove ${installedDir()}`)
    if (!DRY) rmSync(installedDir(), { recursive: true, force: true })
  }
  if (execute('npx', ['-y', `pnpm@${PNPM}`, 'install', '--dir', profileDir(), ...(!BUMP ? ['--force'] : [])]).status !== 0) {
    fail('pnpm refused to install the bundle. Never accept its offer to purge node_modules; rerun with the version bumped instead of --no-bump')
  }
}
function installCli(tgz) {
  if (execute('dsh', ['--version'], { show: false, read: true }).status !== 0) fail('the dsh CLI is not on PATH; use --mode desktop or install DSH')
  if (execute('dsh', ['plugin', '--profile', PROFILE, 'add', tgz]).status !== 0) fail(`dsh plugin add failed for profile ${PROFILE}`)
}

/** Stops the running deployment and starts it again: a profile reads its bundles only when its process starts. */
async function restart() {
  const since = Math.floor(Date.now() / 1000)
  if (MODE === 'cli') {
    if (WINDOWS) console.log(`restart it yourself: quit the terminal running dsh --profile ${PROFILE} and start it again`)
    else if (execute('python3', [join(REPO, 'scripts', DEPLOYMENT), 'restart', '--profile', PROFILE, '--url', API]).status !== 0) {
      fail(`scripts/${DEPLOYMENT} restart failed; check it with: python3 scripts/${DEPLOYMENT} status --profile ${PROFILE}`)
    }
    return since
  }
  if (WINDOWS) {
    // Closing the window only hides it: a Desktop that lives in the tray keeps its process, so the host has to be stopped
    // for the profile to reread its bundles. start-desktop.ps1 then clears the lock a stopped host leaves behind.
    const gone = 'for ($i = 0; $i -lt 15; $i++) { if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue)) { break }; Start-Sleep 1 }'
    const script = [`$name = '${APP}'`,
      ...flag('force-quit') ? [] : ['Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object { $null = $_.CloseMainWindow() }', gone],
      'if (Get-Process -Name $name -ErrorAction SilentlyContinue) { Stop-Process -Name $name -Force;' + gone + ' }',
      'if (Get-Process -Name $name -ErrorAction SilentlyContinue) { Write-Output STUCK }'].join('; ')
    if (ps(script).includes('STUCK')) fail(`${APP} is still running: quit it from its tray icon and rerun with --check`)
    // start-desktop.ps1 also clears a lock left by a killed host, which would otherwise make the next launch report an unresponsive plugin.
    if (execute('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(REPO, 'scripts', 'start-desktop.ps1')]).status !== 0) {
      fail('scripts/start-desktop.ps1 could not launch the Desktop application')
    }
  } else {
    execute('osascript', ['-e', `quit app "${APP}"`], { show: false })
    await sleep(3000)
    if (execute('open', ['-a', APP], { show: false }).status !== 0) fail(`could not relaunch ${APP}; open it yourself and rerun with --check`)
    console.log(`relaunched ${APP}`)
  }
  return since
}

/** A reopened state database is the portable proof that the plugin loaded; the panel API listens on a port that changes per launch. */
async function awaitRuntime(since) {
  const lock = join(DSH_HOME, 'state', `${DEPLOYMENT}.lock`)
  const state = join(DSH_HOME, 'state', DEPLOYMENT)
  if (!existsSync(state)) { console.log(`no state directory at ${state}; skipping the liveness wait`); return true }
  for (let attempt = 0; attempt < 90; attempt++) {
    if (existsSync(lock) && readdirSync(state).some(name => {
      const path = join(state, name)
      return statSync(path).isFile() && statSync(path).mtimeMs / 1000 > since
    })) {
      console.log(`runtime up: ${lock} exists and ${state} is being written`)
      return true
    }
    await sleep(1000)
  }
  return false
}

/** Reports each Source's state, which is what shows a DingTalk or Feishu Stream that is connected but receiving nothing. */
async function sources() {
  const endpoints = []
  if (MODE === 'cli') endpoints.push(`${API}/orchestrator/api/sources`)
  else if (WINDOWS) {
    const pid = ps(`(Get-CimInstance Win32_Process -Filter "Name = '${APP}.exe'" ` +
      `| Where-Object { $_.CommandLine -match '--expose-internals' } | Select-Object -First 1).ProcessId`).split(/\r?\n/).pop()
    if (!/^\d+$/.test(pid)) console.log(`${APP} is not running: start it, open Superagent, then rerun with --check`)
    else {
      // netstat, because Get-NetTCPConnection reports no listener for this pid even when netstat lists two.
      const ports = [...new Set(execute('netstat', ['-ano'], { show: false, capture: true, read: true }).stdout.split(/\r?\n/)
        .map(line => line.trim().split(/\s+/))
        .filter(([protocol, local, , state, owner]) => protocol === 'TCP' && state === 'LISTENING' && owner === pid && /^127\.0\.0\.1:\d+$/.test(local))
        .map(([, local]) => local.split(':')[1]))]
      endpoints.push(...ports.map(port => `http://127.0.0.1:${port}/orchestrator/api/sources`))
    }
  } else console.log(`Sources state: read the 来源 tab in the panel (${APP} serves its panel on a port this script cannot look up off Windows)`)
  // A Source that has not read its settings yet reports missing, so the first answer after a restart is not the last one.
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const url of endpoints) {
      try {
        const answer = await fetch(url, { headers: { 'x-orchestrator-request': '1' } })
        if (!answer.ok) continue
        const list = await answer.json()
        if (!Array.isArray(list) || !list.length || !('stats' in list[0])) continue
        if (list.every(source => source.state === 'missing')) { await sleep(5000); break }
        console.log(`panel API: ${url}`)
        let errors = 0
        for (const source of list) {
          const health = (source.health ?? []).map(item => `${item.name}=${item.state}`).join(' ')
          console.log(`  ${source.id}: state=${source.state} enabled=${source.enabled} received=${source.stats?.received ?? '-'} filtered=${source.stats?.filtered ?? '-'} ${health}`)
          if (source.state === 'error' || (source.health ?? []).some(item => item.state === 'error')) errors++
        }
        return errors
      } catch { /* Another loopback listener answered; the next port may be the panel. */ }
    }
  }
  console.log('panel API not answering with Sources yet: open Superagent in the sidebar, then rerun with --check')
  return 0
}

function verify() {
  const target = installedDir()
  if (!existsSync(target)) fail(`${target} is missing: this profile does not have the bundle installed`)
  if (realpathSync(target) === REPO) return console.log('the profile links this checkout, so the built files are the installed files')
  const shared = readdirSync(join(REPO, 'lib')).filter(name => name.endsWith('.js'))
  const missing = shared.filter(name => !existsSync(join(target, 'lib', name)))
  const stale = shared.filter(name => !missing.includes(name) && md5(join(REPO, 'lib', name)) !== md5(join(target, 'lib', name)))
  console.log(`installed version: ${JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version}`)
  if (missing.length) fail(`the installed bundle lacks ${missing.join(', ')}`)
  if (stale.length) fail(`the installed bundle still differs from the build: ${stale.join(', ')}`)
  console.log(`bundle is current: ${shared.length} lib/*.js files identical to the build by md5`)
}

const argv = process.argv.slice(2)
const flag = name => argv.includes(`--${name}`)
const option = (name, fallback) => {
  const equal = argv.find(item => item.startsWith(`--${name}=`))
  if (equal) return equal.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  const next = index >= 0 ? argv[index + 1] : undefined
  return next && !next.startsWith('--') ? next : fallback
}
async function main() {
  if (flag('help')) {
    console.log(readFileSync(HERE, 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map(line => line.replace(/^ \*\/? ?/, '')).join('\n').trim())
    return 0
  }
  DRY = flag('dry-run')
  CHECK = flag('check')
  BUMP = !flag('no-bump') && !CHECK
  const wanted = option('mode', 'auto')
  MODE = wanted === 'auto' ? (process.platform === 'linux' ? 'cli' : 'desktop') : wanted
  if (MODE !== 'desktop' && MODE !== 'cli') fail('--mode must be auto, desktop or cli')
  PROFILE = option('profile', MODE === 'desktop' ? 'desktop' : 'superagent')
  API = option('url', API)
  console.log(`route ${MODE} profile ${PROFILE} repo ${REPO}${DRY ? ' (dry run)' : ''}${CHECK ? ' (check only)' : ''}`)
  if (!CHECK) {
    // The build comes first so a failure leaves no orphan version bump behind.
    if (execute('npm', ['run', 'build']).status !== 0) fail('npm run build failed; nothing was bumped, packed or installed')
    const packed = BUMP ? bumpVersion() : PKG.version
    const tgz = join(REPO, 'dist', `${PACKAGE}-${packed}.tgz`)
    // npm pack writes the tarball into the working directory, and only reads a package there, unlike npm run, which searches
    // upward. Its --pack-destination flag is rejected as an unknown config by some npm builds, so the file is moved here.
    if (execute('npm', ['pack']).status !== 0) {
      if (packed !== PKG.version) writeVersion(packed, PKG.version)
      fail(`npm pack failed; the version bump is undone, back to ${PKG.version}`)
    }
    if (!DRY) {
      const dropped = join(REPO, `${PACKAGE}-${packed}.tgz`)
      if (!existsSync(dropped)) fail(`npm pack left no ${dropped}; check the npm output above`)
      mkdirSync(dirname(tgz), { recursive: true })
      renameSync(dropped, tgz)
    }
    if (!DRY && !existsSync(tgz)) fail(`expected the tarball ${tgz}`)
    console.log(`package ${tgz}`)
    if (MODE === 'desktop') installDesktop(tgz)
    else installCli(tgz)
    if (flag('no-restart')) console.log('not restarting: the running process still has the previous bundle loaded')
    else if (DRY) console.log(`dry run: would quit ${APP} and relaunch it so the profile loads this bundle`)
    else {
      const since = await restart()
      if (!(await awaitRuntime(since))) fail('the deployment did not reopen its state database within 90s; rerun with --check')
    }
    const rollback = join(REPO, 'dist', `${PACKAGE}-${PKG.version}.tgz`)
    console.log(existsSync(rollback)
      ? `rollback: install ${rollback} through the same route and restart; undo the bump with git checkout -- package.json`
      : `no ${PKG.version} tarball in dist to roll back to; to undo this build, check out the previous commit and rerun`)
  }
  verify()
  const errors = await sources()
  console.log(errors > 0 ? `done, but ${errors} Source(s) report an error state` : 'done')
  return errors > 0 ? 2 : 0
}
try { process.exitCode = await main() } catch (error) {
  if (!(error instanceof Stop)) console.error(error)
  process.exitCode = 1
}

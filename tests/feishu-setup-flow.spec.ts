/** The Feishu sign-in flow driven by a fake lark-cli: the URL it prints becomes a QR image, and a finished sign-in is ready. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { FeishuSetup } from '../src/app/feishu-setup.ts'

/** A 1×1 PNG, enough for the panel to show a data URL while the URL text is what matters here. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const URL_TEXT = 'https://open.feishu.cn/page/cli?user_code=FAKE'
/**
 * A fake lark-cli: prints the verification URL, renders the QR PNG, and stays pending until stopped. Its identity policy
 * is a file, so the flow reads it after a sign-in and sets it when the operator confirms the restriction.
 */
function fakeLarkCli(directory: string, exitAfterPrint: boolean, mode = 'bot'): string {
  const file = join(directory, 'fake-lark-cli.mjs')
  const policy = join(directory, 'strict-mode.txt')
  writeFileSync(file, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args[0] === 'config' && args[1] === 'strict-mode') {
  if (args[2]) writeFileSync(${JSON.stringify(policy)}, args[2])
  const mode = existsSync(${JSON.stringify(policy)}) ? readFileSync(${JSON.stringify(policy)}, 'utf8') : ${JSON.stringify(mode)}
  console.log('strict-mode: ' + mode + ' (source: global)')
  process.exit(0)
}
if (args[0] === 'auth') {
  const at = args.indexOf('--output')
  writeFileSync(args[at + 1], Buffer.from(${JSON.stringify(PNG.toString('base64'))}, 'base64'))
  process.exit(0)
}
console.log('open this URL: ${URL_TEXT}')
if (${exitAfterPrint}) setTimeout(() => process.exit(0), 300)
setInterval(() => {}, 1000)
`)
  return file
}
const setupFor = (directory: string, exitAfterPrint: boolean, mode = 'bot') => new FeishuSetup({ stateDir: directory,
  larkCli: () => fakeLarkCli(directory, exitAfterPrint, mode), configDir: () => join(directory, 'config'),
  installCli: async () => { throw new Error('the fake lark-cli exists, so nothing should be installed') } })

it('installs lark-cli when none can start, then opens the sign-in with the installed entry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feishu-setup-'))
  const cli = fakeLarkCli(directory, true)
  let installed = 0
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const setup = new FeishuSetup({ stateDir: directory, larkCli: () => 'dsh-superagent-plus-missing-lark-cli',
    configDir: () => join(directory, 'config'),
    installCli: async () => { installed++; await gate; return cli } })
  expect(setup.begin()).toEqual({ state: 'installing' })
  finish()
  await vi.waitFor(() => { expect(setup.status().state).toBe('ready') }, { timeout: 20_000 })
  expect(installed).toBe(1)
  expect(setup.status().cli).toBe(cli)
  expect(setup.status().configDir).toBe(join(directory, 'config'))
})

it('reports a failed install instead of a sign-in', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feishu-setup-'))
  const setup = new FeishuSetup({ stateDir: directory, larkCli: () => 'dsh-superagent-plus-missing-lark-cli',
    configDir: () => join(directory, 'config'), installCli: async () => { throw new Error('no network') } })
  expect(setup.begin()).toEqual({ state: 'installing' })
  await vi.waitFor(() => { expect(setup.status().state).toBe('failed') }, { timeout: 10_000 })
  expect(setup.status().message).toContain('no network')
})

it('turns the URL lark-cli prints into a QR image while the sign-in stays open', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feishu-setup-'))
  const setup = setupFor(directory, false)
  expect(await setup.begin()).toMatchObject({ state: 'pending' })
  await vi.waitFor(() => { expect(setup.status().qr).toBeDefined() }, { timeout: 10_000 })
  const status = setup.status()
  expect(status.state).toBe('pending')
  expect(status.url).toBe(URL_TEXT)
  expect(status.qr!.startsWith('data:image/png;base64,')).toBe(true)
  expect(setup.cancel()).toEqual({ state: 'idle' })
})

it('reports a finished sign-in as ready when the CLI already limits itself to the bot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feishu-setup-'))
  const setup = setupFor(directory, true)
  await setup.begin()
  // A quick exit is the one case where the QR render may not have started; the URL is covered by the pending case.
  await vi.waitFor(() => { expect(setup.status().state).toBe('ready') }, { timeout: 20_000 })
})

it('asks to restrict a signed-in CLI that still allows a user identity, then reports it ready', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feishu-setup-'))
  const setup = setupFor(directory, true, 'off')
  await setup.begin()
  await vi.waitFor(() => { expect(setup.status().state).toBe('identity') }, { timeout: 20_000 })
  expect(setup.status().cli).toBeDefined()
  expect(setup.restrict()).toMatchObject({ state: 'restricting' })
  await vi.waitFor(() => { expect(setup.status().state).toBe('ready') }, { timeout: 20_000 })
  expect(readFileSync(join(directory, 'strict-mode.txt'), 'utf8')).toBe('bot')
})

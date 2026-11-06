/** The Feishu sign-in flow driven by a fake lark-cli: the URL it prints becomes a QR image, and a finished sign-in is ready. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { FeishuSetup } from '../src/app/feishu-setup.ts'

/** A 1×1 PNG, enough for the panel to show a data URL while the URL text is what matters here. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const URL_TEXT = 'https://open.feishu.cn/page/cli?user_code=FAKE'
/** A fake lark-cli: prints the verification URL, renders the QR PNG, and stays pending until stopped. */
function fakeLarkCli(directory: string, exitAfterPrint: boolean): string {
  const file = join(directory, 'fake-lark-cli.mjs')
  writeFileSync(file, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
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
const setupFor = (directory: string, exitAfterPrint: boolean) => new FeishuSetup({ stateDir: directory,
  larkCli: () => fakeLarkCli(directory, exitAfterPrint), configDir: () => join(directory, 'config') })

it('turns the URL lark-cli prints into a QR image while the sign-in stays open', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feishu-setup-'))
  const setup = setupFor(directory, false)
  expect(await setup.begin()).toEqual({ state: 'pending' })
  await vi.waitFor(() => { expect(setup.status().qr).toBeDefined() }, { timeout: 10_000 })
  const status = setup.status()
  expect(status.state).toBe('pending')
  expect(status.url).toBe(URL_TEXT)
  expect(status.qr!.startsWith('data:image/png;base64,')).toBe(true)
  expect(setup.cancel()).toEqual({ state: 'idle' })
})

it('reports a finished sign-in as ready', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feishu-setup-'))
  const setup = setupFor(directory, true)
  await setup.begin()
  // A quick exit is the one case where the QR render may not have started; the URL is covered by the pending case.
  await vi.waitFor(() => { expect(setup.status().state).toBe('ready') }, { timeout: 20_000 })
})

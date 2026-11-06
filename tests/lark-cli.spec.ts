/** Installing lark-cli into the deployment's own tools directory, and reusing a CLI that already starts. */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { ensureLarkCli, installLarkCli } from '../src/app/lark-cli.ts'

const entryOf = (stateDir: string): string => join(stateDir, 'tools/node_modules/@larksuite/cli/scripts/run.js')
/** An installer that writes the entry npm would have produced, recording the directory it was given. */
const installer = (calls: string[]) => async (directory: string): Promise<void> => {
  calls.push(directory)
  const entry = join(directory, 'node_modules/@larksuite/cli/scripts/run.js')
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(entry, '')
}

it('installs lark-cli into the deployment tools directory and returns its entry', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'lark-tools-'))
  const calls: string[] = []
  expect(await installLarkCli(stateDir, installer(calls))).toBe(entryOf(stateDir))
  expect(calls).toEqual([join(stateDir, 'tools')])
  // npm runs lark-cli's install script only when the tools manifest allows it, and that script fetches the binary.
  expect(JSON.parse(readFileSync(join(stateDir, 'tools/package.json'), 'utf8')))
    .toEqual({ private: true, allowScripts: { '@larksuite/cli': true } })
})

it('uses the CLI it is given and the installed copy before installing again', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'lark-tools-'))
  const calls: string[] = []
  expect(await ensureLarkCli(stateDir, process.execPath, installer(calls))).toBe(process.execPath)
  expect(calls).toEqual([])
  expect(await ensureLarkCli(stateDir, 'dsh-superagent-missing-lark-cli', installer(calls))).toBe(entryOf(stateDir))
  expect(calls).toHaveLength(1)
  // The second call finds the deployment's own copy, so it does not install again.
  expect(await ensureLarkCli(stateDir, 'dsh-superagent-missing-lark-cli', installer(calls))).toBe(entryOf(stateDir))
  expect(calls).toHaveLength(1)
})

/** Reading the verification URL out of lark-cli's sign-in output, and finding lark-cli before a bot exists. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { defaultLarkCli } from '../src/deployment.ts'
import { verificationUrl } from '../src/app/feishu-setup.ts'

it('takes the verification URL from lark-cli output, whichever stream printed it', () => {
  expect(verificationUrl('open this URL in your browser: https://open.feishu.cn/page/cli?code=abc\nwaiting…'))
    .toBe('https://open.feishu.cn/page/cli?code=abc')
  expect(verificationUrl('https://accounts.feishu.cn/qr/XYZ)')).toBe('https://accounts.feishu.cn/qr/XYZ')
  expect(verificationUrl('"https://example.test/verify?x=1"')).toBe('https://example.test/verify?x=1')
  expect(verificationUrl('')).toBeUndefined()
  expect(verificationUrl('waiting for the browser')).toBeUndefined()
})

it('finds the npm global lark-cli before any bot is configured', () => {
  const root = mkdtempSync(join(tmpdir(), 'lark-cli-'))
  const entry = join(root, 'npm/node_modules/@larksuite/cli/scripts/run.js')
  mkdirSync(join(root, 'npm/node_modules/@larksuite/cli/scripts'), { recursive: true })
  writeFileSync(entry, '')
  expect(defaultLarkCli({ APPDATA: root } as NodeJS.ProcessEnv)).toBe(entry)
  expect(defaultLarkCli({ USERPROFILE: join(root, 'nobody') } as NodeJS.ProcessEnv)).toBe('lark-cli')
})
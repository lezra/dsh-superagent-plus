/** DingTalk's app-registration device flow: init, begin, and the poll that returns the new app's credentials. */
import { expect, it, vi } from 'vitest'
import { DingTalkSetup, type DingTalkSetupStatus } from '../src/app/dingtalk-setup.ts'

const json = (body: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(body), { status: 200,
  headers: { 'content-type': 'application/json' }, ...init })
const BEGIN = { errcode: 0, errmsg: 'ok', device_code: 'device-1', expires_in: 7200, user_code: 'AB12',
  verification_uri_complete: 'https://open-dev.dingtalk.com/openapp/registration/openClaw?user_code=AB12&source=DSH' }
function setupWith(responses: Response[], options: { now?: () => number; verify?: (appKey: string, appSecret: string) => Promise<void> } = {}) {
  const calls: { url: string; cookie: string | null; body: unknown }[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), cookie: new Headers(init?.headers).get('cookie'), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const response = responses.shift()
    if (!response) throw new Error('unexpected request')
    return response
  }) as unknown as typeof fetch
  return { setup: new DingTalkSetup({ fetch: fetchImpl, ...options }), calls }
}

it('opens a registration and returns the page to scan, carrying the init cookie into begin', async () => {
  const { setup, calls } = setupWith([json({ errcode: 0, nonce: 'nonce-1' },
    { headers: { 'set-cookie': 'sid=abc; Path=/; HttpOnly' } }), json(BEGIN)])
  const status = await setup.begin()
  expect(status.state).toBe('pending')
  expect(status.url).toBe(BEGIN.verification_uri_complete)
  expect(calls[0]!.url).toMatch(/\/app\/registration\/init$/)
  expect(calls[0]!.body).toEqual({ source: 'DSH-Superagent' })
  expect(calls[1]!.url).toMatch(/\/app\/registration\/begin$/)
  expect(calls[1]!.body).toEqual({ nonce: 'nonce-1' })
  expect(calls[1]!.cookie).toBe('sid=abc')
})

it('reports the created app once DingTalk confirms the scan', async () => {
  let now = 0
  const { setup } = setupWith([json({ errcode: 0, nonce: 'n' }), json(BEGIN), json({ errcode: 0, status: 'WAITING' }),
    json({ errcode: 0, status: 'SUCCESS', client_id: 'ding-appkey', client_secret: 'ding-secret' })], { now: () => now })
  await setup.begin()
  now = 10_000
  expect((await setup.poll()).state).toBe('pending')
  now = 20_000
  const ready: DingTalkSetupStatus = await setup.poll()
  expect(ready).toMatchObject({ state: 'ready', appKey: 'ding-appkey', appSecret: 'ding-secret' })
})

it('does not ask twice inside the poll interval, and reports an expired code', async () => {
  let now = 0
  const { setup } = setupWith([json({ errcode: 0, nonce: 'n' }), json(BEGIN), json({ errcode: 0, status: 'EXPIRED' })], { now: () => now })
  await setup.begin()
  expect((await setup.poll()).state).toBe('pending')
  now = 100_000
  expect((await setup.poll()).state).toBe('failed')
  expect(setup.status().message).toContain('expired')
})

it('fails with DingTalk\'s message when the platform refuses, and cancels to idle', async () => {
  const { setup } = setupWith([json({ errcode: 40001, errmsg: 'invalid nonce' })])
  expect(await setup.begin()).toMatchObject({ state: 'failed', message: 'invalid nonce' })
  expect(setup.cancel()).toEqual({ state: 'idle' })
})

it('checks the new credentials and reports the check', async () => {
  const checked: string[] = []
  const { setup } = setupWith([json({ errcode: 0, nonce: 'n' }), json(BEGIN),
    json({ errcode: 0, status: 'SUCCESS', client_id: 'k', client_secret: 's' })],
  { verify: async (appKey, appSecret) => { checked.push(appKey + ':' + appSecret) } })
  await setup.begin()
  const ready = await setup.poll()
  expect(ready).toMatchObject({ state: 'ready', verified: true })
  expect(checked).toEqual(['k:s'])
})

it('keeps ready but records why the credential check failed', async () => {
  const { setup } = setupWith([json({ errcode: 0, nonce: 'n' }), json(BEGIN),
    json({ errcode: 0, status: 'SUCCESS', client_id: 'k', client_secret: 's' })],
  { verify: async () => { throw new Error('app not published') } })
  await setup.begin()
  const ready = await setup.poll()
  expect(ready).toMatchObject({ state: 'ready', verified: false, verifyError: 'app not published' })
})

it('re-checks the created app after its version is published', async () => {
  let calls = 0
  const { setup } = setupWith([json({ errcode: 0, nonce: 'n' }), json(BEGIN),
    json({ errcode: 0, status: 'SUCCESS', client_id: 'k', client_secret: 's' })],
  { verify: async () => { calls += 1; if (calls === 1) throw new Error('app not published') } })
  await setup.begin()
  expect(await setup.poll()).toMatchObject({ state: 'ready', verified: false })
  const checked = await setup.check()
  expect(checked).toMatchObject({ state: 'ready', verified: true })
  expect(checked.verifyError).toBeUndefined()
})

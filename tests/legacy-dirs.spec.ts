import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyDirectories } from '../src/app/legacy-dirs.ts'

const roots: string[] = []
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-dirs-'))
  roots.push(dir)
  return dir
}
const environment = (home: string): NodeJS.ProcessEnv => ({ HOME: home, USERPROFILE: home })
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('migrateLegacyDirectories', () => {
  it('moves the old state and lark-cli directories when the new paths are absent', () => {
    const home = root()
    const legacyState = join(home, '.dsh', 'state', 'dsh-superagent')
    mkdirSync(legacyState, { recursive: true })
    writeFileSync(join(legacyState, 'orchestrator.sqlite'), 'state')
    const legacyLark = join(home, '.lark-cli-dsh-superagent')
    mkdirSync(legacyLark)
    writeFileSync(join(legacyLark, 'config.json'), '{}')

    const moved = migrateLegacyDirectories(join(home, '.dsh', 'state', 'dsh-superagent-plus'), environment(home))

    expect(moved).toEqual([join(home, '.dsh', 'state', 'dsh-superagent-plus'), join(home, '.lark-cli-dsh-superagent-plus')])
    expect(existsSync(join(home, '.dsh', 'state', 'dsh-superagent-plus', 'orchestrator.sqlite'))).toBe(true)
    expect(existsSync(join(home, '.lark-cli-dsh-superagent-plus', 'config.json'))).toBe(true)
    expect(existsSync(legacyState)).toBe(false)
    expect(existsSync(legacyLark)).toBe(false)
  })

  it('keeps both directories when the new path already exists', () => {
    const home = root()
    const legacy = join(home, '.dsh', 'state', 'dsh-superagent')
    const current = join(home, '.dsh', 'state', 'dsh-superagent-plus')
    mkdirSync(legacy, { recursive: true })
    mkdirSync(current, { recursive: true })

    expect(migrateLegacyDirectories(current, environment(home))).toEqual([])
    expect(existsSync(legacy)).toBe(true)
  })

  it('does not move a state directory a running older deployment still locks', () => {
    const home = root()
    const legacy = join(home, '.dsh', 'state', 'dsh-superagent')
    mkdirSync(legacy, { recursive: true })
    mkdirSync(`${legacy}.lock`)

    expect(migrateLegacyDirectories(join(home, '.dsh', 'state', 'dsh-superagent-plus'), environment(home))).toEqual([])
    expect(existsSync(legacy)).toBe(true)
  })

  it('leaves a custom state directory alone', () => {
    const home = root()
    const legacy = join(home, 'custom-state')
    mkdirSync(legacy, { recursive: true })

    expect(migrateLegacyDirectories(legacy, environment(home))).toEqual([])
    expect(existsSync(legacy)).toBe(true)
  })
})

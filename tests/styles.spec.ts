import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const dir = join(process.cwd(), 'src/client')
const css = readFileSync(join(dir, 'client.css'), 'utf8')
const code = readdirSync(dir).filter(name => /\.tsx?$/.test(name)).map(name => readFileSync(join(dir, name), 'utf8')).join('\n')

it('styles only classes a component uses', () => {
  // Template literals like `dt-btn-${variant}` match any class with that prefix.
  const prefixes = [...code.matchAll(/(dt-[\w-]*-)\$\{/g)].map(match => match[1]!)
  const used = (name: string) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(code) || prefixes.some(prefix => name.startsWith(prefix))
  const classes = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(dt-[\w-]+)/g)].map(match => match[1]!))
  expect([...classes].filter(name => !used(name))).toEqual([])
})

it('gives every open lane its own card signal on the left edge', () => {
  const rails = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.dt-bcard\[data-stage='(\w+)'\](?:\[data-action='(\w+)'\])?::before \{[^}]*animation: ([\w-]+)/g)]
    .map(match => `${match[1]}${match[2] ? `/${match[2]}` : ''}:${match[3]}`)
  expect(rails.sort()).toEqual(['idle:dt-rail-breathe', 'person:dt-rail-alert', 'working/queued:dt-rail-wait', 'working:dt-scan'])
})

it('gives the portaled ended card its own panel tokens', () => {
  const rule = css.match(/\.dt-ended-pop \{[^}]*\}/)?.[0] ?? ''
  expect(rule).toContain('--dt-surface: var(--dsw-alias-bg-layer-2)')
  expect(rule).toContain('background: var(--dt-surface)')
})

it('keeps the pinned node detail inside its grid column so it cannot cover the track', () => {
  const rule = css.match(/\.dt-node-detail \{[^}]*\}/)?.[0] ?? ''
  expect(rule).toContain('box-sizing: border-box')
})

it('keeps side-list cards at their own height so a long list scrolls instead of squashing', () => {
  const rule = css.match(/\.dt-person-card \{[^}]*\}/)?.[0] ?? ''
  expect(rule).toContain('flex: none')
})

it('tints a selected side-list card with the ink of its own avatar', () => {
  const rule = css.match(/\.dt-person-card\.is-selected \{[^}]*\}/)?.[0] ?? ''
  expect(rule).toContain('var(--dt-person-ink')
})

it('locks the team rail and its detail to the height the page opened with', () => {
  const rules = [...css.matchAll(/\.dt-team-split \{[^}]*\}/g)]
  expect(rules.at(-1)?.[0] ?? '').toContain('grid-template-rows: var(--dt-team-h, auto)')
  const detail = css.match(/\.dt-team-detail-panel \{[^}]*\}/g)?.at(-1) ?? ''
  expect(detail).toContain('min-height: 0')
  expect(detail).toContain('overflow-y: auto')
})

it('writes one rule per line, each selector once within its block', () => {
  const blocks: string[][] = [[]]
  for (const line of css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(text => text.trim()).filter(Boolean)) {
    if (line === '}') { blocks.pop(); continue }
    if (/^@(media|container|supports)\b.*\{$/.test(line)) { blocks.push([]); continue }
    // A rule, or a keyframes rule with its steps, opens and closes on its line.
    expect(line).toMatch(/^[^{}]+\{[^{}]*\}$|^@keyframes [\w-]+ \{( [^{}]+ \{[^{}]*\})+ \}$/)
    if (line.startsWith('@')) continue
    const selector = line.slice(0, line.indexOf('{')).trim()
    expect(blocks.at(-1)).not.toContain(selector)
    blocks.at(-1)!.push(selector)
  }
})

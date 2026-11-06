import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { mergeMcpBlock, mcpPatch, syncMcp } from '../src/app/mcp.ts'

it('writes a managed MCP block that DSH can load, and replaces it on the next save', () => {
  const first = mergeMcpBlock('', ['codegraph'])
  expect(first).toContain('# >>> dsh-superagent-plus MCP servers')
  expect(first).toContain('id: superagent-mcp-codegraph')
  expect(first).toContain('name: "@deepseek-ai/dsh-mcp-client"')
  expect(first).toContain('serverName: codegraph')
  const second = mergeMcpBlock(first, ['drawio'])
  expect(second).not.toContain('superagent-mcp-codegraph')
  expect(second).toContain('serverName: drawio')
  expect((second.match(/dsh-mcp-client/g) ?? []).length).toBe(1)
})

it('removes the block when nothing is enabled and keeps the rest of the patch', () => {
  const patch = mergeMcpBlock('- id: other\n  disabled: true\n', ['codegraph'])
  expect(mergeMcpBlock(patch, [])).toBe('- id: other\n  disabled: true\n')
  expect(mcpPatch([])).toBe('')
})

it('syncMcp writes the profile patch in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-'))
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: other\n')
  const result = syncMcp(dir, ['codegraph'])
  expect(result.servers).toEqual(['codegraph'])
  expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('serverName: codegraph')
  expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('id: other')
})

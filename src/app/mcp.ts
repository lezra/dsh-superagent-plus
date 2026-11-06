/**
 * MCP servers a profile may switch on. DSH starts MCP clients per deployment (profile patch layer), so enabling one here
 * writes a managed block into that profile's `cordis.patch.yml`; the deployment then must restart to load it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** One stdio MCP server this plugin can start; secrets are environment-variable names, never values. */
export interface McpStartSpec {
  name: string
  command: string
  args: string[]
  /** Environment variable names passed through to the server process. */
  envKeys?: string[]
}
/** The stdio servers this plugin knows how to start. */
export const MCP_CATALOG: Record<string, McpStartSpec> = {
  codegraph: { name: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'] },
  drawio: { name: 'drawio', command: 'npx', args: ['@next-ai-drawio/mcp-server@latest'] },
}
export const mcpStartable = (name: string): boolean => name in MCP_CATALOG
const BEGIN = '# >>> dsh-superagent MCP servers (managed block; everything outside it is kept)'
const END = '# <<< dsh-superagent MCP servers (managed block)'

/** The YAML patch entries that start the named servers, as one insert list. */
export function mcpPatch(enabled: readonly string[]): string {
  const specs = enabled.map(name => MCP_CATALOG[name]).filter((spec): spec is McpStartSpec => !!spec)
  if (!specs.length) return ''
  const rows = specs.flatMap(spec => [
    `  - id: superagent-mcp-${spec.name}`,
    `    name: "@deepseek-ai/dsh-mcp-client"`,
    `    config:`,
    `      serverName: ${spec.name}`,
    `      transport: stdio`,
    `      command: "${spec.command}"`,
    `      args: [${spec.args.map(arg => JSON.stringify(arg)).join(', ')}]`,
    ...spec.envKeys?.length ? [`      env: { ${spec.envKeys.map(key => `${key}: !!js process.env.${key}`).join(', ')} }`] : [],
    `      failOnStartupError: false`,
  ])
  return [`- insert:`, ...rows].join('\n')
}

/** The patch file text with the managed block replaced by `enabled`'s servers (removed when none). */
export function mergeMcpBlock(text: string, enabled: readonly string[]): string {
  const kept = text.replace(new RegExp(`${escape(BEGIN)}[\\s\\S]*?${escape(END)}\\s*`, 'g'), '').trimEnd()
  const block = mcpPatch(enabled)
  if (!block) return kept ? `${kept}\n` : ''
  return `${kept ? `${kept}\n` : ''}${BEGIN}\n${block}\n${END}\n`
}
/** Writes the managed block into one profile's patch file; returns the file it wrote. */
export function syncMcp(profileDir: string, enabled: readonly string[]): { path: string; servers: string[] } {
  const path = join(profileDir, 'cordis.patch.yml')
  let existing = ''
  try { existing = readFileSync(path, 'utf8') } catch { existing = '' }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, mergeMcpBlock(existing, enabled))
  return { path, servers: enabled.filter(name => mcpStartable(name)) }
}
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

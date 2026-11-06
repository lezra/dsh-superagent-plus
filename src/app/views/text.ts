/** Text sanitization and formatting helpers for plain-text previews and HTML-free Markdown in views. */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }
/** Strips HTML comments and tags, decodes basic entities, and strips again to catch entity-encoded tags. */
const withoutHtml = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-zA-Z][^>]*>/g, '')
  .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_match, name: string) => ENTITIES[name]!)
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-zA-Z][^>]*>/g, '')
export function plain(text: string, lines = false): string {
  const result = withoutHtml(text)
    .replace(/!\[[^\]]*\]\([^)]*\)|\[Image: [^\]]*\]/g, '[image]')
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*]\s+/gm, lines ? '• ' : '').replace(/(\*\*|__|`)/g, '')
  return lines ? result.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : result.replace(/\s+/g, ' ').trim()
}
export const markdown = (text: string): string => withoutHtml(text).replace(/!\[[^\]]*\]\([^)]*\)|\[Image: [^\]]*\]/g, '[image]').trim()
/** An image or link a message carried, with the name a person can scan and the target when the source gave one. */
export interface TextAttachment { name: string; url?: string; kind: 'image' | 'link' }
const hostOf = (url: string): string => { try { return new URL(url).hostname } catch (error) { void error; return url } }
/**
 * Extracts attachments from raw message text before `plain` strips their targets: Markdown images and links, Feishu
 * image keys, and bare URLs. Entries dedupe by target (or name for an image key), keeping the first, richest name.
 */
export function attachmentsIn(...texts: (string | undefined)[]): TextAttachment[] {
  const found = new Map<string, TextAttachment>()
  const add = (item: TextAttachment) => { const key = item.url ?? `name:${item.name}`; if (!found.has(key)) found.set(key, item) }
  for (const raw of texts) {
    if (!raw) continue
    const text = withoutHtml(raw)
    for (const match of text.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g))
      add({ kind: 'image', url: match[2]!, name: match[1]!.trim() || hostOf(match[2]!) })
    const prose = text.replace(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, '')
    for (const match of prose.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) add({ kind: 'link', url: match[2]!, name: match[1]!.trim() })
    for (const match of text.matchAll(/\bimg_[a-zA-Z0-9_-]+\b/g)) add({ kind: 'image', name: match[0] })
    for (const match of prose.matchAll(/https?:\/\/[^\s<>()\]]+/g)) {
      const url = match[0].replace(/[.,;:!?，。；：！？]+$/, '')
      add({ kind: 'link', url, name: hostOf(url) })
    }
  }
  return [...found.values()]
}
const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value !== 'object'
function inline(value: unknown): string {
  if (scalar(value)) return value === null ? '' : String(value)
  return (Array.isArray(value) ? value : Object.values(value as object)).map(inline).filter(Boolean).join(Array.isArray(value) ? ', ' : ' · ')
}
function jsonLines(value: unknown): string[] {
  if (Array.isArray(value) && !value.every(scalar)) return value.map(item => `- ${inline(item)}`)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([name, item]) => scalar(item) || (Array.isArray(item) && item.every(scalar)) ? [`${name}: ${inline(item)}`]
      : [`${name}:`, ...jsonLines(item)])
  }
  return [inline(value)]
}
/** Formats JSON payloads (or `label: <JSON>` notices) as key-value lines; returns non-JSON text unchanged. */
export function readable(text: string): string {
  const match = /^(?:([^\n{[]{1,200}): )?(\{[\s\S]*\}|\[[\s\S]*\])$/.exec(text.trim())
  if (!match) return text
  try { return [...match[1] ? [match[1]] : [], ...jsonLines(JSON.parse(match[2]!))].join('\n') }
  catch (error) { void error /* Text that only looks like JSON is shown as written. */; return text }
}
export function preview(text: string, length = 160): string { return plain(readable(text)).slice(0, length) }
export const attribute = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined

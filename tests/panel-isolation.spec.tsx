// @vitest-environment jsdom
/** Two panels on one page must not share a stylesheet, DOM ids, or stored route. */
import { afterEach, expect, it } from 'vitest'
import { mount, usePanel } from './fixtures/panel.tsx'

usePanel()
afterEach(() => { for (const node of [...document.body.children]) node.remove() })

it('mounts two instances with one stylesheet, unique DOM ids, and a route key each', async () => {
  await mount()
  await mount()
  // The stylesheet is installed once for the document, not once per instance.
  expect([...document.querySelectorAll('style')].filter(node => node.id === 'dsh-superagent-styles')).toHaveLength(1)
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.filter(id => id.endsWith('-dt-page'))).toHaveLength(2)
  const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index) ?? '')
  expect(keys.filter(key => key.startsWith('dsh-superagent/route:panel-'))).toHaveLength(2)
})

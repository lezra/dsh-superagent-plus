/** The panel's own QR encoder: sizes, function patterns, and the SVG it hands to the scan modal. */
import { expect, it } from 'vitest'
import { qrMatrix, qrSvg } from '../src/client/qr.ts'

const URL = 'https://open-dev.dingtalk.com/fe/appcreate'

it('sizes the matrix by the version the data needs', () => {
  expect(qrMatrix('a').length).toBe(21)
  expect(qrMatrix(URL).length).toBe(29)
  expect(() => qrMatrix('x'.repeat(300))).toThrow()
})

it('draws the finder and timing patterns the specification requires', () => {
  const matrix = qrMatrix(URL)
  const size = matrix.length
  const dark = (row: number, col: number): boolean => matrix[row]![col]!
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    for (let at = 0; at < 7; at++) {
      expect(dark(top, left + at)).toBe(true)
      expect(dark(top + at, left)).toBe(true)
      expect(dark(top + 6, left + at)).toBe(true)
      expect(dark(top + at, left + 6)).toBe(true)
    }
    expect(dark(top + 1, left + 1)).toBe(false)
    expect(dark(top + 3, left + 3)).toBe(true)
  }
  for (let at = 8; at < size - 8; at++) {
    expect(dark(6, at)).toBe(at % 2 === 0)
    expect(dark(at, 6)).toBe(at % 2 === 0)
  }
  expect(dark(8, size - 8)).toBe(true)
})

it('renders an SVG path with a quiet zone around the modules', () => {
  const { size, path } = qrSvg(URL, 4, 4)
  expect(size).toBe((29 + 8) * 4)
  expect(path.startsWith('M')).toBe(true)
  expect(path).not.toContain('NaN')
})

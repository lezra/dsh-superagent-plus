/**
 * A small QR encoder for the panel's scan-to-open links: byte mode, error correction level M, versions 1 to 10, with the
 * mask the specification's penalty rules choose. It renders as a boolean matrix the panel draws as an SVG, so connecting a
 * Source needs no extra dependency and no image request.
 */
/** Error correction level M: data codewords, and the blocks (count, data per block, ecc per block) per version. */
const VERSIONS: { data: number; blocks: [number, number, number][] }[] = [
  { data: 16, blocks: [[1, 16, 10]] },
  { data: 28, blocks: [[1, 28, 16]] },
  { data: 44, blocks: [[1, 44, 26]] },
  { data: 64, blocks: [[2, 32, 18]] },
  { data: 86, blocks: [[2, 43, 24]] },
  { data: 108, blocks: [[4, 27, 16]] },
  { data: 124, blocks: [[4, 31, 18]] },
  { data: 154, blocks: [[2, 38, 22], [2, 39, 22]] },
  { data: 182, blocks: [[3, 36, 22], [2, 37, 22]] },
  { data: 216, blocks: [[4, 43, 26], [1, 44, 26]] },
]
/** Alignment pattern center coordinates per version. */
const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
/** Format information bits for error correction level M and each mask; the specification's BCH(15,5) code with 0x5412. */
const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]
const SIZE = (version: number): number => 17 + 4 * version

/** Galois field 256 arithmetic used by Reed-Solomon. */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256)
for (let index = 0, value = 1; index < 255; index++) { EXP[index] = value; LOG[value] = index; value <<= 1; if (value & 0x100) value ^= 0x11d }
for (let index = 255; index < 512; index++) EXP[index] = EXP[index - 255]!
const multiply = (a: number, b: number): number => a && b ? EXP[LOG[a]! + LOG[b]!]! : 0
/** The generator polynomial of `degree` error correction codewords. */
function generator(degree: number): number[] {
  let poly = [1]
  for (let index = 0; index < degree; index++) {
    const next = Array.from({ length: poly.length + 1 }, () => 0)
    for (let at = 0; at < poly.length; at++) {
      next[at] = next[at]! ^ poly[at]!
      next[at + 1] = next[at + 1]! ^ multiply(poly[at]!, EXP[index]!)
    }
    poly = next
  }
  return poly
}
function ecc(data: number[], degree: number): number[] {
  const divisor = generator(degree)
  const remainder = [...data, ...Array.from({ length: degree }, () => 0)]
  for (let index = 0; index < data.length; index++) {
    const factor = remainder[index]!
    if (!factor) continue
    for (let at = 0; at < divisor.length; at++) remainder[index + at] = remainder[index + at]! ^ multiply(divisor[at]!, factor)
  }
  return remainder.slice(data.length)
}
/** Picks the smallest version holding `bytes` and returns the encoded bit stream with its data and ecc codewords. */
function codewords(bytes: number[]): { version: number; data: number[]; ecc: number[]; blocks: [number, number, number][] } {
  const length = bytes.length
  const version = VERSIONS.findIndex(entry => {
    const bits = 4 + (VERSIONS.indexOf(entry) < 9 ? 8 : 16) + length * 8
    return entry.data * 8 >= bits + 4
  })
  if (version < 0) throw new Error(`QR data too long: ${length} bytes`)
  const spec = VERSIONS[version]!
  const bits: number[] = []
  const push = (value: number, count: number): void => { for (let index = count - 1; index >= 0; index--) bits.push((value >> index) & 1) }
  push(0b0100, 4)
  push(length, version < 9 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)
  const capacity = spec.data * 8
  for (let index = 0; index < 4 && bits.length < capacity; index++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const stream: number[] = []
  for (let index = 0; index < bits.length; index += 8) stream.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0))
  const pads = [0xec, 0x11]
  for (let index = 0; stream.length < spec.data; index++) stream.push(pads[index % 2]!)
  // Split into blocks, compute each block's ecc, then interleave both.
  const data: number[] = [], eccs: number[] = []
  let offset = 0
  for (const [count, size, degree] of spec.blocks) {
    const group: number[][] = [], groupEcc: number[][] = []
    for (let block = 0; block < count; block++) {
      const slice = stream.slice(offset, offset + size)
      offset += size
      group.push(slice)
      groupEcc.push(ecc(slice, degree))
    }
    const widest = Math.max(...group.map(block => block.length))
    for (let at = 0; at < widest; at++) for (const block of group) if (at < block.length) data.push(block[at]!)
    for (let at = 0; at < groupEcc[0]!.length; at++) for (const block of groupEcc) eccs.push(block[at]!)
  }
  return { version: version + 1, data, ecc: eccs, blocks: spec.blocks }
}
/** A square matrix of modules; `true` is dark. */
export type Matrix = boolean[][]
const make = (size: number): Matrix => Array.from({ length: size }, () => Array.from({ length: size }, () => false))
/** Marks a function pattern; reserved cells never receive data. */
type Reserved = boolean[][]
const reservedOf = (size: number): Reserved => Array.from({ length: size }, () => Array.from({ length: size }, () => false))
/** Finder patterns, separators, timing, alignment, the dark module and the format/version areas. */
function functionPatterns(size: number, version: number): { matrix: Matrix; reserved: Reserved } {
  const matrix = make(size), reserved = reservedOf(size)
  const set = (row: number, col: number, dark: boolean): void => {
    if (row < 0 || col < 0 || row >= size || col >= size) return
    matrix[row]![col] = dark
    reserved[row]![col] = true
  }
  const finder = (row: number, col: number): void => {
    for (let at = -1; at <= 7; at++) for (let other = -1; other <= 7; other++) {
      const inside = at >= 0 && at <= 6 && other >= 0 && other <= 6
      const edge = at === 0 || at === 6 || other === 0 || other === 6
      const core = at >= 2 && at <= 4 && other >= 2 && other <= 4
      set(row + at, col + other, inside && (edge || core))
    }
  }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0)
  for (let at = 8; at < size - 8; at++) { set(6, at, at % 2 === 0); set(at, 6, at % 2 === 0) }
  for (const row of ALIGNMENT[version - 1] ?? []) for (const col of ALIGNMENT[version - 1] ?? []) {
    if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue
    for (let at = -2; at <= 2; at++) for (let other = -2; other <= 2; other++) set(row + at, col + other, Math.max(Math.abs(at), Math.abs(other)) !== 1)
  }
  // Format information (two copies, skipping the timing row and column) and the dark module.
  for (let at = 0; at <= 5; at++) { set(8, at, false); set(at, 8, false) }
  set(8, 7, false); set(8, 8, false); set(7, 8, false)
  for (let at = 0; at < 8; at++) set(size - 1 - at, 8, false)
  for (let at = 8; at < 15; at++) set(8, size - 15 + at, false)
  set(8, size - 8, true)
  if (version >= 7) for (let at = 0; at < 18; at++) { set(Math.floor(at / 3), size - 11 + at % 3, false); set(size - 11 + at % 3, Math.floor(at / 3), false) }
  return { matrix, reserved }
}
/** Places the codeword bits in the zigzag order, skipping function modules. */
function placeData(matrix: Matrix, reserved: Reserved, data: number[], ecc: number[]): void {
  const size = matrix.length
  const bits = [...data, ...ecc].flatMap(byte => Array.from({ length: 8 }, (_, index) => (byte >> (7 - index)) & 1))
  let index = 0, upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step
      for (const column of [right, right - 1]) {
        if (reserved[row]![column]) continue
        matrix[row]![column] = bits[index] === 1
        index++
      }
    }
    upward = !upward
  }
}
const MASKS: ((row: number, col: number) => boolean)[] = [
  (row, col) => (row + col) % 2 === 0,
  row => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => (row * col) % 2 + (row * col) % 3 === 0,
  (row, col) => ((row * col) % 2 + (row * col) % 3) % 2 === 0,
  (row, col) => ((row + col) % 2 + (row * col) % 3) % 2 === 0,
]
/** The specification's four penalty rules; the mask with the lowest total wins. */
function penalty(matrix: Matrix): number {
  const size = matrix.length
  let score = 0
  for (const rows of [matrix, Array.from({ length: size }, (_, row) => matrix.map(line => line[row]!))]) {
    for (const line of rows) {
      let run = 1
      for (let at = 1; at < size; at++) {
        if (line[at] === line[at - 1]) run++
        else { if (run >= 5) score += 3 + run - 5; run = 1 }
      }
      if (run >= 5) score += 3 + run - 5
    }
  }
  for (let row = 0; row < size - 1; row++) for (let col = 0; col < size - 1; col++) {
    const value = matrix[row]![col]
    if (value === matrix[row]![col + 1] && value === matrix[row + 1]![col] && value === matrix[row + 1]![col + 1]) score += 3
  }
  const pattern = [true, false, true, true, true, false, true]
  const matches = (line: boolean[], at: number): boolean => pattern.every((value, index) => line[at + index] === value)
  for (const rows of [matrix, Array.from({ length: size }, (_, row) => matrix.map(line => line[row]!))]) {
    for (const line of rows) for (let at = 0; at + 7 <= size; at++) {
      if (!matches(line, at)) continue
      const light = (from: number, to: number): boolean => Array.from({ length: to - from }, (_, index) => !line[from + index]!).every(Boolean)
      if (light(Math.max(0, at - 4), at) || light(at + 7, Math.min(size, at + 11))) score += 40
    }
  }
  const dark = matrix.flat().filter(Boolean).length
  const ratio = Math.abs((dark * 100) / (size * size) - 50)
  score += Math.floor(ratio / 5) * 10
  return score
}
/** Places the format information for error correction level M and the chosen mask, both copies. */
function placeFormat(matrix: Matrix, mask: number): void {
  const size = matrix.length
  const bits = FORMAT_M[mask]!
  // The 15 bits are placed most significant first, from the top-left copy around to the bottom-right one.
  const bit = (at: number): boolean => ((bits >> (14 - at)) & 1) === 1
  for (let at = 0; at <= 5; at++) matrix[8]![at] = bit(at)
  matrix[8]![7] = bit(6)
  matrix[8]![8] = bit(7)
  matrix[7]![8] = bit(8)
  for (let at = 9; at < 15; at++) matrix[14 - at]![8] = bit(at)
  for (let at = 0; at < 8; at++) matrix[size - 1 - at]![8] = bit(at)
  for (let at = 8; at < 15; at++) matrix[8]![size - 15 + at] = bit(at)
  matrix[8]![size - 8] = true
}
/** Encodes `text` as UTF-8 byte-mode QR and returns the module matrix, quiet zone excluded. */
export function qrMatrix(text: string): Matrix {
  const bytes = [...new TextEncoder().encode(text)]
  const { version, data, ecc } = codewords(bytes)
  const size = SIZE(version)
  const { matrix, reserved } = functionPatterns(size, version)
  placeData(matrix, reserved, data, ecc)
  let best: Matrix | undefined, bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const candidate = matrix.map(line => [...line])
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      if (!reserved[row]![col] && MASKS[mask]!(row, col)) candidate[row]![col] = !candidate[row]![col]
    }
    placeFormat(candidate, mask)
    const score = penalty(candidate)
    if (score < bestScore) { bestScore = score; best = candidate }
  }
  return best!
}
/** Draws the matrix as an SVG path with a `scale`-pixel module and a `quiet`-module margin. */
export function qrSvg(text: string, scale = 4, quiet = 4): { size: number; path: string } {
  const matrix = qrMatrix(text)
  const size = matrix.length
  const parts: string[] = []
  matrix.forEach((line, row) => line.forEach((dark, col) => {
    if (dark) parts.push(`M${(col + quiet) * scale} ${(row + quiet) * scale}h${scale}v${scale}h${-scale}z`)
  }))
  return { size: (size + quiet * 2) * scale, path: parts.join('') }
}

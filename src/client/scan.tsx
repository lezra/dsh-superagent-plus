/** The QR code the panel draws itself, so scanning to connect needs no image request. */
import { qrSvg } from './qr.ts'

/** Renders `url` as an SVG QR code at `scale` pixels per module. */
export function QrCode({ url, scale = 5, label }: { url: string; scale?: number; label: string }) {
  const { size, path } = qrSvg(url, scale)
  return <svg className="dt-scan-qr" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
    <rect width={size} height={size} fill="#fff" />
    <path d={path} fill="#000" shapeRendering="crispEdges" />
  </svg>
}

// A local file's cover, centre-cropped and shrunk to a small JPEG for Discord (QoL 4).
import { nativeImage } from 'electron'
import { access } from 'fs/promises'
import { join } from 'path'

const SIDE = 128
const EXTS = ['jpg', 'png', 'webp']

export async function smallCover(artworkDir: string, hash: string): Promise<Uint8Array | null> {
  if (!/^[0-9a-f]{40}$/.test(hash)) return null
  for (const ext of EXTS) {
    const path = join(artworkDir, `${hash}.${ext}`)
    try {
      await access(path)
    } catch {
      continue
    }
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const side = Math.min(width, height)
    const square = img.crop({
      x: Math.floor((width - side) / 2),
      y: Math.floor((height - side) / 2),
      width: side,
      height: side
    })
    return new Uint8Array(square.resize({ width: SIDE, height: SIDE, quality: 'good' }).toJPEG(82))
  }
  return null
}

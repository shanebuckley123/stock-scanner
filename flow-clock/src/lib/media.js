export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // matches the bucket limit

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
  'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
}

export function extFor(mime, fallbackName = '') {
  const base = (mime || '').split(';')[0].trim()
  if (EXT[base]) return EXT[base]
  const m = /\.([a-z0-9]{2,5})$/i.exec(fallbackName)
  return m ? m[1].toLowerCase() : 'bin'
}

// Shrink big phone photos (often 4–10 MB) to ~2000px JPEG so they upload on
// weak workshop signal. Falls back to the original if the browser can't decode it.
export async function compressImage(file, maxDim = 2000, quality = 0.82) {
  try {
    if (!file.type.startsWith('image/') || file.size < 600 * 1024) return file
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

// iOS Safari records audio/mp4; Android Chrome records audio/webm (opus).
export function pickAudioMime() {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac', 'audio/ogg;codecs=opus']
  if (!MediaRecorder.isTypeSupported) return ''
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? ''
}

export const canRecordAudio = () =>
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

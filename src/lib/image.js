const MAX_WIDTH = 800
const JPEG_QUALITY = 0.82

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const sourceUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(sourceUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl)
      reject(new Error('The image could not be read.'))
    }
    image.src = sourceUrl
  })
}

// Returns a JPEG small enough for phone uploads while preserving its aspect ratio.
export async function compressImage(file) {
  const image = await loadImage(file)
  const scale = Math.min(1, MAX_WIDTH / image.naturalWidth)
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(image, 0, 0, width, height)

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result)
      else reject(new Error('The image could not be compressed.'))
    }, 'image/jpeg', JPEG_QUALITY)
  })

  return new File([blob], 'selfie.jpg', { type: 'image/jpeg' })
}

import { FeedSession } from '@/features/markets/markets.types'

const THUMBNAIL_KEYS = ['thumbnailUrl', 'streamThumbnailUrl', 'posterUrl', 'imageUrl']
const STREAM_KEYS = ['embedUrl', 'streamUrl', 'playbackUrl', 'mediaUrl', 'videoUrl']

function readMetadataValue(metadata: FeedSession['session_metadata'] | undefined, keys: string[]) {
  if (!metadata) {
    return null
  }

  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }

  return null
}

function extractYouTubeVideoId(streamUrl: string) {
  try {
    const url = new URL(streamUrl)
    const host = url.hostname.replace(/^www\./, '')

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') {
        const videoId = url.searchParams.get('v')
        return videoId?.trim() || null
      }

      if (url.pathname.startsWith('/embed/')) {
        const videoId = url.pathname.split('/embed/')[1]?.split('/')[0]
        return videoId?.trim() || null
      }

      if (url.pathname.startsWith('/live/')) {
        const videoId = url.pathname.split('/live/')[1]?.split('/')[0]
        return videoId?.trim() || null
      }
    }

    if (host === 'youtu.be') {
      const videoId = url.pathname.replace('/', '').trim()
      return videoId || null
    }
  } catch {
    return null
  }

  return null
}

export function normalizeStreamUrl(streamUrl: string) {
  const trimmed = streamUrl.trim()
  if (!trimmed) {
    return ''
  }

  const youTubeVideoId = extractYouTubeVideoId(trimmed)
  if (!youTubeVideoId) {
    return trimmed
  }

  return `https://www.youtube.com/watch?v=${youTubeVideoId}`
}

export function getStreamThumbnailFallback(streamUrl: string) {
  const youTubeVideoId = extractYouTubeVideoId(streamUrl.trim())
  if (!youTubeVideoId) {
    return null
  }

  return `https://i.ytimg.com/vi/${youTubeVideoId}/hqdefault.jpg`
}

export function getSessionThumbnailUrl(session?: FeedSession | null) {
  const explicitThumbnail = readMetadataValue(session?.session_metadata, THUMBNAIL_KEYS)
  if (explicitThumbnail) {
    return explicitThumbnail
  }

  const streamUrl = getSessionStreamUrl(session)
  return streamUrl ? getStreamThumbnailFallback(streamUrl) : null
}

export function getSessionStreamUrl(session?: FeedSession | null) {
  const streamUrl = readMetadataValue(session?.session_metadata, STREAM_KEYS)
  return streamUrl ? normalizeStreamUrl(streamUrl) : null
}

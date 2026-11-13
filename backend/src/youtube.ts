import type { YouTubeValidationResult } from '../shared/types.ts';

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function extractYouTubeVideoId(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let candidate: string | null = null;

  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.pathname === '/watch') {
      candidate = parsed.searchParams.get('v');
    } else if (
      parts.length >= 2 &&
      (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v')
    ) {
      candidate = parts[1];
    }
  }

  if (candidate && YOUTUBE_ID_REGEX.test(candidate)) {
    return candidate;
  }
  return null;
}

export async function validateYouTubeUrl(rawUrl: string): Promise<YouTubeValidationResult> {
  const videoId = extractYouTubeVideoId(rawUrl);
  if (!videoId) {
    return {
      valid: false,
      streamableViaRtmp: false,
      explanation:
        'Enter a valid YouTube share URL (e.g., https://www.youtube.com/watch?v=... or https://youtu.be/...).',
    };
  }

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const embedUrl = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&modestbranding=1`;
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  let title: string | undefined;
  let authorName: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (oembedRes.ok) {
      const data = (await oembedRes.json()) as { title?: string; author_name?: string };
      title = data.title;
      authorName = data.author_name;
    }
  } catch {
    // oEmbed is optional metadata enrichment
  }

  return {
    valid: true,
    videoId,
    embedUrl,
    watchUrl,
    title: title || `YouTube Video (${videoId})`,
    authorName: authorName || 'YouTube Channel',
    thumbnailUrl,
    streamableViaRtmp: false,
    explanation:
      'YouTube URL validated and loaded into the official YouTube IFrame Player for preview only. Direct FFmpeg capture or stream extraction from YouTube links is disabled to respect YouTube Terms of Service and DRM protections. To broadcast to Facebook Live via RTMP, select an uploaded MP4/MOV/WebM file or an authorized direct media URL.',
  };
}

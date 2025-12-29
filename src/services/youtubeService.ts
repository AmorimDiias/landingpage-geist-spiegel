export interface VideoContext {
  videoId: string;
  title: string;
  transcript: string;
}

export const getVideoIdFromElement = (element: HTMLAnchorElement | null): string | null => {
  if (!element || !element.href) return null;
  // href format: https://youtu.be/VIDEO_ID or similar
  try {
    const url = new URL(element.href);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1);
    }
    return url.searchParams.get('v');
  } catch (e) {
    console.error('Error parsing video URL', e);
    return null;
  }
};


interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
}

export const fetchTranscript = async (videoId: string): Promise<string> => {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await response.text();

    const splitHtml = html.split('"captionTracks":');
    if (splitHtml.length <= 1) {
      console.warn('No caption tracks found within HTML.');
      return 'Transcrição indisponível.';
    }

    const jsonString = splitHtml[1].split(']')[0] + ']';
    const captionTracks: CaptionTrack[] = JSON.parse(jsonString);

    if (!captionTracks.length) {
      return 'Transcrição indisponível.';
    }

    // Prefer Portuguese or English, or just the first one
    const track = captionTracks.find((t) => t.languageCode.startsWith('pt')) || captionTracks[0];
    const transcriptUrl = track.baseUrl;

    const transcriptResponse = await fetch(transcriptUrl);
    const transcriptXml = await transcriptResponse.text();

    // Parse XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(transcriptXml, 'text/xml');
    const texts = Array.from(xmlDoc.getElementsByTagName('text'));

    return texts.map(node => node.textContent).join(' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  } catch (error) {
    console.error('Error fetching transcript:', error);
    return 'Erro ao buscar transcrição.';
  }
};

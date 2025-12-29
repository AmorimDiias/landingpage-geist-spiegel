/* eslint-disable @typescript-eslint/no-explicit-any */

export const getVideoIdFromUrl = (url: string): string | null => {
  const match = url.match(/\/video\/([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
};

export const fetchTranscript = async (videoId: string): Promise<string> => {
  try {
    console.log(`[AI Suite] Buscando transcrição para vídeo: ${videoId}`);

    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const html = await response.text();

    const captionsMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
    if (!captionsMatch) {
      console.log('[AI Suite] Nenhuma legenda encontrada no vídeo');
      return "";
    }

    const captionTracks = JSON.parse(captionsMatch[1]);

    const track = captionTracks.find((t: any) => t.languageCode?.startsWith('pt')) ||
      captionTracks.find((t: any) => t.languageCode?.startsWith('en')) ||
      captionTracks[0];

    if (!track || !track.baseUrl) {
      console.log('[AI Suite] Nenhuma track de legenda válida encontrada');
      return "";
    }

    console.log(`[AI Suite] Encontrada legenda em: ${track.languageCode}`);

    const transcriptResponse = await fetch(track.baseUrl);
    const transcriptXml = await transcriptResponse.text();

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(transcriptXml, "text/xml");
    const texts = Array.from(xmlDoc.getElementsByTagName("text"));

    const fullTranscript = texts
      .map(node => node.textContent?.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
      .filter(Boolean)
      .join(" ");

    const limitedTranscript = fullTranscript.slice(0, 8000);

    console.log(`[AI Suite] Transcrição obtida: ${limitedTranscript.length} caracteres`);
    return limitedTranscript;

  } catch (e) {
    console.error("[AI Suite] Erro ao buscar transcrição:", e);
    return "";
  }
};

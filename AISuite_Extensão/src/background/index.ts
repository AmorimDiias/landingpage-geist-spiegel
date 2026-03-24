/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

// --- 1. POLYFILLS DE AMBIENTE (Service Worker) ---
// (Mantido igual para garantir funcionamento no ambiente de extensão)
(function polyfillEnvironment() {
  const _self = self as any;
  const _globalThis = globalThis as any;

  if (!_self.window) _self.window = _self;
  if (!_globalThis.window) _globalThis.window = _globalThis;

  const mockDocument = {
    createElement: () => ({ style: {}, appendChild: () => { }, setAttribute: () => { }, getAttribute: () => null, removeAttribute: () => { }, classList: { add: () => { }, remove: () => { }, toggle: () => { }, contains: () => false } }),
    createElementNS: () => ({ style: {}, appendChild: () => { }, setAttribute: () => { }, getAttribute: () => null }),
    createTextNode: () => ({}),
    createDocumentFragment: () => ({ appendChild: () => { }, querySelectorAll: () => [] }),
    head: { appendChild: () => { }, removeChild: () => { } },
    body: { appendChild: () => { }, removeChild: () => { } },
    location: { href: 'https://www.youtube.com', origin: 'https://www.youtube.com', protocol: 'https:', host: 'www.youtube.com', hostname: 'www.youtube.com', pathname: '/', search: '', hash: '' },
    referrer: '', cookie: '', readyState: 'complete',
    documentElement: { style: {} },
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, getElementsByTagName: () => [], getElementsByClassName: () => [],
    addEventListener: (..._args: any[]) => { },
    removeEventListener: (..._args: any[]) => { },
    dispatchEvent: (..._args: any[]) => true,
    createEvent: (..._args: any[]) => ({
      initEvent: (..._args: any[]) => { }
    } as any),
    hidden: false, visibilityState: 'visible'
  };

  if (!_self.document) _self.document = mockDocument;
  if (!_globalThis.document) _globalThis.document = mockDocument;
  if (!_self.screen) _self.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1080 };
  if (!_globalThis.screen) _globalThis.screen = _self.screen;
  if (!_self.navigator) _self.navigator = { userAgent: 'Mozilla/5.0 Chrome Extension', language: 'pt-BR', languages: ['pt-BR', 'en'], onLine: true };

  if (!_self.localStorage) {
    const memoryStore = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => memoryStore.get(key) || null,
      setItem: (key: string, value: string) => { const val = String(value); memoryStore.set(key, val); chrome.storage.local.set({ [key]: val }); },
      removeItem: (key: string) => { memoryStore.delete(key); chrome.storage.local.remove(key); },
      clear: () => { memoryStore.clear(); chrome.storage.local.clear(); },
      key: (i: number) => Array.from(memoryStore.keys())[i] || null,
      get length() { return memoryStore.size; }
    };
    _self.localStorage = localStorageMock;
    _globalThis.localStorage = localStorageMock;
    chrome.storage.local.get(null, (items) => { for (const k in items) memoryStore.set(k, String(items[k])); });
  }
})();

// --- 2. LISTENERS ---
chrome.downloads.onDeterminingFilename.addListener((_downloadItem, suggest) => {
  // Use a string to check if the download originates from grok or is a generic download we want to intercept
  // A URL check is not always bulletproof for data URLs or blob URLs from content scripts, 
  // but we mostly rely on the fact that `nextDownloadName` is set specifically for our grok process.
  chrome.storage.local.get(['nextDownloadName'], (result: any) => {
    if (result.nextDownloadName) {
      console.log(`[Background] Renomeando arquivo Grok: ${result.nextDownloadName}`);
      suggest({
        filename: result.nextDownloadName as string,
        conflictAction: 'uniquify'
      });
      // Remove it after using to avoid side-effects on other downloads
      chrome.storage.local.remove('nextDownloadName');
    } else {
      suggest();
    }
  });
  return true; // Keep the message channel open for async suggest
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'GENERATE_REPLY') {
    chrome.storage.local.get(['generationMode'], (storageResult) => {
      const mode = (storageResult as { generationMode?: string }).generationMode || 'simple';
      handleGen(request.context, mode, _sender.tab?.id).then(sendResponse);
    });
    return true; // Mantém o canal de mensagem aberto para o async
  }

  if (request.type === 'SHOW_NOTIFICATION') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: request.title || 'AI Suite',
      message: request.message || 'Tarefa concluída com sucesso!'
    });
  }

  if (request.action === 'downloadVideo') {
    const filename = `Grok_Videos/${request.filename}.mp4`;
    console.log(`[Background] Baixando vídeo: ${request.url} -> ${filename}`);

    chrome.downloads.download({
      url: request.url,
      filename: filename,
      conflictAction: 'overwrite'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error(`[Background] Erro no download: ${chrome.runtime.lastError.message}`);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log(`[Background] Download iniciado: ${downloadId}`);
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }

  if (request.action === 'log') {
    console.log(request.message);
  }
});

// --- 3a. HELPER PARA TRANSCRIÇÃO (TranscriptAPI) ---
let transcriptCache = { videoId: null as string | null, text: "" };

async function fetchExternalTranscript(videoId: string, tabId?: number): Promise<string> {
  // a) Verifica cache e notifica
  if (transcriptCache.videoId === videoId && transcriptCache.text) {
    console.log('[Background] CACHE HIT - Usando transcrição em cache para:', videoId);
    console.log('[Background] Economia: 0 creditos gastos nesta requisição.');
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'TRANSCRIPT_FETCHED' }).catch(() => { });
    }
    return transcriptCache.text;
  }

  console.log('[Background] Buscando transcrição na TranscriptAPI para:', videoId);

  try {
    // b) Fetch na API (GET com video_url como query param)
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const url = `https://transcriptapi.com/api/v2/youtube/transcript?video_url=${encodeURIComponent(videoUrl)}`;
    console.log('[Background] URL utilizada:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer sk_xxARsOS29OtGy9RvluWL7kU8O20Eawb75eMaYqiU-CM',
        'Accept': 'application/json'
      }
    });

    console.log('[Background] Status da Resposta:', response.status);

    if (!response.ok) {
      console.error(`[Background] Erro na API Transcrição (Status: ${response.status})`);
      return "";
    }

    const data = await response.json();

    // d) Processa resposta (transcript pode ser array de objetos ou string)
    let fullText = "";

    if (Array.isArray(data.transcript)) {
      fullText = data.transcript.map((s: any) => s.text).join(' ');
    } else if (typeof data.transcript === 'string') {
      fullText = data.transcript;
    } else if (data.text) {
      fullText = data.text;
    }

    if (!fullText) {
      console.warn('[Background] Transcrição vazia retornada pela API.');
      return "";
    }

    // e) Atualiza cache e notifica
    transcriptCache = { videoId, text: fullText };

    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'TRANSCRIPT_FETCHED' }).catch(() => { });
    }

    // f) Log de validação
    console.log('[ai suite test] transcricao capturada:', transcriptCache.text.slice(0, 50) + "...");

    return fullText;

  } catch (error) {
    console.error('[Background] Falha de rede. Verifique se a extensão foi atualizada e a página recarregada. Detalhe:', (error as Error).message);
    return "";
  }
}

// --- 3. HELPER PARA CHAMADA API PUTER ---
async function callPuterAI(prompt: string, authToken: string): Promise<string> {
  const response = await fetch('https://api.puter.com/drivers/call', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({
      interface: 'puter-chat-completion',
      driver: 'ai-chat',
      method: 'complete',
      args: {
        messages: [{ content: prompt }],
        model: 'gemini-2.5-pro'
      }
    })
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error("Sessão expirada (401)");
    throw new Error(`Erro API Puter: ${response.status}`);
  }

  const data = await response.json();
  let text = '';
  if (data.result?.message?.content) text = data.result.message.content;
  else if (data.message?.content) text = data.message.content;
  else if (typeof data.result === 'string') text = data.result;
  else if (typeof data === 'string') text = data;

  return text;
}

// --- 4. FLUXO DE GERAÇÃO (RESUMO -> RESPOSTA) ---
async function handleGen(ctx: any, mode: string = 'simple', tabId?: number) {
  console.log(`[Background] Iniciando fluxo. Modo: ${mode}, Video: ${ctx.videoId}`);

  try {
    // 1. Autenticação
    const storage = await chrome.storage.local.get(null) as any;
    const authToken = storage['puter.auth.token'] || storage['puter_auth_token'] || storage['auth_token'];

    if (!authToken) {
      return { success: false, error: "Não autenticado. Abra o popup e faça login." };
    }

    // Informações Básicas
    const videoUrl = `https://www.youtube.com/watch?v=${ctx.videoId}`;
    const videoTitle = ctx.videoTitle || "Vídeo do YouTube";

    // 2. Busca Transcrição (Nova Integração Exclusiva)
    let transcript = "";
    try {
      // Passa o tabId para que o helper gerencie as mensagens de progresso
      transcript = await fetchExternalTranscript(ctx.videoId, tabId);

      if (!transcript && tabId) {
        // Se retornou vazio, avisa falha
        chrome.tabs.sendMessage(tabId, { type: 'TRANSCRIPT_FAILED' }).catch(() => { });
      }
    } catch (err) {
      console.error('[Background] Falha crítica na transcrição, seguindo sem ela.', err);
      if (tabId) chrome.tabs.sendMessage(tabId, { type: 'TRANSCRIPT_FAILED' }).catch(() => { });
    }

    // Limita para 15k chars para o prompt
    const safeTranscript = transcript ? transcript.slice(0, 15000) : "";

    // ---------------------------------------------------------
    // LOGICA DE CONTEXTO: TRANSCRICAO DIRETA vs RESUMO
    // ---------------------------------------------------------
    let contextoParaResposta = "";

    if (safeTranscript) {
      // Transcricao disponivel - pula Passo 1
      console.log('[Background] Usando transcricao direta, pulando Passo 1 (Resumo)');
      contextoParaResposta = safeTranscript;
    } else {
      // Transcricao ausente - recorre ao Passo 1 (Resumo)
      console.log('[Background] Transcricao ausente, recorrendo ao Passo 1 (Resumo)');

      let videoSummary = "Resumo não disponível.";

      if (mode === 'full') {
        console.log('[Background] Passo 1: Gerando resumo do vídeo...');

        const summaryPrompt = `
TAREFA: Analisar o conteúdo do vídeo e gerar um resumo detalhado.

DADOS DO VÍDEO:
Título: "${videoTitle}"
URL: ${videoUrl}

AVISO: Transcrição não fornecida. Tente inferir o conteúdo pelo título e URL se possível.

INSTRUÇÃO:
Faça um resumo abrangente dos principais pontos abordados neste vídeo. Este resumo será usado para responder comentários de usuários. Foque nos argumentos principais, tom de voz e conclusões.
        `.trim();

        try {
          videoSummary = await callPuterAI(summaryPrompt, authToken);
          console.log('[Background] Resumo gerado com sucesso.');
        } catch (err) {
          console.error('[Background] Falha ao gerar resumo:', err);
          videoSummary = "Erro ao gerar resumo do vídeo. Usando apenas título.";
        }
      }

      contextoParaResposta = videoSummary;
    }

    console.log('[Background] Contexto enviado para a resposta:', contextoParaResposta);

    // ---------------------------------------------------------
    // PASSO 2: GERAR A RESPOSTA AO COMENTÁRIO (Segundo Prompt)
    // ---------------------------------------------------------
    console.log('[Background] Passo 2: Gerando resposta final...');

    const globalPrompt = storage['globalPrompt'] || 'Você é um assistente útil. Responda ao comentário.';

    // Define prefixo do contexto baseado na origem
    const prefixoContexto = safeTranscript
      ? "O texto abaixo é a transcrição literal do vídeo:"
      : "Baseado no Resumo da IA:";

    const finalPrompt = `
INSTRUÇÕES DO CANAL (Siga estritamente):
${globalPrompt}

CONTEXTO DO CONTEÚDO (${prefixoContexto})
${contextoParaResposta}

DADOS DO VÍDEO:
Título: "${videoTitle}"
Link: ${videoUrl}

COMENTÁRIO DO USUÁRIO:
"${ctx.commentText}"

DIRETRIZ TÉCNICA DE FORMATO:
- Responda diretamente ao usuário.
- Seja cordial e relevante ao contexto acima.
- Retorne APENAS o texto da resposta, sem aspas ou prefixos.
    `.trim();

    const responseText = await callPuterAI(finalPrompt, authToken);

    if (!responseText) {
      return { success: false, error: "Resposta vazia da IA." };
    }

    return { success: true, text: responseText };

  } catch (err: any) {
    console.error("[Background Error]", err);
    const msg = err.message || String(err);
    if (msg.includes('401')) {
      return { success: false, error: "Sessão expirada. Faça login novamente." };
    }
    return { success: false, error: msg };
  }
}
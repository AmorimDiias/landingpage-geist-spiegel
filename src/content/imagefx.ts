type DownloadMode = 'all' | 'first' | 'none';

interface ProcessingState {
  isRunning: boolean;
  currentIndex: number;
  totalPrompts: number;
  currentPrompt: string;
  status: 'idle' | 'processing' | 'completed' | 'error' | 'paused';
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const extractFileNameParts = (fullPrompt: string, index: number) => {
  // Captura o número no primeiro colchete e a frase no segundo colchete
  const match = fullPrompt.match(/^\[(\d+)\]\s*\[([^\]]+)\]/);

  const numberPart = match ? match[1].padStart(2, '0') : String(index).padStart(2, '0');
  let phrasePart = match ? match[2].trim() : '';

  if (!phrasePart) {
    // Fallback: pega o prompt limpo e extrai as primeiras 6 palavras preservando acentos
    const clean = extractPromptValue(fullPrompt);
    phrasePart = clean.split(/\s+/).slice(0, 6).join(' ');
  }

  // Sanitização estrita: remove apenas o que REALMENTE é proibido em nomes de arquivos (Windows/Unix)
  // Preserva espaços, acentos, apóstrofos, etc.
  const safePhrase = phrasePart.replace(/[\\/:*?"<>|]/g, '').trim();

  return {
    number: numberPart,
    phrase: safePhrase
  };
};

const extractPromptValue = (fullPrompt: string): string => {
  let clean = fullPrompt.trim();

  // Remove blocos de metadados no início: [00], [Frase], [Tempo]
  // Usamos um loop para garantir que removemos os 3 blocos se existirem
  for (let i = 0; i < 3; i++) {
    clean = clean.replace(/^\[[^\]]*\]\s*/, '');
  }

  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }

  return clean.trim();
};

const checkShouldStop = async (): Promise<boolean> => {
  return new Promise((resolve) => {
    chrome.storage.local.get('imagefxShouldStop', (result) => {
      resolve(result.imagefxShouldStop === true);
    });
  });
};

const updateProcessingState = async (state: Partial<ProcessingState>) => {
  return new Promise<void>((resolve) => {
    chrome.storage.local.get('imagefxProcessingState', (result) => {
      const currentState = result.imagefxProcessingState || {};
      const newState = { ...currentState, ...state };
      chrome.storage.local.set({ imagefxProcessingState: newState }, () => resolve());
    });
  });
};

const waitForElement = async (
  checkFn: () => Element | null,
  timeout = 30000,
  interval = 500
): Promise<Element | null> => {
  const maxTries = Math.ceil(timeout / interval);
  for (let i = 0; i < maxTries; i++) {
    const result = checkFn();
    if (result) return result;
    await delay(interval);
  }
  return null;
};

const simulateInput = (element: HTMLElement, text: string) => {
  element.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);

  element.dispatchEvent(
    new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: text,
      bubbles: true,
      cancelable: true
    })
  );
  document.execCommand('insertText', false, text);
};

// --- FUNÇÃO DE VALIDAÇÃO DE QUALIDADE ---
const checkImageHasWhiteBars = async (blob: Blob): Promise<boolean> => {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0);

    const isWhite = (r: number, g: number, b: number) => r > 240 && g > 240 && b > 240;
    const checkPoints = [0.2, 0.5, 0.8];

    let leftSideWhiteCount = 0;
    let rightSideWhiteCount = 0;

    for (const pct of checkPoints) {
      const y = Math.floor(bitmap.height * pct);

      const pLeft = ctx.getImageData(0, y, 1, 1).data;
      if (isWhite(pLeft[0], pLeft[1], pLeft[2])) leftSideWhiteCount++;

      const pRight = ctx.getImageData(bitmap.width - 1, y, 1, 1).data;
      if (isWhite(pRight[0], pRight[1], pRight[2])) rightSideWhiteCount++;
    }

    if (leftSideWhiteCount === 3 || rightSideWhiteCount === 3) {
      return true;
    }

    return false;
  } catch (e) {
    console.warn('[ImageFX] Erro ao validar pixels:', e);
    return false;
  }
};

const downloadImages = async (originalPrompt: string, downloadMode: DownloadMode, index: number) => {
  console.log('[ImageFX] Procurando imagens para download…');

  // Tipagem explícita para evitar erros
  let allImages: HTMLImageElement[] = [];

  const rawImages = Array.from(document.querySelectorAll('img'));
  allImages = rawImages.filter((img) => {
    const el = img as HTMLImageElement;
    return el.clientWidth > 100 && el.clientHeight > 100 && !el.src.includes('placeholder');
  }) as HTMLImageElement[];

  const swiperRaw = Array.from(document.querySelectorAll('.swiper-slide img'));
  const swiperImages = swiperRaw.filter((img) => {
    const el = img as HTMLImageElement;
    return el.clientWidth > 100 && el.clientHeight > 100 && !el.src.includes('placeholder');
  }) as HTMLImageElement[];

  if (swiperImages.length > 0) {
    allImages = swiperImages;
  }

  if (!allImages || allImages.length === 0) {
    console.error('[ImageFX] Nenhuma imagem válida encontrada.');
    return;
  }

  const { number, phrase } = extractFileNameParts(originalPrompt, index);
  console.log(`[ImageFX] Index: ${index}, Usando prefixo: ${number}, Frase: ${phrase}`);

  if (downloadMode === 'first') {
    console.log(`[ImageFX] Modo 'Unico': Analisando qualidade de ${allImages.length} imagens...`);

    let downloadSuccess = false;

    for (let i = 0; i < allImages.length; i++) {
      const img = allImages[i]; // Já é HTMLImageElement
      const imgSrc = img.src;
      console.log(`[ImageFX] Analisando candidato ${i + 1}...`);

      try {
        const response = await fetch(imgSrc);
        const blob = await response.blob();

        const hasBars = await checkImageHasWhiteBars(blob);

        if (hasBars) {
          console.warn(`[ImageFX] Candidato ${i + 1} REJEITADO (Barras brancas detetadas).`);
          continue;
        }

        console.log(`[ImageFX] Candidato ${i + 1} APROVADO. Baixando...`);
        const fileName = `${number} - ${phrase}.jpg`;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        downloadSuccess = true;
        break;

      } catch (e) {
        console.error(`[ImageFX] Erro ao processar candidato ${i + 1}:`, e);
      }
    }

    if (!downloadSuccess) {
      console.warn('[ImageFX] Fallback: Baixando a primeira imagem.');
      if (allImages.length > 0) {
        const link = document.createElement('a');
        link.href = allImages[0].src;
        link.download = `${number} - ${phrase}.jpg`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }

  } else if (downloadMode === 'all') {
    console.log(`[ImageFX] Baixando todas as ${allImages.length} imagens.`);

    for (let i = 0; i < allImages.length; i++) {
      const img = allImages[i];
      const suffix = allImages.length > 1 ? ` (${i + 1})` : '';
      const fileName = `${number} - ${phrase}${suffix}.jpg`;

      const a = document.createElement('a');
      a.href = img.src;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      await delay(300);
    }
  }
};

const resetEditor = async () => {
  const restartBtn = Array.from(document.querySelectorAll('button')).find((btn) => {
    const span = btn.querySelector('span');
    return span?.textContent?.trim().toLowerCase() === 'recomeçar';
  });
  if (restartBtn) {
    restartBtn.click();
    await delay(300);
  }
};

type GenerationResult = 'success' | 'retry' | 'skip' | 'fatal_error';

const checkForDailyLimitError = (): boolean => {
  const pageText = document.body.innerText.toLowerCase();
  return (
    pageText.includes('limite diário') ||
    pageText.includes('daily limit') ||
    pageText.includes('atingiu seu limite') ||
    pageText.includes('hit your daily limit')
  );
};

const waitForGenerationWithRetry = async (
  checkImageFn: () => Element | null,
  timeout = 40000
): Promise<'success' | 'timeout' | 'limit_bug'> => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (checkImageFn()) return 'success';
    if (checkForDailyLimitError()) return 'limit_bug';
    await delay(1000);
  }
  return 'timeout';
};

const runPrompt = async (
  originalPrompt: string,
  promptIndex: number,
  downloadMode: DownloadMode
): Promise<GenerationResult> => {
  const editor = document.querySelector('[data-slate-editor="true"]') as HTMLElement;
  if (!editor) {
    console.error('[ImageFX] Editor não encontrado');
    return 'retry';
  }

  const promptToInsert = extractPromptValue(originalPrompt);
  simulateInput(editor, promptToInsert);
  await delay(800);

  const label = await waitForElement(() => {
    return Array.from(document.querySelectorAll('button div')).find(
      (el) => el.textContent?.trim().toLowerCase() === 'criar' || el.textContent?.trim().toLowerCase() === 'create'
    ) as Element | undefined ?? null;
  }, 20000);

  if (!label) {
    console.error('[ImageFX] Botão "Criar" não encontrado');
    return 'retry';
  }

  const button = (label as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!button) {
    console.error('[ImageFX] Botão pai do "Criar" não encontrado');
    return 'retry';
  }

  button.click();
  console.log(`[ImageFX] Solicitando geração...`);
  await delay(2000);

  const result = await waitForGenerationWithRetry(() => {
    return (
      document.querySelector('.swiper-slide-active img') ||
      document.querySelector("img[alt*='Uma imagem gerada']") ||
      document.querySelector("img[alt*='An image generated']")
    );
  }, 45000);

  if (result === 'limit_bug') {
    return 'retry';
  }

  if (result === 'timeout') {
    return 'retry';
  }

  await delay(1000);

  if (downloadMode !== 'none') {
    await downloadImages(originalPrompt, downloadMode, promptIndex);
    await delay(500);
  } else {
    console.log(`[ImageFX] Gerado (sem download): ${originalPrompt}`);
  }

  await delay(1000);
  return 'success';
};

const runSequence = async (prompts: string[], downloadMode: DownloadMode) => {
  console.log('[ImageFX] Iniciando sequência robusta...');
  console.log('[ImageFX] Preparando editor...');
  await resetEditor();

  for (let i = 0; i < prompts.length; i++) {
    if (await checkShouldStop()) {
      await updateProcessingState({ status: 'paused', isRunning: false });
      return;
    }

    const prompt = prompts[i];
    await updateProcessingState({
      currentIndex: i,
      currentPrompt: prompt,
      status: 'processing'
    });

    let attempts = 0;
    const maxAttempts = 4;
    let success = false;

    while (attempts < maxAttempts && !success) {
      attempts++;
      if (attempts > 1) {
        await resetEditor();
        await delay(1000);
      }

      const result = await runPrompt(prompt, i, downloadMode);

      if (result === 'success') {
        success = true;
      } else if (result === 'fatal_error') {
        alert('Automação parada: Limite diário atingido ou erro fatal.');
        await updateProcessingState({ status: 'error', isRunning: false, currentPrompt: 'Erro: Limite Diário' });
        return;
      } else if (result === 'retry') {
        await delay(2000);
      } else if (result === 'skip') {
        break;
      }
    }

    if (!success) {
      console.warn(`[ImageFX] Falha definitiva no prompt ${i + 1}.`);
    }

    if (i < prompts.length - 1) {
      await resetEditor();
      await delay(1000);
    }
  }

  await updateProcessingState({
    currentIndex: prompts.length,
    status: 'completed',
    isRunning: false
  });

  alert('✅ Automação Finalizada!\nTodas as imagens foram processadas e baixadas com sucesso.');

  chrome.runtime.sendMessage({
    type: 'SHOW_NOTIFICATION',
    title: 'ImageFX Automator',
    message: 'Todas as imagens foram processadas e baixadas com sucesso!'
  }).catch(() => { });
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'generateImages' && Array.isArray(msg.prompts)) {
    runSequence(msg.prompts, msg.downloadMode || 'first');
    sendResponse({ success: true });
  }
  return true;
});

console.log('[ImageFX Automator] Content script carregado');

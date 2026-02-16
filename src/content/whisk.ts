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
  const match = fullPrompt.match(/^\[(\d+)\]\s*\[([^\]]+)\]/);

  const numberPart = match ? match[1].padStart(2, '0') : String(index).padStart(2, '0');
  let phrasePart = match ? match[2].trim() : '';

  if (!phrasePart) {
    const clean = extractPromptValue(fullPrompt);
    phrasePart = clean.split(/\s+/).slice(0, 6).join(' ');
  }

  const safePhrase = phrasePart.replace(/[\\/:*?"<>|]/g, '').trim();

  return {
    number: numberPart,
    phrase: safePhrase
  };
};

const extractPromptValue = (fullPrompt: string): string => {
  let clean = fullPrompt.trim();

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
    chrome.storage.local.get('whiskShouldStop', (result) => {
      resolve(result.whiskShouldStop === true);
    });
  });
};

const updateProcessingState = async (state: Partial<ProcessingState>) => {
  return new Promise<void>((resolve) => {
    chrome.storage.local.get('whiskProcessingState', (result) => {
      const currentState = result.whiskProcessingState || {};
      const newState = { ...currentState, ...state };
      chrome.storage.local.set({ whiskProcessingState: newState }, () => resolve());
    });
  });
};

const findWhiskTextarea = (): HTMLTextAreaElement | null => {
  const textarea = document.querySelector('textarea[placeholder*="Descreva"]') as HTMLTextAreaElement;
  if (textarea) return textarea;

  const fallback = document.querySelector('textarea[placeholder*="Describe"]') as HTMLTextAreaElement;
  if (fallback) return fallback;

  const allTextareas = Array.from(document.querySelectorAll('textarea'));
  return allTextareas.find(ta => ta.clientWidth > 100) as HTMLTextAreaElement || null;
};

const setNativeTextareaValue = (textarea: HTMLTextAreaElement, text: string) => {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(textarea, text);
  } else {
    textarea.value = text;
  }

  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
};

const findSubmitButton = (): HTMLButtonElement | null => {
  const ariaBtn = document.querySelector('button[aria-label*="Enviar"]') as HTMLButtonElement;
  if (ariaBtn) return ariaBtn;

  const ariaEnBtn = document.querySelector('button[aria-label*="Send"]') as HTMLButtonElement;
  if (ariaEnBtn) return ariaEnBtn;

  const allButtons = Array.from(document.querySelectorAll('button[type="submit"]'));
  if (allButtons.length > 0) return allButtons[allButtons.length - 1] as HTMLButtonElement;

  const iconBtns = Array.from(document.querySelectorAll('button'));
  const submitCandidate = iconBtns.find(btn => {
    const icon = btn.querySelector('i');
    return icon?.textContent?.trim() === 'arrow_forward';
  });
  return (submitCandidate as HTMLButtonElement) || null;
};

const getGeneratedImages = (includeProcessed = false): HTMLImageElement[] => {
  return Array.from(document.querySelectorAll('img')).filter((img) => {
    if (!includeProcessed && img.hasAttribute('data-whisk-processed')) return false;

    return img.clientWidth > 100 && img.clientHeight > 100
      && !img.src.includes('placeholder')
      && !img.src.includes('googleusercontent.com/a/')
      && !img.src.includes('lh3.googleusercontent.com/a/')
      && !img.alt?.includes('perfil');
  });
};

const isImageFullyLoaded = (img: HTMLImageElement): boolean => {
  return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
};

const waitForAllImagesLoaded = async (images: HTMLImageElement[], timeout = 15000): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const allLoaded = images.every(isImageFullyLoaded);
    if (allLoaded) return true;
    await delay(100);
  }
  return false;
};

const validateImage = async (blob: Blob): Promise<boolean> => {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');

    if (!ctx) return true;
    ctx.drawImage(bitmap, 0, 0);

    const { width, height } = canvas;
    const checkPoints = [0.1, 0.5, 0.9];

    let leftBars = 0;
    let rightBars = 0;
    let topBars = 0;
    let bottomBars = 0;

    const isSolid = (r: number, g: number, b: number) => {
      // Black (tolerância para compressão/ruído) - Aumentada levemente
      if (r < 25 && g < 25 && b < 25) return true;
      // White
      if (r > 230 && g > 230 && b > 230) return true;
      return false;
    };

    // Verificar laterais (Vertical Bars - Pillarbox)
    for (const pct of checkPoints) {
      const y = Math.floor(height * pct);
      const pL = ctx.getImageData(0, y, 1, 1).data;
      if (isSolid(pL[0], pL[1], pL[2])) leftBars++;

      const pR = ctx.getImageData(width - 1, y, 1, 1).data;
      if (isSolid(pR[0], pR[1], pR[2])) rightBars++;
    }

    // Verificar topo/base (Horizontal Bars - Letterbox)
    for (const pct of checkPoints) {
      const x = Math.floor(width * pct);
      const pT = ctx.getImageData(x, 0, 1, 1).data;
      if (isSolid(pT[0], pT[1], pT[2])) topBars++;

      const pB = ctx.getImageData(x, height - 1, 1, 1).data;
      if (isSolid(pB[0], pB[1], pB[2])) bottomBars++;
    }

    // Rejeitar apenas se houver barras SIMÉTRICAS (Evita falsos positivos em céu noturno ou neve)
    if (topBars === 3 && bottomBars === 3) {
      console.warn('[Whisk] Imagem rejeitada: Letterbox (Barras Horizontais)');
      return false;
    }

    if (leftBars === 3 && rightBars === 3) {
      console.warn('[Whisk] Imagem rejeitada: Pillarbox (Barras Verticais)');
      return false;
    }

    return true;
  } catch (e) {
    console.warn('[Whisk] Erro na validação de qualidade:', e);
    return true; // Fail open para não travar em erros técnicos
  }
};

const downloadImages = async (originalPrompt: string, downloadMode: DownloadMode, index: number, generatedImages: HTMLImageElement[]): Promise<boolean> => {
  console.log(`[Whisk] Validando ${generatedImages.length} imagens para download.`);

  if (generatedImages.length === 0) {
    console.error('[Whisk] Nenhuma imagem válida encontrada.');
    return false;
  }

  const { number, phrase } = extractFileNameParts(originalPrompt, index);
  let validImageFound = false;

  const performDownload = (url: string, suffix: string = '') => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${number} - ${phrase}${suffix}.jpg`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (downloadMode === 'first') {
    console.log(`[Whisk] Modo 'Unico': Buscando melhor candidato...`);

    // Prioriza a última imagem gerada (geralmente a mais relevante na lista do DOM)
    for (let i = generatedImages.length - 1; i >= 0; i--) {
      try {
        const img = generatedImages[i];
        console.log(`[Whisk] Analisando candidato ${generatedImages.length - i}...`);

        const response = await fetch(img.src);
        const blob = await response.blob();

        const isValid = await validateImage(blob);

        if (!isValid) {
          console.warn(`[Whisk] Candidato ${generatedImages.length - i} REJEITADO (Barras detectadas).`);
          continue;
        }

        console.log(`[Whisk] Candidato ${generatedImages.length - i} APROVADO.`);
        const url = window.URL.createObjectURL(blob);
        performDownload(url);
        window.URL.revokeObjectURL(url);

        validImageFound = true;
        break;
      } catch (e) {
        console.error(`[Whisk] Erro ao processar candidato ${generatedImages.length - i}:`, e);
      }
    }
  } else if (downloadMode === 'all') {
    console.log(`[Whisk] Baixando todas as imagens válidas.`);

    for (let i = 0; i < generatedImages.length; i++) {
      try {
        const img = generatedImages[i];
        const response = await fetch(img.src);
        const blob = await response.blob();

        if (await validateImage(blob)) {
          const url = window.URL.createObjectURL(blob);
          const suffix = generatedImages.length > 1 ? ` (${i + 1})` : '';
          performDownload(url, suffix);
          window.URL.revokeObjectURL(url);
          validImageFound = true;
          await delay(300);
        } else {
          console.warn(`[Whisk] Imagem ${i + 1} ignorada (Barras detectadas).`);
        }
      } catch (e) { console.error(e); }
    }
  }

  return validImageFound;
};

type GenerationResult = 'success' | 'retry' | 'skip' | 'fatal_error';

const waitForGeneration = async (timeout = 120000): Promise<{ status: 'success' | 'timeout'; newImages: HTMLImageElement[] }> => {
  const EXPECTED_COUNT = 2;

  console.log(`[Whisk] Aguardando geração de exatamente ${EXPECTED_COUNT} novas imagens...`);

  return new Promise((resolve) => {
    let resolved = false;

    const checkCondition = async () => {
      if (resolved) return;

      const newImages = getGeneratedImages(false); // Ignora as marcadas como processadas

      // Filtro de segurança simplificado (já confiamos na marcação de processados)
      const validImages = newImages;

      if (validImages.length >= EXPECTED_COUNT) {
        console.log(`[Whisk] ${validImages.length} novas imagens detectadas. Verificando carregamento...`);

        // Aguarda carregamento total
        const allLoaded = await waitForAllImagesLoaded(validImages);

        if (allLoaded && !resolved) {
          // Verificação final
          resolved = true;
          observer.disconnect();

          // Delay removido para agilidade imediata
          resolve({ status: 'success', newImages: validImages });
        }
      }
    };

    const observer = new MutationObserver((mutations) => {
      // Otimização: Só verifique se houver nós adicionados ou atributos (src) alterados
      const relevantMutation = mutations.some(m =>
        m.type === 'childList' && m.addedNodes.length > 0 ||
        m.type === 'attributes' && m.attributeName === 'src'
      );

      if (relevantMutation) {
        checkCondition();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'class']
    });

    // Fallback de polling (caso o MutationObserver falhe em capturar algo específico)
    const poller = setInterval(() => {
      if (!resolved) checkCondition();
      else clearInterval(poller);
    }, 2000);

    // Timeout Global
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        clearInterval(poller);
        const finalImages = getGeneratedImages(false);
        console.warn(`[Whisk] Timeout! Encontradas: ${finalImages.length}`);
        resolve({ status: 'timeout', newImages: finalImages });
      }
    }, timeout);
  });
};

const runPrompt = async (
  originalPrompt: string,
  promptIndex: number,
  downloadMode: DownloadMode
): Promise<GenerationResult> => {
  const textarea = findWhiskTextarea();
  if (!textarea) {
    console.error('[Whisk] Textarea não encontrada');
    return 'retry';
  }

  // 1. Marcar imagens existentes como processadas para não confundir
  const existingImages = getGeneratedImages(true);
  existingImages.forEach(img => img.setAttribute('data-whisk-processed', 'true'));
  console.log(`[Whisk] Marcação: ${existingImages.length} imagens antigas marcadas como processadas.`);

  const promptToInsert = extractPromptValue(originalPrompt);
  console.log(`[Whisk] Inserindo prompt: "${promptToInsert}"`);

  textarea.focus();
  setNativeTextareaValue(textarea, promptToInsert);
  await delay(500);

  const submitBtn = findSubmitButton();
  if (!submitBtn) {
    console.error('[Whisk] Botão de envio não encontrado');
    return 'retry';
  }

  if (submitBtn.disabled) {
    console.log('[Whisk] Botão desabilitado, aguardando…');
    await delay(1000);

    if (submitBtn.disabled) {
      console.error('[Whisk] Botão ainda desabilitado');
      return 'retry';
    }
  }

  submitBtn.click();
  console.log(`[Whisk] Solicitando geração...`);

  // Como clicamos, esperamos que o input limpe ou o botão desabilite.
  await delay(1000);

  // 2. Aguarda estritamente 2 novas imagens
  const { status, newImages } = await waitForGeneration(120000); // 2 minutos tolerancia

  if (status === 'timeout' && newImages.length < 2) {
    console.warn('[Whisk] Timeout na geração (Imagens insuficientes)');
    return 'retry';
  }

  if (downloadMode !== 'none') {
    const success = await downloadImages(originalPrompt, downloadMode, promptIndex, newImages);
    if (!success) {
      console.warn('[Whisk] Todas as imagens falharam na validação (Barras detectadas). Retentando prompt...');
      return 'retry';
    }
  } else {
    console.log(`[Whisk] Gerado (sem download): ${originalPrompt}`);
  }

  return 'success';
};

const runSequence = async (prompts: string[], downloadMode: DownloadMode) => {
  console.log('[Whisk] Iniciando sequência…');

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
        await delay(2000);
      }

      const result = await runPrompt(prompt, i, downloadMode);

      if (result === 'success') {
        success = true;
      } else if (result === 'fatal_error') {
        alert('Automação parada: Erro fatal.');
        await updateProcessingState({ status: 'error', isRunning: false, currentPrompt: 'Erro Fatal' });
        return;
      } else if (result === 'retry') {
        await delay(2000);
      } else if (result === 'skip') {
        break;
      }
    }

    if (!success) {
      console.warn(`[Whisk] Falha definitiva no prompt ${i + 1}.`);
    }

    if (i < prompts.length - 1) {
      await delay(1500);
    }
  }

  await updateProcessingState({
    currentIndex: prompts.length,
    status: 'completed',
    isRunning: false
  });

  alert('✅ Automação Whisk Finalizada!\nTodas as imagens foram processadas.');

  chrome.runtime.sendMessage({
    type: 'SHOW_NOTIFICATION',
    title: 'Whisk Automator',
    message: 'Todas as imagens foram processadas com sucesso!'
  }).catch(() => { });
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'generateWhiskImages' && Array.isArray(msg.prompts)) {
    runSequence(msg.prompts, msg.downloadMode || 'first');
    sendResponse({ success: true });
  }
  return true;
});

console.log('[Whisk Automator] Content script carregado');

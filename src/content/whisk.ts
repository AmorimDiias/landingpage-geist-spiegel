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

const getGeneratedImages = (): HTMLImageElement[] => {
  return Array.from(document.querySelectorAll('img')).filter((img) => {
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
    await delay(300);
  }
  return false;
};

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

    return leftSideWhiteCount === 3 || rightSideWhiteCount === 3;
  } catch (e) {
    console.warn('[Whisk] Erro ao validar pixels:', e);
    return false;
  }
};

const downloadImages = async (originalPrompt: string, downloadMode: DownloadMode, index: number, generatedImages: HTMLImageElement[]) => {
  console.log(`[Whisk] ${generatedImages.length} imagens prontas para download.`);

  if (generatedImages.length === 0) {
    console.error('[Whisk] Nenhuma imagem válida encontrada.');
    return;
  }

  const { number, phrase } = extractFileNameParts(originalPrompt, index);

  if (downloadMode === 'first') {
    console.log(`[Whisk] Modo 'Unico': Analisando qualidade de ${generatedImages.length} imagens...`);

    let downloadSuccess = false;

    for (let i = generatedImages.length - 1; i >= 0; i--) {
      const img = generatedImages[i];
      console.log(`[Whisk] Analisando candidato ${generatedImages.length - i}...`);

      try {
        const response = await fetch(img.src);
        const blob = await response.blob();
        const hasBars = await checkImageHasWhiteBars(blob);

        if (hasBars) {
          console.warn(`[Whisk] Candidato ${generatedImages.length - i} REJEITADO (Barras brancas).`);
          continue;
        }

        console.log(`[Whisk] Candidato ${generatedImages.length - i} APROVADO. Baixando...`);
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
        console.error(`[Whisk] Erro ao processar candidato ${generatedImages.length - i}:`, e);
      }
    }

    if (!downloadSuccess && generatedImages.length > 0) {
      console.warn('[Whisk] Fallback: Baixando a última imagem.');
      const lastImg = generatedImages[generatedImages.length - 1];
      const a = document.createElement('a');
      a.href = lastImg.src;
      a.download = `${number} - ${phrase}.jpg`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

  } else if (downloadMode === 'all') {
    console.log(`[Whisk] Baixando todas as ${generatedImages.length} imagens.`);

    for (let i = 0; i < generatedImages.length; i++) {
      const img = generatedImages[i];
      const suffix = generatedImages.length > 1 ? ` (${i + 1})` : '';
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

type GenerationResult = 'success' | 'retry' | 'skip' | 'fatal_error';

const waitForGeneration = async (initialImages: HTMLImageElement[], timeout = 90000): Promise<{ status: 'success' | 'timeout'; newImages: HTMLImageElement[] }> => {
  const start = Date.now();
  const initialSrcs = new Set(initialImages.map(img => img.src));

  console.log(`[Whisk] Aguardando geração... (${initialImages.length} imagens pré-existentes)`);

  while (Date.now() - start < timeout) {
    const currentImages = getGeneratedImages();
    const newImages = currentImages.filter(img => !initialSrcs.has(img.src));

    if (newImages.length > 0) {
      console.log(`[Whisk] ${newImages.length} nova(s) imagem(ns) detectada(s). Aguardando carregamento completo...`);

      const loaded = await waitForAllImagesLoaded(newImages);
      if (loaded) {
        console.log(`[Whisk] Todas as ${newImages.length} imagens carregadas.`);

        await delay(500);
        const finalImages = getGeneratedImages();
        const finalNew = finalImages.filter(img => !initialSrcs.has(img.src));

        if (finalNew.length > newImages.length) {
          console.log(`[Whisk] Mais imagens aparecendo (${finalNew.length}), aguardando…`);
          await waitForAllImagesLoaded(finalNew);
        }

        const readyImages = getGeneratedImages().filter(img => !initialSrcs.has(img.src));
        return { status: 'success', newImages: readyImages };
      }
    }

    await delay(500);
  }

  return { status: 'timeout', newImages: [] };
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

  const preClickImages = getGeneratedImages();

  submitBtn.click();
  console.log(`[Whisk] Solicitando geração...`);
  await delay(500);

  const { status, newImages } = await waitForGeneration(preClickImages, 90000);

  if (status === 'timeout') {
    console.warn('[Whisk] Timeout na geração');
    return 'retry';
  }

  if (downloadMode !== 'none') {
    await downloadImages(originalPrompt, downloadMode, promptIndex, newImages);
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


interface GrokFile {
  name: string;
  type: string;
  dataUrl: string;
}

interface AutomationRequest {
  action: string;
  files: GrokFile[];
  upscale: boolean;
}

interface GrokState {
  isRunning?: boolean;
  currentIndex?: number;
  totalFiles?: number;
  currentFile?: string;
  status?: 'idle' | 'processing' | 'completed' | 'error' | 'paused';
}

(function () {
  let isRunning = false;
  let shouldStop = false;
  let isPageVisible = true;
  let lastInteractionTime = Date.now();

  // Monitor user activity to detect when user is actively using the computer
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(event => {
    document.addEventListener(event, () => {
      lastInteractionTime = Date.now();
    }, { passive: true });
  });

  // Handle page visibility changes to maintain automation even when not focused
  document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    if (isPageVisible) {
      log('Página visível novamente - retomando automação...');
    } else {
      log('Página não visível - automação continuará em segundo plano...');
    }
  });

  // Handle focus/blur events to maintain automation
  window.addEventListener('focus', () => {
    log('Janela em foco - retomando automação...');
  });

  window.addEventListener('blur', () => {
    log('Janela fora de foco - automação continuará em segundo plano...');
  });

  const log = (msg: string) => {
    console.log(`[GrokAutomator] ${msg}`);
  };

  // Robust sleep implementation that avoids browser throttling
  const robustSleep = (ms: number) => {
    return new Promise(resolve => {
      const start = Date.now();
      const poll = () => {
        if (shouldStop) {
          resolve(undefined);
          return;
        }
        if (Date.now() - start >= ms) {
          resolve(undefined);
          return;
        }
        // Use a minimal timeout to avoid complete suspension by the browser
        // This is more reliable than setTimeout for longer periods when tab is hidden
        setTimeout(poll, 50);
      };
      poll();
    });
  };

  // Function to check if user has been active recently (within last 30 seconds)
  const isUserActiveRecently = () => {
    return (Date.now() - lastInteractionTime) < 30000; // 30 seconds
  };

  const dataURLtoFile = (dataurl: string, filename: string): File => {
    const arr = dataurl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  const waitForElement = async (selector: string, timeout = 30000, optional = false): Promise<Element | null> => {
    const start = Date.now();
    let lastFoundElement: Element | null = null;

    while (Date.now() - start < timeout) {
      if (shouldStop) return null;

      try {
        const el = document.querySelector(selector);
        if (el) {
          lastFoundElement = el;

          // Verify the element is still connected to the DOM
          if (el.isConnected) {
            return el;
          }
        }
      } catch (error) {
        log(`Erro ao procurar elemento ${selector}: ${error}`);
        // Continue trying even if there's an error
      }

      // Use robust sleep to avoid browser throttling
      await robustSleep(500);
    }
    if (!optional) {
      log(`Timeout aguardando elemento: ${selector}`);
    }
    return lastFoundElement; // Return the last found element even if disconnected
  };

  const updateState = (update: GrokState) => {
    chrome.storage.local.get(['grokState'], (result) => {
      const oldState = result.grokState || {};
      chrome.storage.local.set({
        grokState: { ...oldState, ...update }
      });
    });
  };

  chrome.runtime.onMessage.addListener(async (request: AutomationRequest) => {
    if (request.action === 'startGrokQueue') {
      if (isRunning) return;
      isRunning = true;
      shouldStop = false;

      const { files, upscale } = request;
      log(`Iniciando fila com ${files.length} arquivos. Upscale: ${upscale}`);

      try {
        await processQueue(files, upscale);
      } catch (e) {
        log(`Erro na fila: ${e}`);
        updateState({ status: 'error', isRunning: false });
      } finally {
        isRunning = false;
      }
    }
  });

  // Listen for stop signal from storage
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.grokShouldStop?.newValue === true) {
      shouldStop = true;
      log('Parando automação...');
      chrome.storage.local.set({ grokShouldStop: false }); // Reset flag
    }
  });

  async function processQueue(files: GrokFile[], upscale: boolean) {
    let processedCount = 0;
    let lastVideoSrc: string | null = null;

    for (const fileData of files) {
      if (shouldStop) {
        updateState({ status: 'paused', isRunning: false });
        break;
      }

      const index = processedCount + 1;
      updateState({
        currentIndex: index,
        currentFile: fileData.name,
        status: 'processing'
      });

      log(`Processando ${index}/${files.length}: ${fileData.name}`);

      try {
        const resultSrc = await processSingleImage(fileData, upscale, lastVideoSrc);
        if (resultSrc) {
          lastVideoSrc = resultSrc;
        }
        processedCount++;
      } catch (err) {
        console.error(`Falha ao processar ${fileData.name}:`, err);
        log(`Erro ao processar ${fileData.name}, continuando...`);
        // Continue to next? Maybe retry? For now, continue.
      }

      // Wait a bit before next to ensure system stability
      await robustSleep(3000);
    }

    if (!shouldStop) {
      // Small delay to ensure everything is settled
      await robustSleep(2000);
      updateState({ status: 'completed', isRunning: false, currentIndex: processedCount, currentFile: 'Finalizado' });
    }
  }

  // Robust Generation Checker based on exact HTML analysis
  async function ensureGenerationCycle(actionName: string, ignoreSrc: string | null = null): Promise<HTMLVideoElement> {
    log(`[${actionName}] Iniciando ciclo de detecção... Ignorar Src: ${ignoreSrc ? ignoreSrc.slice(0, 30) + '...' : 'Nenhum'}`);
    const isUpscale = actionName === 'Upscale';
    const videoSelector = isUpscale ? '#hd-video' : '#sd-video';

    // Função helper para detectar estado de loading
    const isLoading = (): boolean => {
      try {
        const hasCanvas = document.querySelector('canvas') !== null;
        const percentElements = document.querySelectorAll('.tabular-nums');
        const hasPercent = Array.from(percentElements).some(el =>
          el.textContent?.includes('%')
        );
        // Se tiver uma barra de progresso conhecida
        const hasProgressBar = document.querySelector('div[class*="bg-[#fff]/90"]') !== null;

        return hasCanvas || hasPercent || hasProgressBar;
      } catch (error) {
        log(`Erro ao verificar loading: ${error}`);
        return false; // Assume not loading if there's an error
      }
    };

    // Função helper para verificar se vídeo está pronto
    const isVideoReady = (): HTMLVideoElement | null => {
      try {
        const video = document.querySelector(videoSelector) as HTMLVideoElement;
        if (!video) return null;

        const src = video.src;

        // Validação Crítica: Se o src for igual ao anterior, ainda é o vídeo velho!
        if (ignoreSrc && src === ignoreSrc) {
          return null;
        }

        const inlineVisibility = video.style.visibility;
        const hasSrc = src && src.includes('.mp4');
        const isVisible = inlineVisibility === 'visible';
        const isBuffered = video.readyState >= 3;
        const hasDuration = video.duration > 0 && !isNaN(video.duration);

        if (hasSrc && isVisible && isBuffered && hasDuration) {
          return video;
        }
        return null;
      } catch (error) {
        log(`Erro ao verificar vídeo pronto: ${error}`);
        return null;
      }
    };

    // Phase 1: Wait for Loading to START (max 20s) - Increased timeout
    let loadingDetected = false;
    const phase1Timeout = Date.now() + 20000;

    log(`[${actionName}] Fase 1: Detectando início do processamento...`);
    while (Date.now() < phase1Timeout) {
      if (shouldStop) throw new Error("Parado pelo usuário");

      if (isLoading()) {
        loadingDetected = true;
        log(`[${actionName}] Processamento iniciado! (Canvas/Porcentagem detectados)`);
        break;
      }

      // Caso especial: vídeo já está pronto (novo vídeo)
      // Só aceitamos se NÃO for o ignoreSrc (verificado dentro de isVideoReady)
      const quickVideo = isVideoReady();
      if (quickVideo) {
        log(`[${actionName}] Vídeo novo detectado imediatamente (Fast Gen)!`);
        return quickVideo;
      }

      // Log periódico para debug
      if (Date.now() % 2000 < 200) {
        try {
          const foundVid = document.querySelector(videoSelector) as HTMLVideoElement;
          if (foundVid && ignoreSrc && foundVid.src === ignoreSrc) {
            log(`[${actionName}] Vídeo anterior ainda presente no DOM... aguardando limpeza/loading.`);
          }
        } catch (error) {
          log(`[${actionName}] Erro ao verificar vídeo anterior: ${error}`);
        }
      }

      await robustSleep(200);
    }

    if (!loadingDetected) {
      log(`[${actionName}] AVISO: Nenhum indicador de loading detectado. Verificando se vídeo novo apareceu...`);
    }

    // Phase 2: Wait for Loading to END (max 5 min)
    if (loadingDetected) {
      log(`[${actionName}] Fase 2: Aguardando conclusão (canvas/% desaparecer)...`);
      const phase2Timeout = Date.now() + 300000;
      let lastLogTime = 0;

      while (Date.now() < phase2Timeout) {
        if (shouldStop) throw new Error("Parado pelo usuário");

        const stillLoading = isLoading();

        if (!stillLoading) {
          // Buffer de segurança para garantir que não é um piscar de tela
          await robustSleep(2000);
          if (!isLoading()) {
            log(`[${actionName}] Loading encerrado.`);
            break;
          }
        }

        if (Date.now() - lastLogTime > 5000) {
          log(`[${actionName}] Ainda processando...`);
          lastLogTime = Date.now();
        }

        // Adjust sleep duration based on user activity
        const sleepDuration = isUserActiveRecently() ? 500 : 1000; // Longer sleep when user is active
        await robustSleep(sleepDuration);
      }
    }

    // Phase 3: Validate Video (max 60s)
    log(`[${actionName}] Fase 3: Validando vídeo final...`);
    const phase3Timeout = Date.now() + 60000;

    while (Date.now() < phase3Timeout) {
      if (shouldStop) throw new Error("Parado pelo usuário");

      const readyVideo = isVideoReady();
      if (readyVideo) {
        log(`[${actionName}] SUCESSO! Vídeo pronto: ${readyVideo.src.substring(0, 40)}...`);
        return readyVideo;
      }

      // Adjust sleep duration based on user activity
      const sleepDuration = isUserActiveRecently() ? 1000 : 2000; // Longer sleep when user is active
      await robustSleep(sleepDuration);
    }

    throw new Error(`[${actionName}] Timeout: Vídeo não detectado após processamento.`);
  }

  async function ensureCleanState() {
    log("Garantindo estado limpo inicial...");

    // 1. Limpeza PROATIVA do DOM (Remover vídeos antigos para evitar falsos positivos)
    const removeElement = (selector: string) => {
      try {
        const el = document.querySelector(selector);
        if (el && el.isConnected) {
          log(`Removendo elemento residual: ${selector}`);
          el.remove();
        }
      } catch (error) {
        log(`Erro ao remover elemento ${selector}: ${error}`);
      }
    };

    removeElement('#sd-video');
    removeElement('#hd-video');

    // 2. Tentar Resets
    const tryReset = async () => {
      try {
        // Estratégia A: Link de Imagine (mais comum)
        const resetLink = document.querySelector('a[href="/imagine"]') as HTMLAnchorElement;
        if (resetLink) {
          log("Clicking Reset Link (Strategy A)...");
          resetLink.click();
          await robustSleep(1000);
        }

        // Estratégia B: Botão de Logo (Grok) - Reseta para home
        const logoLink = document.querySelector('a[aria-label="Grok"], a[href="/"]') as HTMLAnchorElement;
        if (logoLink && !resetLink) { // Use se não achar o imagine
          log("Clicking Logo Link (Strategy B)...");
          logoLink.click();
          await robustSleep(1000);
        }

        // Estratégia C: Procurar botão 'X' ou 'Clear'
        const closeButtons = Array.from(document.querySelectorAll('button'));
        const closeBtn = closeButtons.find(b => b.ariaLabel?.toLowerCase().includes('close') || b.textContent?.includes('Clear'));
        if (closeBtn) {
          log("Clicking Close/Clear Button (Strategy C)...");
          closeBtn.click();
          await robustSleep(1000);
        }
      } catch (error) {
        log(`Erro durante tentativa de reset: ${error}`);
      }
    };

    // Primeira tentativa de reset
    await tryReset();

    // 3. Aguardar estabilização (Input aparecer e Canvas sumir)
    const checkTimeout = Date.now() + 15000; // Increased to 15s
    while (Date.now() < checkTimeout) {
      if (shouldStop) throw new Error("Parado pelo usuário");

      try {
        const inputEl = document.querySelector('input[name="files"]');
        const loadingEl = document.querySelector('canvas') || document.querySelector('.tabular-nums');
        const lingeringVideo = document.querySelector('#sd-video') || document.querySelector('#hd-video');

        if (lingeringVideo) {
          lingeringVideo.remove();
        }

        if (inputEl && !loadingEl) {
          // Validação extra: O input está visível?
          return; // Limpo e pronto!
        }
      } catch (error) {
        log(`Erro ao verificar estado limpo: ${error}`);
        // Continue trying even if there's an error
      }

      // Retry Reset if we are stuck halfway
      if (Date.now() % 3000 < 500) {
        log("Estado ainda sujo... tentando reset novamente.");
        await tryReset();
      }

      await robustSleep(500);
    }

    // Se falhou, loga o estado atual para debug
    try {
      log(`Falha clean state. Input? ${!!document.querySelector('input[name="files"]')}, Loading? ${!!document.querySelector('canvas')}`);
    } catch (error) {
      log(`Erro ao verificar estado final: ${error}`);
    }
    throw new Error("Timeout aguardando estado limpo (Input não apareceu ou Loading travado)");
  }

  async function processSingleImage(fileData: GrokFile, upscale: boolean, previousVideoSrc: string | null): Promise<string> {
    // 0. Ensure clean state before starting
    try {
      await ensureCleanState();
    } catch (error) {
      log(`Erro ao garantir estado limpo: ${error}. Tentando continuar mesmo assim...`);
      // Continue anyway, as sometimes the page might already be in a usable state
    }

    // 1. Locate Input
    const fileInput = await waitForElement('input[name="files"]', 15000) as HTMLInputElement;
    if (!fileInput) throw new Error("Input de arquivo não encontrado");

    fileInput.value = '';

    // 2. Set File
    log(`Inserindo arquivo: ${fileData.name}`);
    const file = dataURLtoFile(fileData.dataUrl, fileData.name);
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));

    await robustSleep(2000);

    // 3. Validate Upload & Click Generate
    // Wait for file preview to appear to confirm upload success
    // Usually a div with class containing 'border' or specific preview elements appears.
    // We'll trust the button enablement for now, but increase timeout.

    log("Tentando clicar em 'Fazer vídeo'...");
    // Increased timeout to 15s because sometimes image processing takes time before button is ready
    const generateBtn = await waitForElement('button[aria-label="Fazer vídeo"]', 15000) as HTMLButtonElement;

    if (!generateBtn || generateBtn.disabled) {
      log("Botão ainda não disponível... aguardando mais...");
      await robustSleep(3000);
    }

    // Try finding the button again if first check failed or was disabled
    const retryBtn = document.querySelector('button[aria-label="Fazer vídeo"]') as HTMLButtonElement;

    if (retryBtn && !retryBtn.disabled) {
      retryBtn.click();
    } else {
      // Analyze page state
      const bodyText = document.body.innerText;
      const possibleError = bodyText.includes("Error") || bodyText.includes("Falha");
      throw new Error(`Botão 'Fazer vídeo' não disponível. Disabled? ${retryBtn?.disabled}. Erro na tela? ${possibleError}`);
    }

    // 4. Wait for Normal Generation
    await robustSleep(3000);

    // Passamos o previousVideoSrc para garantir que não pegamos o vídeo anterior
    let normalVideo: HTMLVideoElement;
    try {
      normalVideo = await ensureGenerationCycle("Normal", previousVideoSrc);
    } catch (error) {
      log(`Erro na geração normal: ${error}. Tentando novamente...`);
      // Retry once more in case of temporary focus loss
      await robustSleep(5000);
      normalVideo = await ensureGenerationCycle("Normal", previousVideoSrc);
    }

    let finalVideoSrc = normalVideo.src;
    let finalFilename = fileData.name.replace(/\.[^/.]+$/, "");

    // 5. Upscale Flow (if enabled)
    if (upscale) {
      log("Iniciando fluxo de Upscale...");

      const menuBtn = await waitForElement('button[aria-label="Mais opções"]', 30000) as HTMLButtonElement;
      if (!menuBtn) throw new Error("Botão menu não encontrado");

      await robustSleep(2000);
      menuBtn.click();

      await robustSleep(1000);
      const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
      const upscaleOption = menuItems.find(el => el.textContent?.toLowerCase().includes('upscale')) as HTMLElement;

      if (upscaleOption) {
        upscaleOption.click();
        await robustSleep(3000);

        // No Upscale, o vídeo anterior é o normalVideo.src que acabamos de gerar
        // O Upscale vai substituir esse vídeo ou criar um novo elemento #hd-video
        // Passamos o finalVideoSrc atual como 'ignore' para ter certeza que mudou (se o ID de elemento mudar, ok, mas se reutilizar...)
        // O seletor de ID muda (#sd-video -> #hd-video), então não deve conflitar, mas não custa passar.

        try {
          const upscaledVideo = await ensureGenerationCycle("Upscale", finalVideoSrc);
          finalVideoSrc = upscaledVideo.src;
          finalFilename += "_upscaled";
        } catch (error) {
          log(`Erro no upscale: ${error}. Continuando com vídeo normal...`);
          // Continue with normal video if upscale fails
        }
      } else {
        log("Opção de Upscale não encontrada no menu.");
      }
    }

    // 6. Download
    log(`Baixando final: ${finalFilename} (${finalVideoSrc})`);

    // Método 1: Chrome Downloads API (Background)
    chrome.runtime.sendMessage({
      action: "downloadVideo",
      url: finalVideoSrc,
      filename: finalFilename
    }, () => {
      if (chrome.runtime.lastError) {
        log(`Erro ao enviar mensagem de download: ${chrome.runtime.lastError.message}`);
      } else {
        log("Solicitação de download enviada ao background.");
      }
    });

    // Método 2: Fallback (Click direto no Link)
    try {
      log("Tentando download método fallback (Link direto)...");
      const a = document.createElement('a');
      a.href = finalVideoSrc;
      a.download = finalFilename;
      a.style.display = 'none';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 2000);
    } catch (e) {
      log(`Erro no download fallback: ${e}`);
    }

    // 7. Reset and Prepare for Next
    log("Ciclo finalizado. Aguardando conclusão segura do download...");
    await robustSleep(6000); // 6s para garantir que o download iniciou

    // Try to reset the page state for the next iteration
    try {
      const resetLink = document.querySelector('a[href="/imagine"]') as HTMLAnchorElement;
      if (resetLink) {
        resetLink.click();
        log("Reset clicado. Aguardando estabilização...");
        await robustSleep(3000);
      } else {
        log("Botão Reset não encontrado!");

        // Alternative reset methods if the main reset link isn't found
        const logoLink = document.querySelector('a[aria-label="Grok"], a[href="/"]') as HTMLAnchorElement;
        if (logoLink) {
          logoLink.click();
          await robustSleep(3000);
        }
      }
    } catch (error) {
      log(`Erro ao resetar para próximo ciclo: ${error}`);
      // Continue anyway, as the next cycle should handle cleanup
    }

    return finalVideoSrc; // Retorna o src final para ser usado como ignore na próxima
  }

})();


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
  attempt?: number;
  lastError?: string;
}

interface ProcessResult {
  success: boolean;
  videoSrc?: string;
  error?: string;
  isFatal?: boolean;
}

(function () {
  // ============================
  // CONFIGURAÇÕES E CONSTANTES
  // ============================
  const MAX_RETRIES = 3;
  const GENERATION_TIMEOUT = 300000;
  const DOWNLOAD_WAIT = 1500;
  const RESET_TIMEOUT = 8000;
  const QUICK_RESET_WAIT = 1000;

  const SELECTORS = {
    INPUT: 'input[type="file"][accept*="image"], input[name="files"]',
    SUBMIT_GENERATE: 'button[aria-label="submeter"]:not([disabled]), button[aria-label="Fazer vídeo"]:not([disabled])',
    SUBMIT_SEND: 'button[aria-label="Enviar"]:not([disabled])',
    SUBMIT_ANY: 'button[type="submit"]:not([disabled])',
    LOADING_CANVAS: 'canvas',
    LOADING_PERCENT: '.tabular-nums',
    VIDEO_SD: '#sd-video',
    VIDEO_HD: '#hd-video',
    DOWNLOAD_BTN: 'button[aria-label="BAIXAR"], button[aria-label="Baixar"]',
    MENU_BTN: 'button[aria-label="Mais opções"]',
    RESET_LINK: 'a[href="/imagine"]',
    HOME_LINK: 'a[aria-label="Página inicial"], a[href="/"]',
    ERROR_ALERT: 'div[role="alert"]',
    ERROR_TEXT: '.text-error, .text-destructive'
  };

  // Seletores adicionais para localizar o botão de submit via SVG (up-arrow)
  const SUBMIT_SVG_PATH_FRAGMENTS = ['M6 11L12 5', 'M12 5V19', 'M18 11'];
  const MAX_SUBMIT_ATTEMPTS = 10;
  const SUBMIT_VERIFY_TIMEOUT = 6000;

  const FATAL_ERROR_KEYWORDS = ['banned', 'suspended', 'account', 'conta suspensa', 'permanently'];
  const SKIP_ERROR_KEYWORDS = ['policy', 'diretrizes', 'guidelines', 'content policy', 'violação', 'violation', 'inappropriate'];

  // ============================
  // ESTADO GLOBAL
  // ============================
  let isRunning = false;
  let shouldStop = false;
  let isPageVisible = true;
  let lastInteractionTime = Date.now();

  // ============================
  // EVENT LISTENERS
  // ============================
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(event => {
    document.addEventListener(event, () => {
      lastInteractionTime = Date.now();
    }, { passive: true });
  });

  document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    if (isPageVisible) {
      log('Página visível novamente');
    }
  });

  window.addEventListener('focus', () => log('Janela em foco'));
  window.addEventListener('blur', () => log('Janela fora de foco - continuando em segundo plano'));

  // ============================
  // FUNÇÕES UTILITÁRIAS
  // ============================
  const log = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    console.log(`[GrokAutomator ${timestamp}] ${msg}`);
  };

  const robustSleep = (ms: number): Promise<void> => {
    return new Promise(resolve => {
      const start = Date.now();
      const poll = () => {
        if (shouldStop || Date.now() - start >= ms) {
          resolve();
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    });
  };

  const isUserActiveRecently = () => (Date.now() - lastInteractionTime) < 30000;

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

  const waitForElement = async (selector: string, timeout = 30000): Promise<Element | null> => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (shouldStop) return null;
      try {
        const el = document.querySelector(selector);
        if (el?.isConnected) return el;
      } catch (e) {
        log(`Erro ao buscar ${selector}: ${e}`);
      }
      await robustSleep(500);
    }
    return null;
  };

  const updateState = (update: GrokState) => {
    chrome.storage.local.get(['grokState'], (result) => {
      const oldState = result.grokState || {};
      chrome.storage.local.set({ grokState: { ...oldState, ...update } });
    });
  };

  // ============================
  // DETECÇÃO DE ERROS
  // ============================
  const checkForUIErrors = (): { hasError: boolean; message: string; isFatal: boolean; shouldSkip: boolean } => {
    try {
      const alertEl = document.querySelector(SELECTORS.ERROR_ALERT);
      const errorTextEl = document.querySelector(SELECTORS.ERROR_TEXT);
      const bodyText = document.body.innerText.toLowerCase();

      const errorText = alertEl?.textContent || errorTextEl?.textContent || '';
      const combinedText = (errorText + ' ' + bodyText).toLowerCase();

      const isFatal = FATAL_ERROR_KEYWORDS.some(kw => combinedText.includes(kw));
      const shouldSkip = SKIP_ERROR_KEYWORDS.some(kw => combinedText.includes(kw));

      if (alertEl || errorTextEl) {
        return { hasError: true, message: errorText.slice(0, 100), isFatal, shouldSkip };
      }

      if (bodyText.includes('rate limit') || bodyText.includes('limite de taxa')) {
        return { hasError: true, message: 'Rate limit atingido', isFatal: false, shouldSkip: false };
      }

      if (bodyText.includes('error') && bodyText.includes('generation')) {
        return { hasError: true, message: 'Erro na geração', isFatal: false, shouldSkip: false };
      }

    } catch (e) {
      log(`Erro ao verificar UI: ${e}`);
    }

    return { hasError: false, message: '', isFatal: false, shouldSkip: false };
  };

  const isFatalError = (error: unknown): boolean => {
    const msg = String(error).toLowerCase();
    return FATAL_ERROR_KEYWORDS.some(kw => msg.includes(kw));
  };

  // ============================
  // FUNÇÕES DE LOADING/VIDEO
  // ============================
  const isLoading = (): boolean => {
    try {
      const hasCanvas = document.querySelector(SELECTORS.LOADING_CANVAS) !== null;
      const percentEls = document.querySelectorAll(SELECTORS.LOADING_PERCENT);
      const hasPercent = Array.from(percentEls).some(el => el.textContent?.includes('%'));
      return hasCanvas || hasPercent;
    } catch {
      return false;
    }
  };

  const isVideoReady = (selector: string, ignoreSrc: string | null): HTMLVideoElement | null => {
    try {
      const video = document.querySelector(selector) as HTMLVideoElement;
      if (!video) return null;

      const hasSrc = video.src && video.src.startsWith('http');
      const isNewSrc = !ignoreSrc || video.src !== ignoreSrc;
      const isReady = video.readyState >= 3;
      const hasValid = video.duration > 0;
      const isVisible = getComputedStyle(video).visibility !== 'hidden';

      if (hasSrc && isNewSrc && isReady && hasValid && isVisible) {
        return video;
      }
    } catch {
      return null;
    }
    return null;
  };

  const checkAndHandleVideoChoice = async (): Promise<boolean> => {
    try {
      const choiceText = document.body.innerText;
      if (choiceText.includes('Qual vídeo você prefere manter') ||
        choiceText.includes('Which video do you prefer')) {

        log('Tela de escolha de vídeo detectada - selecionando primeira opção...');

        const preferButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
          const text = btn.textContent?.toLowerCase() || '';
          return text.includes('prefiro isso') || text.includes('prefer this');
        });

        if (preferButtons.length > 0) {
          (preferButtons[0] as HTMLButtonElement).click();
          log('Primeira opção selecionada');
          await robustSleep(2000);
          return true;
        }

        const ignoreBtn = Array.from(document.querySelectorAll('button')).find(btn => {
          const text = btn.textContent?.toLowerCase() || '';
          return text.includes('ignorar') || text.includes('ignore');
        }) as HTMLButtonElement;

        if (ignoreBtn) {
          ignoreBtn.click();
          log('Botão Ignorar clicado');
          await robustSleep(2000);
          return true;
        }
      }
    } catch (e) {
      log(`Erro ao verificar tela de escolha: ${e}`);
    }
    return false;
  };

  // ============================
  // RESET DE ESTADO
  // ============================
  const quickReset = async (): Promise<boolean> => {
    log('Reset rápido...');

    try {
      document.querySelector(SELECTORS.VIDEO_SD)?.remove();
      document.querySelector(SELECTORS.VIDEO_HD)?.remove();
    } catch { /* ignore */ }

    const resetLink = document.querySelector(SELECTORS.RESET_LINK) as HTMLAnchorElement;
    if (resetLink) {
      resetLink.click();

      const timeout = Date.now() + 5000;
      while (Date.now() < timeout) {
        if (shouldStop) return false;

        const hasInput = document.querySelector(SELECTORS.INPUT);
        if (hasInput && !isLoading()) {
          await robustSleep(QUICK_RESET_WAIT);
          log('Reset rápido concluído');
          return true;
        }
        await robustSleep(200);
      }
    }
    return false;
  };

  const forceResetState = async (): Promise<void> => {
    if (await quickReset()) return;

    log('Executando reset forçado...');

    const removeVideos = () => {
      try {
        document.querySelector(SELECTORS.VIDEO_SD)?.remove();
        document.querySelector(SELECTORS.VIDEO_HD)?.remove();
      } catch { /* ignore */ }
    };

    removeVideos();

    const tryClick = async (selector: string): Promise<boolean> => {
      try {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) {
          el.click();
          await robustSleep(1500);
          return true;
        }
      } catch { /* ignore */ }
      return false;
    };

    if (await tryClick(SELECTORS.RESET_LINK)) {
      log('Reset via link /imagine');
    } else if (await tryClick(SELECTORS.HOME_LINK)) {
      log('Reset via link home');
    }

    const timeout = Date.now() + RESET_TIMEOUT;
    while (Date.now() < timeout) {
      if (shouldStop) return;

      removeVideos();
      const hasInput = document.querySelector(SELECTORS.INPUT);
      const hasLoading = isLoading();

      if (hasInput && !hasLoading) {
        log('Estado limpo confirmado');
        return;
      }

      await robustSleep(300);
    }

    log('Reset timeout - navegação forçada');
    try {
      window.location.href = '/imagine';
      await robustSleep(2000);
    } catch (e) {
      log(`Erro na navegação forçada: ${e}`);
    }
  };

  // ============================
  // UPLOAD E SUBMIT
  // ============================
  const uploadFile = async (fileData: GrokFile): Promise<boolean> => {
    const fileInput = await waitForElement(SELECTORS.INPUT, 15000) as HTMLInputElement;
    if (!fileInput) {
      throw new Error('Input de arquivo não encontrado');
    }

    log(`Enviando arquivo: ${fileData.name}`);
    const file = dataURLtoFile(fileData.dataUrl, fileData.name);
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    try { fileInput.value = ''; } catch { /* ignore */ }

    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));

    await robustSleep(2000);
    return true;
  };

  /**
   * Localiza o botão de submit usando múltiplas estratégias:
   * 1. Seletores CSS (aria-label, type)
   * 2. Texto do botão (gerar, iniciar, etc.)
   * 3. SVG path (seta para cima)
   */
  const findSubmitButton = (): HTMLButtonElement | null => {
    // Estratégia 1: seletores diretos por aria-label e type
    const cssSelectors = [
      'button[aria-label="submeter"]:not([disabled])',
      'button[aria-label="Fazer vídeo"]:not([disabled])',
      'button[aria-label="Enviar"]:not([disabled])',
      'button[aria-label="Submit"]:not([disabled])',
      'button[aria-label="Generate"]:not([disabled])',
      'button[aria-label="Gerar"]:not([disabled])',
      'button[aria-label="Iniciar"]:not([disabled])',
      'button[type="submit"]:not([disabled])',
    ];

    for (const sel of cssSelectors) {
      try {
        const btn = document.querySelector(sel) as HTMLButtonElement;
        if (btn && !btn.disabled && btn.isConnected) {
          return btn;
        }
      } catch { /* ignore */ }
    }

    // Estratégia 2: texto do botão
    const textKeywords = ['gerar', 'iniciar', 'submit', 'enviar', 'fazer vídeo', 'generate', 'start', 'criar'];
    const allBtns = Array.from(document.querySelectorAll('button:not([disabled])')) as HTMLButtonElement[];

    for (const btn of allBtns) {
      if (btn.disabled || !btn.isConnected) continue;
      const text = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase().trim();
      if (textKeywords.some(kw => text.includes(kw))) {
        return btn;
      }
    }

    // Estratégia 3: botão type="submit" com SVG de seta para cima
    const submitBtns = Array.from(document.querySelectorAll('button[type="submit"]:not([disabled])')) as HTMLButtonElement[];
    for (const btn of submitBtns) {
      if (btn.disabled || !btn.isConnected) continue;
      const paths = Array.from(btn.querySelectorAll('path'));
      for (const path of paths) {
        const d = path.getAttribute('d') || '';
        if (SUBMIT_SVG_PATH_FRAGMENTS.some(frag => d.includes(frag))) {
          log('Botão submit encontrado via SVG path (seta para cima)');
          return btn;
        }
      }
    }

    // Estratégia 4: qualquer button[type="submit"] visível (último recurso)
    for (const btn of submitBtns) {
      if (!btn.disabled && btn.isConnected && btn.offsetParent !== null) {
        log('Botão submit encontrado via fallback genérico');
        return btn;
      }
    }

    return null;
  };

  /**
   * Verifica se o submit funcionou aguardando o início do loading ou aparecimento de vídeo.
   */
  const verifySubmitWorked = async (timeout: number): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (shouldStop) return false;
      if (isLoading()) return true;
      // Vídeo apareceu muito rapidamente (cache ou resposta imediata)
      const sdVideo = document.querySelector(SELECTORS.VIDEO_SD) as HTMLVideoElement | null;
      if (sdVideo?.src?.startsWith('http') && sdVideo.duration > 0) return true;
      await robustSleep(200);
    }
    return false;
  };

  /**
   * Clica no botão de submit com múltiplas estratégias e verifica se funcionou.
   * Retorna quando o loading é confirmado ou lança erro após esgotar tentativas.
   */
  const robustClickSubmit = async (): Promise<void> => {
    log('Iniciando clique robusto no botão de submit...');

    for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
      if (shouldStop) throw new Error('Parado pelo usuário');

      const errorCheck = checkForUIErrors();
      if (errorCheck.hasError) {
        throw new Error(`Erro detectado antes do submit: ${errorCheck.message}`);
      }

      // Se já iniciou (race condition: loading começou antes do clique)
      if (isLoading()) {
        log('Loading já detectado antes do clique — submit não necessário.');
        return;
      }

      log(`Tentativa de submit ${attempt}/${MAX_SUBMIT_ATTEMPTS}...`);

      const btn = findSubmitButton();

      if (btn) {
        log(`Botão encontrado: aria-label="${btn.getAttribute('aria-label')}" type="${btn.type}" text="${btn.textContent?.trim().slice(0, 30)}"`);

        // Estratégia A: click direto
        btn.scrollIntoView({ behavior: 'instant', block: 'center' });
        await robustSleep(100);
        btn.click();

        if (await verifySubmitWorked(SUBMIT_VERIFY_TIMEOUT)) {
          log('Submit confirmado via click() direto!');
          return;
        }

        // Estratégia B: simulateFullClick (pointer + mouse events)
        log('Click direto não iniciou geração. Tentando simulateFullClick...');
        await simulateFullClick(btn);

        if (await verifySubmitWorked(SUBMIT_VERIFY_TIMEOUT)) {
          log('Submit confirmado via simulateFullClick!');
          return;
        }

        // Estratégia C: Enter via teclado no botão
        log('simulateFullClick não iniciou. Tentando Enter no botão...');
        btn.focus();
        btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        btn.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        btn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));

        if (await verifySubmitWorked(SUBMIT_VERIFY_TIMEOUT)) {
          log('Submit confirmado via Enter no botão!');
          return;
        }

        // Estratégia D: submit do form pai
        const form = btn.closest('form');
        if (form) {
          log('Enter não iniciou. Tentando form.requestSubmit() / submit...');
          try {
            form.requestSubmit(btn);
          } catch {
            form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: btn }));
          }

          if (await verifySubmitWorked(SUBMIT_VERIFY_TIMEOUT)) {
            log('Submit confirmado via form submit!');
            return;
          }
        }

      } else {
        log(`Botão de submit não encontrado na tentativa ${attempt}. Aguardando...`);
      }

      // Backoff progressivo: 1s, 1.5s, 2s, 2.5s...
      const backoff = Math.min(1000 + (attempt - 1) * 500, 4000);
      log(`Tentativa ${attempt} falhou. Aguardando ${backoff}ms antes da próxima...`);
      await robustSleep(backoff);
    }

    throw new Error(`Não foi possível iniciar a geração após ${MAX_SUBMIT_ATTEMPTS} tentativas de submit`);
  };

  // ============================
  // CICLO DE GERAÇÃO
  // ============================
  const waitForGeneration = async (isUpscale: boolean, ignoreSrc: string | null): Promise<HTMLVideoElement> => {
    const actionName = isUpscale ? 'Upscale' : 'Normal';
    const videoSelector = isUpscale ? SELECTORS.VIDEO_HD : SELECTORS.VIDEO_SD;

    log(`[${actionName}] Iniciando detecção... Ignorar: ${ignoreSrc?.slice(0, 30) || 'Nenhum'}`);

    let loadingDetected = false;
    const phase1Timeout = Date.now() + 60000;

    while (Date.now() < phase1Timeout) {
      if (shouldStop) throw new Error('Parado pelo usuário');

      const errorCheck = checkForUIErrors();
      if (errorCheck.hasError) {
        if (errorCheck.shouldSkip) {
          throw new Error(`SKIP: ${errorCheck.message}`);
        }
        if (errorCheck.isFatal) {
          throw new Error(`FATAL: ${errorCheck.message}`);
        }
        throw new Error(`Erro UI: ${errorCheck.message}`);
      }

      if (isLoading()) {
        loadingDetected = true;
        log(`[${actionName}] Loading detectado`);
        break;
      }

      const quickVideo = isVideoReady(videoSelector, ignoreSrc);
      if (quickVideo) {
        log(`[${actionName}] Vídeo encontrado rapidamente`);
        return quickVideo;
      }

      await robustSleep(200);
    }

    if (loadingDetected) {
      log(`[${actionName}] Aguardando conclusão do loading...`);
      const phase2Timeout = Date.now() + GENERATION_TIMEOUT;
      let lastLog = 0;

      while (Date.now() < phase2Timeout) {
        if (shouldStop) throw new Error('Parado pelo usuário');

        if (Date.now() - lastLog > 10000) {
          const errorCheck = checkForUIErrors();
          if (errorCheck.hasError) {
            throw new Error(`Erro durante geração: ${errorCheck.message}`);
          }
          log(`[${actionName}] Ainda processando...`);
          lastLog = Date.now();
        }

        if (!isLoading()) {
          await robustSleep(2000);
          if (!isLoading()) {
            log(`[${actionName}] Loading encerrado`);
            break;
          }
        }

        await robustSleep(isUserActiveRecently() ? 500 : 1000);
      }
    }

    log(`[${actionName}] Validando vídeo final...`);
    const phase3Timeout = Date.now() + 60000;

    while (Date.now() < phase3Timeout) {
      if (shouldStop) throw new Error('Parado pelo usuário');

      await checkAndHandleVideoChoice();

      const video = isVideoReady(videoSelector, ignoreSrc);
      if (video) {
        log(`[${actionName}] SUCESSO! Vídeo: ${video.src.slice(0, 50)}...`);
        return video;
      }

      const errorCheck = checkForUIErrors();
      if (errorCheck.hasError) {
        throw new Error(`Erro na validação: ${errorCheck.message}`);
      }

      await robustSleep(1000);
    }

    throw new Error(`[${actionName}] Timeout aguardando vídeo`);
  };

  // ============================
  // DOWNLOAD
  // ============================
  const downloadVideo = async (videoSrc: string, filename: string): Promise<boolean> => {
    log(`Iniciando download: ${filename}`);
    log(`URL: ${videoSrc.slice(0, 80)}...`);

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'downloadVideo',
        url: videoSrc,
        filename: filename
      }, (response) => {
        if (chrome.runtime.lastError) {
          log(`Erro na mensagem: ${chrome.runtime.lastError.message}`);

          try {
            const nativeBtn = document.querySelector(SELECTORS.DOWNLOAD_BTN) as HTMLElement;
            if (nativeBtn) {
              log('Tentando download via botão nativo...');
              nativeBtn.click();
              resolve(true);
              return;
            }

            log('Tentando download via link direto...');
            const a = document.createElement('a');
            a.href = videoSrc;
            a.download = `${filename}.mp4`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 2000);
            resolve(true);
          } catch (e) {
            log(`Erro no download direto: ${e}`);
            resolve(false);
          }
        } else if (response?.success) {
          log(`Download salvo em Grok_Videos/${filename}.mp4`);
          resolve(true);
        } else {
          log(`Falha no download: ${response?.error}`);
          resolve(false);
        }
      });
    });
  };

  // ============================
  // HELPER: Simulação Completa de Clique (Radix UI Friendly)
  // ============================
  const simulateFullClick = async (element: HTMLElement) => {
    const options: PointerEventInit & MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window
    };

    element.dispatchEvent(new PointerEvent('pointerdown', options));
    element.dispatchEvent(new MouseEvent('mousedown', options));
    await robustSleep(50);
    element.dispatchEvent(new PointerEvent('pointerup', options));
    element.dispatchEvent(new MouseEvent('mouseup', options));
    await robustSleep(50);
    element.dispatchEvent(new MouseEvent('click', options));
  };

  // ============================
  // UPSCALE OTIMIZADO (Radix UI)
  // ============================
  const tryUpscale = async (currentVideoSrc: string): Promise<{ src: string; didUpscale: boolean }> => {
    log('Iniciando fluxo de Upscale (Radix Enhanced)...');

    try {
      await robustSleep(2000);

      const getMenuButton = (): HTMLButtonElement | null => {
        const buttons = Array.from(document.querySelectorAll('button[aria-label="Mais opções"]'));
        for (const btn of buttons) {
          const parent = btn.closest('div.flex');
          const isDisabled = parent?.classList.contains('opacity-50') ||
            parent?.classList.contains('pointer-events-none');
          if (!isDisabled) {
            return btn as HTMLButtonElement;
          }
        }
        return null;
      };

      let menuBtn = getMenuButton();
      if (!menuBtn) {
        await waitForElement('button[aria-label="Mais opções"]', 5000);
        menuBtn = getMenuButton();
      }

      if (!menuBtn) {
        log('Botão de menu não encontrado. Pulando upscale.');
        return { src: currentVideoSrc, didUpscale: false };
      }

      log('Botão "Mais opções" encontrado');

      const openMenuAndFindOption = async (): Promise<HTMLElement | null> => {
        const isAlreadyOpen = menuBtn?.getAttribute('aria-expanded') === 'true' ||
          menuBtn?.getAttribute('data-state') === 'open';

        if (!isAlreadyOpen && menuBtn) {
          log('Enviando eventos de clique no menu...');
          menuBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          await robustSleep(200);
          menuBtn.focus();
          await robustSleep(100);
          await simulateFullClick(menuBtn);
        }

        const searchTimeout = Date.now() + 3000;
        while (Date.now() < searchTimeout) {
          if (shouldStop) return null;

          const allItems = Array.from(document.querySelectorAll('[role="menuitem"]'));

          const targetItem = allItems.find(el => {
            const text = el.textContent?.toLowerCase().trim() || '';
            return text.includes('upscale');
          });

          if (targetItem) {
            log(`Opção Upscale encontrada entre ${allItems.length} itens`);
            return targetItem as HTMLElement;
          }

          await robustSleep(150);
        }
        return null;
      };

      let upscaleOption: HTMLElement | null = null;

      for (let i = 1; i <= 5; i++) {
        log(`Tentativa ${i}/5 de abrir menu e encontrar Upscale...`);
        upscaleOption = await openMenuAndFindOption();

        if (upscaleOption) break;

        log(`Tentativa ${i} falhou. Fechando menu e tentando novamente...`);

        try {
          const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
          document.dispatchEvent(escEvent);
        } catch { /* ignore */ }

        await robustSleep(800);
      }

      if (!upscaleOption) {
        log('Opção "Upscale" não encontrada após tentativas. Abortando upscale.');
        return { src: currentVideoSrc, didUpscale: false };
      }

      log('Clicando na opção Upscale...');
      await simulateFullClick(upscaleOption);

      await robustSleep(2000);

      log('Aguardando geração do vídeo HD...');
      const upscaledVideo = await waitForGeneration(true, currentVideoSrc);

      log(`Upscale concluído! Novo vídeo: ${upscaledVideo.src.slice(0, 50)}...`);
      return { src: upscaledVideo.src, didUpscale: true };

    } catch (e) {
      log(`Erro no fluxo de upscale: ${e}. Usando vídeo original.`);
      return { src: currentVideoSrc, didUpscale: false };
    }
  };

  // ============================
  // PROCESSAMENTO DE IMAGEM
  // ============================
  const processSingleImage = async (
    fileData: GrokFile,
    upscale: boolean,
    previousVideoSrc: string | null
  ): Promise<ProcessResult> => {
    try {
      await forceResetState();
    } catch (e) {
      log(`Aviso no reset inicial: ${e}`);
    }

    await uploadFile(fileData);
    // Pausa curta para o React processar o upload e habilitar o botão
    await robustSleep(1500);

    await robustClickSubmit();

    // Pequena margem antes de iniciar a detecção de geração
    await robustSleep(500);

    const normalVideo = await waitForGeneration(false, previousVideoSrc);
    let finalSrc = normalVideo.src;
    const finalFilename = fileData.name.replace(/\.[^/.]+$/, '');

    if (upscale) {
      const upscaleResult = await tryUpscale(finalSrc);
      finalSrc = upscaleResult.src;
    }

    const downloadSuccess = await downloadVideo(finalSrc, finalFilename);
    if (!downloadSuccess) {
      log('Aviso: Download pode não ter iniciado corretamente');
    }

    await robustSleep(DOWNLOAD_WAIT);

    log('Download concluído - retornando ao Imagine...');
    const resetOk = await quickReset();
    if (!resetOk) {
      log('Reset rápido falhou, tentando forçado...');
      await forceResetState();
    }

    return { success: true, videoSrc: finalSrc };
  };

  // ============================
  // FILA DE PROCESSAMENTO
  // ============================
  async function processQueue(files: GrokFile[], upscale: boolean) {
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;
    let lastVideoSrc: string | null = null;

    for (const fileData of files) {
      if (shouldStop) {
        updateState({ status: 'paused', isRunning: false });
        break;
      }

      const fileIndex = processedCount + 1;
      let attempts = 0;
      let success = false;

      while (attempts < MAX_RETRIES && !success && !shouldStop) {
        attempts++;
        log(`Processando ${fileIndex}/${files.length}: ${fileData.name} (Tentativa ${attempts}/${MAX_RETRIES})`);

        updateState({
          currentIndex: fileIndex,
          currentFile: fileData.name,
          status: 'processing',
          attempt: attempts
        });

        try {
          const result = await processSingleImage(fileData, upscale, lastVideoSrc);

          if (result.success && result.videoSrc) {
            success = true;
            successCount++;
            lastVideoSrc = result.videoSrc;
            log(`SUCESSO: ${fileData.name}`);
          }

        } catch (error) {
          const errorMsg = String(error);
          log(`ERRO na tentativa ${attempts}: ${errorMsg}`);

          updateState({ lastError: errorMsg.slice(0, 100) });

          if (isFatalError(error)) {
            log('ERRO FATAL detectado - parando automação');
            shouldStop = true;
            updateState({ status: 'error', isRunning: false, lastError: 'Erro fatal: ' + errorMsg.slice(0, 50) });
            break;
          }

          if (errorMsg.includes('SKIP:')) {
            log(`Imagem violou diretrizes - pulando: ${fileData.name}`);
            break;
          }

          if (attempts < MAX_RETRIES) {
            log(`Aguardando antes de retry...`);
            await forceResetState();
            await robustSleep(5000);
          }
        }
      }

      if (!success && !shouldStop) {
        errorCount++;
        log(`FALHA DEFINITIVA: ${fileData.name} após ${attempts} tentativas`);
        await quickReset();
      }

      processedCount++;
    }

    if (!shouldStop) {
      const finalStatus = errorCount === 0 ? 'completed' : 'completed';
      log(`Fila finalizada: ${successCount} sucesso, ${errorCount} erros de ${files.length} total`);
      updateState({
        status: finalStatus,
        isRunning: false,
        currentIndex: processedCount,
        currentFile: `Finalizado (${successCount}/${files.length})`
      });
    }
  }

  // ============================
  // MESSAGE LISTENER
  // ============================
  chrome.runtime.onMessage.addListener((request: AutomationRequest, _sender, sendResponse) => {
    if (request.action === 'startGrokQueue') {
      log('Mensagem startGrokQueue recebida!');

      if (isRunning) {
        log('Automação já em execução');
        sendResponse({ success: false, reason: 'already_running' });
        return true;
      }

      const { files, upscale } = request;
      log(`Iniciando fila: ${files.length} arquivos, Upscale: ${upscale}`);

      isRunning = true;
      shouldStop = false;

      updateState({
        isRunning: true,
        totalFiles: files.length,
        status: 'processing',
        currentIndex: 0
      });

      sendResponse({ success: true, message: 'Fila iniciada' });

      (async () => {
        try {
          await processQueue(files, upscale);
        } catch (e) {
          log(`Erro crítico na fila: ${e}`);
          updateState({ status: 'error', isRunning: false, lastError: String(e).slice(0, 100) });
        } finally {
          isRunning = false;
        }
      })();

      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.grokShouldStop?.newValue === true) {
      shouldStop = true;
      log('Sinal de parada recebido');
      chrome.storage.local.set({ grokShouldStop: false });
    }
  });

  log('Script inicializado v2.1 - RobustClickSubmit + Multi-Strategy Submit Ativo');

})();

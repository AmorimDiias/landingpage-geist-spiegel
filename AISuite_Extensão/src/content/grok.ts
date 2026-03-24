interface PromptItem {
  id: string;
  key: string;
  duration?: string;
  cleanPrompt: string;
  animate: boolean;
}

interface AutomationRequest {
  action: string;
  animationImages?: Array<{dataUrl: string; filename: string}>;
}

interface GrokState {
  isRunning?: boolean;
  currentIndex?: number;
  totalPrompts?: number;
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
  // Guard against duplicate initialization (from programmatic re-injection)
  if ((window as any).__grokAutomatorLoaded) {
    console.log('[GrokAutomator] Script already loaded, skipping re-initialization');
    return;
  }
  (window as any).__grokAutomatorLoaded = true;

  // ============================
  // CONFIGURAÇÕES E CONSTANTES
  // ============================
  const SELECTORS = {
    INPUT: 'input[type="file"][accept*="image"], input[name="files"]',
    EDITOR: 'div[contenteditable="true"]',
    SUBMIT: 'button[aria-label="submeter"]',
    ATTACH: 'button[aria-label="Anexar"]',
    VIDEO: 'video[src*="imagine-public"], video[src*="x.ai"], video[poster*="imagine-public"]',
    REMOVE_IMAGE: 'button[aria-label="Remove image"], button[aria-label="Remover imagem"], button[title="Remove image"]',
    MAKE_VIDEO: 'button[aria-label="Fazer vídeo"], button[aria-label="Make video"]',
    DOWNLOAD: 'button[aria-label="BAIXAR"], button[aria-label="Baixar"], button[aria-label="Download"]',
    BACK: 'div[aria-label="Voltar"], button[aria-label="Voltar"], a[aria-label="Voltar"], a[href="/imagine"], a[href="/imagine/saved"], button[aria-label="Back"]',
    ERROR_ALERT: 'div[role="alert"]',
    ERROR_TEXT: '.text-error, .text-destructive'
  };

  let isRunning = false;
  let shouldStop = false;

  const log = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const fullMsg = `[GrokAutomator ${timestamp}] ${msg}`;
    console.log(fullMsg);
    // Adiciona log visual pequeno se o usuário estiver perdido
    try {
      let toast = document.getElementById('grok-automator-log');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'grok-automator-log';
        Object.assign(toast.style, {
          position: 'fixed', bottom: '10px', right: '10px', background: 'rgba(0,0,0,0.8)',
          color: '#00ff00', padding: '8px 12px', borderRadius: '4px', fontSize: '10px',
          zIndex: '99999', pointerEvents: 'none', border: '1px solid #333', fontFamily: 'monospace'
        });
        document.body.appendChild(toast);
      }
      toast.innerText = msg;
    } catch {}
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

  /**
   * Find the Tiptap ProseMirror editor directly.
   */
  const findEditor = (): HTMLElement | null => {
    const tiptap = document.querySelector('div.tiptap.ProseMirror[contenteditable="true"]') as HTMLElement;
    if (tiptap) return tiptap;
    const queryBar = document.querySelector('.query-bar');
    if (queryBar) {
      const ce = queryBar.querySelector('div[contenteditable="true"]') as HTMLElement;
      if (ce) return ce;
    }
    return document.querySelector('div[contenteditable="true"]') as HTMLElement;
  };

  const updateState = (update: GrokState) => {
    chrome.storage.local.get(['grokState'], (result: any) => {
      const oldState = result.grokState || {};
      chrome.storage.local.set({ grokState: { ...oldState, ...update } });
    });
  };

  const checkForUIErrors = (): { hasError: boolean; message: string; isFatal: boolean; } => {
    try {
      const alertEl = document.querySelector(SELECTORS.ERROR_ALERT);
      const errorTextEl = document.querySelector(SELECTORS.ERROR_TEXT);
      const errorText = alertEl?.textContent || errorTextEl?.textContent || '';
      if (alertEl || errorTextEl) {
        return { hasError: true, message: errorText.slice(0, 100), isFatal: false };
      }
    } catch {}
    return { hasError: false, message: '', isFatal: false };
  };

  const isLoading = (): boolean => {
    try {
      // "Gerando" / "Generating" text with animate-pulse (most specific to generation bar)
      if (Array.from(document.querySelectorAll('span.animate-pulse')).some(el =>
        /gerando|generating/i.test(el.textContent || '')
      )) return true;
      // Percentage counter (e.g. "33%") in tabular-nums span inside the generation bar
      if (Array.from(document.querySelectorAll('.tabular-nums')).some(el =>
        (el.textContent || '').includes('%')
      )) return true;
      return false;
    } catch {
      return false;
    }
  };

  const findReadyVideo = (ignoreSrc: string | null): HTMLVideoElement | null => {
    try {
      const videos = document.querySelectorAll('video') as NodeListOf<HTMLVideoElement>;
      for (const video of Array.from(videos)) {
        const src = video.src || '';
        if (!src.startsWith('http')) continue;
        if (ignoreSrc && src === ignoreSrc) continue;
        if (video.readyState >= 2 || video.duration > 0) return video;
      }
    } catch {}
    return null;
  };

  // ============================
  // FUNÇÕES DE DOM
  // ============================
  
  const waitForVisibleElement = (selector: string, timeout = 30000): Promise<HTMLElement> => {
    return new Promise((resolve, reject) => {
      const check = () => {
        const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
        return els.find(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        });
      };
      
      const el = check();
      if (el) return resolve(el);
      
      const observer = new MutationObserver(() => {
        const el = check();
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout VISIVEL: ${selector}`)); }, timeout);
    });
  };

  const waitForElement = (selector: string, timeout = 15000): Promise<HTMLElement> => {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector) as HTMLElement;
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
    });
  };

  async function typePrompt(text: string) {
    log(`Buscando editor para: "${text.slice(0, 20)}..."`);
    let editor: HTMLElement | null = null;
    const timeout = Date.now() + 15000;
    while (Date.now() < timeout) {
      editor = findEditor();
      if (editor) break;
      await robustSleep(300);
    }
    if (!editor) throw new Error('Editor não encontrado');
    
    editor.focus();
    await robustSleep(300);
    
    // Clear
    const p = editor.querySelector('p');
    if (p) p.innerHTML = '<br>'; else editor.innerHTML = '<p><br></p>';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await robustSleep(300);

    // Paste
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true }));
    await robustSleep(500);
    
    if (editor.innerText.trim().length === 0) {
      document.execCommand('insertText', false, text);
    }
    
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await robustSleep(1000);
  }

  const uploadFile = async (base64Data: string): Promise<boolean> => {
    log('Preparando upload...');
    let fileInput = document.querySelector(SELECTORS.INPUT) as HTMLInputElement;
    
    if (!fileInput) {
      log('Input não encontrado, tentando clicar em Anexar...');
      const attachBtn = document.querySelector(SELECTORS.ATTACH) as HTMLElement;
      if (attachBtn) {
        attachBtn.click();
        await robustSleep(1000);
        fileInput = document.querySelector(SELECTORS.INPUT) as HTMLInputElement;
      }
    }
    
    if (!fileInput) {
      // Tenta esperar um pouco mais
      try {
        fileInput = await waitForElement(SELECTORS.INPUT, 5000) as HTMLInputElement;
      } catch {
        throw new Error('Input de arquivo não disponível');
      }
    }
    
    log('Inserindo arquivo no input...');
    const file = dataURLtoFile(base64Data, "base.jpg");
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    try { fileInput.value = ''; } catch {}
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    log('Arquivo inserido.');
    return true;
  };

  const clickSubmit = async (): Promise<void> => {
    log('Aguardando botão submeter...');
    const timeout = Date.now() + 20000;
    while (Date.now() < timeout) {
      if (shouldStop) throw new Error('Parado');
      const btn = document.querySelector(SELECTORS.SUBMIT) as HTMLButtonElement;
      if (btn && !btn.disabled) {
        log('Clicando em submeter!');
        btn.click();
        return;
      }
      await robustSleep(500);
    }
    throw new Error('Botão enviar não habilitou');
  };

  const waitForGeneration = async (ignoreSrc: string | null): Promise<HTMLVideoElement> => {
    log('Aguardando geração...');
    const timeout = Date.now() + 300000; // 5 min (vídeos demoram mais)

    // Fase 1: espera até o indicador "Gerando" aparecer (máx. 25s)
    const detectDeadline = Date.now() + 25000;
    while (Date.now() < detectDeadline) {
      if (shouldStop) throw new Error('Parado');
      if (isLoading()) { log('Geração iniciada...'); break; }
      await robustSleep(500);
    }

    // Fase 2: espera o indicador sumir e o vídeo estar pronto
    while (Date.now() < timeout) {
      if (shouldStop) throw new Error('Parado');

      if (!isLoading()) {
        const video = findReadyVideo(ignoreSrc);
        if (video) {
          log('Vídeo pronto!');
          return video;
        }
      }

      const err = checkForUIErrors();
      if (err.hasError) throw new Error(err.message);

      await robustSleep(800);
    }
    throw new Error('Timeout geração');
  };

  // ============================
  // WORKERS
  // ============================

  /** Aguarda a página /imagine estar pronta (URL + radiogroup visível). */
  const waitForMainPage = async (): Promise<void> => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const path = window.location.pathname;
      const onMain = path === '/imagine' || path === '/imagine/';
      const inputReady = !!document.querySelector('div[role="radiogroup"][aria-label="Modo de geração"]');
      if (onMain && inputReady) break;
      await robustSleep(400);
    }
    await robustSleep(1500); // buffer para hidratação do React
  };

  /** Clica no botão Voltar e, se falhar, navega diretamente para /imagine. */
  const navigateBack = async (): Promise<void> => {
    log('Voltando para /imagine...');
    try {
      const backBtn = await waitForVisibleElement(SELECTORS.BACK, 5000);
      backBtn.click();
    } catch {
      log('Botão Voltar não encontrado — navegando diretamente...');
      window.location.href = '/imagine';
    }
    await waitForMainPage();
  };

  /** Garante que estamos em /imagine antes de iniciar. */
  const ensureOnMainPage = async (): Promise<void> => {
    const path = window.location.pathname;
    if (path !== '/imagine' && path !== '/imagine/') {
      log(`Fora de /imagine (${path}), corrigindo...`);
      window.location.href = '/imagine';
      await waitForMainPage();
    }
  };

  /** Remove imagens residuais do input (de execuções anteriores interrompidas). */
  const cleanInputImages = async (): Promise<void> => {
    const btns = Array.from(document.querySelectorAll(SELECTORS.REMOVE_IMAGE)) as HTMLButtonElement[];
    for (const btn of btns) {
      if (btn.getBoundingClientRect().width > 0) {
        btn.click();
        await robustSleep(300);
      }
    }
  };

  /**
   * Garante que o modo de geração correto (Vídeo ou Imagem) está ativo na barra do Grok.
   * O radiogroup é identificado por aria-label="Modo de geração".
   */
  const ensureGenerationMode = async (mode: 'video' | 'image'): Promise<void> => {
    try {
      const targetLabel = mode === 'video' ? 'Vídeo' : 'Imagem';
      const radioGroup = await waitForElement('div[role="radiogroup"][aria-label="Modo de geração"]', 10000);
      const buttons = Array.from(radioGroup.querySelectorAll('button[role="radio"]')) as HTMLButtonElement[];
      const targetBtn = buttons.find(btn => btn.querySelector('span')?.textContent?.trim() === targetLabel);
      if (!targetBtn) { log(`Botão "${targetLabel}" não encontrado no radiogroup`); return; }
      if (targetBtn.getAttribute('aria-checked') === 'true') { log(`Modo ${targetLabel} já ativo`); return; }
      log(`Ativando modo ${targetLabel}...`);
      targetBtn.click();
      await robustSleep(600);
    } catch (e) {
      log(`ensureGenerationMode falhou: ${e}`);
    }
  };

  const processCreationPrompt = async (prompt: PromptItem, baseImage: string, prevSrc: string | null): Promise<ProcessResult> => {
    await ensureOnMainPage();
    await ensureGenerationMode('image');
    await cleanInputImages();
    await uploadFile(baseImage);
    await robustSleep(3000);
    await typePrompt(prompt.cleanPrompt);
    await clickSubmit();
    await robustSleep(3000);
    const resultVideo = await waitForGeneration(prevSrc);
    let finalSrc = resultVideo.src;

    if (prompt.animate) {
      log('Tentando animar vídeo...');
      await robustSleep(2000);
      try {
        const animateBtn = await waitForVisibleElement(SELECTORS.MAKE_VIDEO, 8000);
        animateBtn.click();
        const hdVideo = await waitForGeneration(finalSrc);
        finalSrc = hdVideo.src;
      } catch (e) { log(`Não pode animar: ${e}`); }
    }

    log('Baixando...');
    await chrome.storage.local.set({ nextDownloadName: `${prompt.id} - ${prompt.key}.mp4` });
    try {
      const downBtn = await waitForVisibleElement(SELECTORS.DOWNLOAD, 10000);
      downBtn.click();
      await robustSleep(2000);
    } catch {}

    await navigateBack();
    return { success: true, videoSrc: finalSrc };
  };

  const processAnimationOnly = async (image: {dataUrl: string; filename: string}, prevSrc: string | null): Promise<ProcessResult> => {
    await ensureOnMainPage();
    await ensureGenerationMode('video');
    await cleanInputImages();
    await uploadFile(image.dataUrl);
    await robustSleep(3000);

    await clickSubmit();

    const video = await waitForGeneration(prevSrc);
    const finalSrc = video.src;

    const downloadName = image.filename.replace(/\.[^/.]+$/, '') + '.mp4';
    log(`Baixando: ${downloadName}`);
    await chrome.storage.local.set({ nextDownloadName: downloadName });
    try {
      const downBtn = await waitForVisibleElement(SELECTORS.DOWNLOAD, 10000);
      downBtn.click();
      await robustSleep(2000);
    } catch {}

    await navigateBack();
    return { success: true, videoSrc: finalSrc };
  };

  async function processCreationQueue(prompts: PromptItem[], baseImage: string, startIndex: number) {
    let lastSrc: string | null = null;
    for (let i = startIndex; i < prompts.length; i++) {
        if (shouldStop) break;
        updateState({ currentIndex: i, status: 'processing' });
        try {
          const res = await processCreationPrompt(prompts[i], baseImage, lastSrc);
          lastSrc = res.videoSrc || null;
        } catch (error) {
          log(`ERRO: ${error}`);
          updateState({ lastError: String(error), status: 'error', isRunning: false });
          return;
        }
    }
    updateState({ status: 'completed', isRunning: false });
  }

  async function processAnimationQueue(images: Array<{dataUrl: string; filename: string}>, startIndex: number) {
    let lastSrc: string | null = null;
    for (let i = startIndex; i < images.length; i++) {
        if (shouldStop) break;
        updateState({ currentIndex: i, status: 'processing' });
        try {
          const res = await processAnimationOnly(images[i], lastSrc);
          lastSrc = res.videoSrc || null;
        } catch (error) {
          log(`ERRO: ${error}`);
          updateState({ lastError: String(error), status: 'error', isRunning: false });
          return;
        }
    }
    updateState({ status: 'completed', isRunning: false });
  }

  const checkAutoResume = () => {
     chrome.storage.local.get(['grokState', 'grokBaseImage', 'grokPrompts', 'grokMode'], (result: any) => {
        if (result.grokState?.isRunning && result.grokState?.status === 'processing') {
           // Animation mode cannot auto-resume: images are not persisted in storage
           if (result.grokMode === 'creation' && result.grokPrompts) {
              isRunning = true; shouldStop = false;
              processCreationQueue(result.grokPrompts, result.grokBaseImage, result.grokState.currentIndex || 0);
           }
        }
     });
  };

  chrome.runtime.onMessage.addListener((request: AutomationRequest, _sender, sendResponse) => {
    if (request.action === 'startGrokQueue') {
      if (isRunning) { sendResponse({ success: false, reason: 'already_running' }); return; }
      isRunning = true; shouldStop = false;
      chrome.storage.local.get(['grokPrompts', 'grokBaseImage', 'grokState', 'grokMode'], (result: any) => {
          sendResponse({ success: true });
          const idx = result.grokState?.currentIndex || 0;
          if (result.grokMode === 'animation') {
            // Images are passed directly in the message to avoid storage quota limits
            const images = request.animationImages || [];
            if (images.length === 0) { log('ERRO: Nenhuma imagem recebida para animação'); isRunning = false; return; }
            processAnimationQueue(images, idx);
          } else {
            processCreationQueue(result.grokPrompts, result.grokBaseImage, idx);
          }
      });
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes: any) => {
    if (changes.grokShouldStop?.newValue === true) { shouldStop = true; isRunning = false; }
  });

  log('GrokAutomator Iniciado!');
  setTimeout(checkAutoResume, 2000);
})();

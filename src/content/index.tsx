import { createRoot } from 'react-dom/client';
import ContentApp from './ContentApp';
import '../styles/globals.css';

// Acessa chrome API de forma que o Vite não pode transformar
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getChrome = (): typeof chrome => (globalThis as any)['chrome'] || (window as any)['chrome'];



const MOUNT_POINT_ID = 'ai-suite-root';

// 1. Mount the Hidden React Controller
if (!document.getElementById(MOUNT_POINT_ID)) {
  // Inject Font
  if (!document.querySelector('#ai-suite-font')) {
    const fontLink = document.createElement('link');
    fontLink.id = 'ai-suite-font';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap';
    fontLink.rel = 'stylesheet';
    document.head.appendChild(fontLink);
  }

  const mountNode = document.createElement('div');
  mountNode.id = MOUNT_POINT_ID;
  document.body.appendChild(mountNode);
  const root = createRoot(mountNode);
  root.render(<ContentApp />);
}

// 2. Ícone de Raio (Zap) com Gradiente
const ZAP_ICON_SVG = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="zap-grad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6b4fe0"/>
      <stop offset="1" stop-color="#3c82f6"/>
    </linearGradient>
  </defs>
  <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" fill="url(#zap-grad)" stroke="url(#zap-grad)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

// 3. Função para inserir texto no YouTube (Simulação de Teclado)
const insertTextIntoYouTube = (element: HTMLElement, text: string) => {
  if (!element) return;

  element.focus();

  document.execCommand('selectAll', false);
  document.execCommand('insertText', false, text);

  element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('keydown', { bubbles: true }));
  element.dispatchEvent(new Event('keyup', { bubbles: true }));
};



// 4. Lógica de Extração de Contexto
const extractContext = (triggerEl: HTMLElement) => {
  let current: Node | null = triggerEl;
  let thread: HTMLElement | null = null;

  while (current) {
    if (current instanceof Element && current.tagName.toLowerCase() === 'ytcp-comment-thread') {
      thread = current as HTMLElement;
      break;
    }
    if (current instanceof ShadowRoot) {
      current = current.host;
    } else {
      current = current.parentNode;
    }
  }

  let commentText = "";
  if (thread) {
    const findText = (root: Node): string | null => {
      if (root instanceof Element && root.id === 'content-text') return root.textContent;
      if (root instanceof Element && root.shadowRoot) {
        const res = findText(root.shadowRoot);
        if (res) return res;
      }
      for (let i = 0; i < root.childNodes.length; i++) {
        const res = findText(root.childNodes[i]);
        if (res) return res;
      }
      return null;
    }
    commentText = findText(thread) || "";
  }

  // Extrai o videoId da URL (formato: /video/VIDEO_ID/...)
  let videoId = "";
  const urlMatch = window.location.pathname.match(/\/video\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    videoId = urlMatch[1];
  }

  // Extrai o título real do vídeo do menu lateral (não o document.title)
  let videoTitle = "";

  // Busca no elemento #entity-name dentro do ytcp-navigation-drawer
  const entityName = document.querySelector('#entity-name');
  if (entityName && entityName.textContent) {
    videoTitle = entityName.textContent.trim();
  }

  // Fallback: busca na thumbnail do menu
  if (!videoTitle) {
    const thumbnailAlt = document.querySelector('.video-thumbnail img[alt]');
    if (thumbnailAlt) {
      const alt = thumbnailAlt.getAttribute('alt');
      if (alt && alt.startsWith('Miniatura de vídeo:')) {
        videoTitle = alt.replace('Miniatura de vídeo:', '').trim();
      } else if (alt) {
        videoTitle = alt;
      }
    }
  }

  // Último fallback: usa o título da página mas remove o sufixo
  if (!videoTitle) {
    videoTitle = document.title.replace(' - YouTube Studio', '').trim();
  }



  return { commentText, videoId, videoTitle };
};

// 5. O "Perfurador" de Shadow DOM (Deep Walker)
const findAllCommentBoxes = (root: Node = document.body, depth = 0): Element[] => {
  const boxes: Element[] = [];

  // Log apenas no nível raiz para não spammar


  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: () => NodeFilter.FILTER_ACCEPT
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node as Element;
    const tagName = el.tagName.toLowerCase();

    if (tagName === 'ytcp-commentbox') {

      boxes.push(el);
    }

    if (el.shadowRoot) {
      // console.log(`[AI-Suite Debug] Mergulhando no Shadow DOM de ${tagName}`);
      boxes.push(...findAllCommentBoxes(el.shadowRoot, depth + 1));
    }
  }


  return boxes;
};

// 6. Injeção
const injectButtons = () => {
  // console.log('[AI-Suite Debug] Tentando injetar botões...');
  const commentBoxes = findAllCommentBoxes();

  if (commentBoxes.length === 0) {
    return;
  }

  commentBoxes.forEach((box, index) => {
    // Tenta encontrar a raiz (Shadow ou o próprio elemento)
    const root = box.shadowRoot || box;

    // Lista de possíveis seletores para o container de botões
    const buttonContainerSelectors = [
      '#buttons',
      '.buttons',
      '#footer',
      '.footer',
      '.ytcp-commentbox-footer',
      'div[id="buttons"]' // Fallback específico
    ];

    let buttonsContainer: Element | null = null;

    // Tenta encontrar o container em qualquer um dos seletores
    for (const selector of buttonContainerSelectors) {
      buttonsContainer = root.querySelector(selector);
      if (buttonsContainer) break;
    }

    if (!buttonsContainer) {
      // Apenas loga aviso se for a primeira vez ou debug profundo
      // console.warn(`[AI-Suite Debug] Container de botões não encontrado na caixa ${index}.`);
      return;
    }

    // Verifica se já injetou para não duplicar
    if (buttonsContainer.querySelector('.ai-suite-trigger')) {
      return;
    }



    const btn = document.createElement('div');
    btn.className = 'ai-suite-trigger';
    // ... (rest of the code remains the same as previously defined, just adding logs)
    btn.innerHTML = ZAP_ICON_SVG;
    btn.title = "Gerar Resposta com AI Suite";
    btn.style.cssText = `
         display: inline-flex;
         align-items: center;
         justify-content: center;
         width: 36px; 
         height: 36px;
         cursor: pointer;
         border-radius: 50%;
         margin-right: 8px;
         transition: background 0.2s;
         vertical-align: middle;
       `;

    btn.onmouseenter = () => { btn.style.backgroundColor = 'rgba(60, 130, 246, 0.1)'; };
    btn.onmouseleave = () => { btn.style.backgroundColor = 'transparent'; };

    btn.addEventListener('click', async (e) => {

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Feedback Visual de Carregamento
      btn.style.opacity = "0.5";
      btn.style.cursor = "wait";
      const originalIcon = btn.innerHTML;
      btn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation: spin 1s linear infinite;">
          <style>@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
          <circle cx="12" cy="12" r="10" stroke="#3c82f6" stroke-width="2" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
        </svg>
      `;

      const context = extractContext(buttonsContainer as HTMLElement);

      // Função helper para atualizar texto (para reuso)
      const updateEditable = (text: string) => {
        // Função recursiva para encontrar campo editável no Shadow DOM
        const findEditable = (root: Element | ShadowRoot | null): HTMLElement | null => {
          if (!root) return null;

          // Lista de seletores para tentar
          const selectors = [
            '#contenteditable-textarea',
            'textarea',
            '[contenteditable="true"]',
            '[contenteditable="plaintext-only"]',
            'div[role="textbox"]',
            '#input',
            '.input-container textarea',
            '.input-container [contenteditable]'
          ];

          for (const selector of selectors) {
            const el = root.querySelector(selector);
            if (el) {
              return el as HTMLElement;
            }
          }

          // Busca recursiva em elementos com Shadow DOM
          const children = root.querySelectorAll('*');
          for (const child of children) {
            if (child.shadowRoot) {
              const found = findEditable(child.shadowRoot);
              if (found) return found;
            }
          }

          return null;
        };

        // Tenta encontrar e escrever
        const editable = findEditable(box.shadowRoot) || findEditable(box) || (buttonsContainer.parentElement && findEditable(buttonsContainer.parentElement));

        if (editable) {
          insertTextIntoYouTube(editable, text);
          return true;
        }
        return false;
      };

      // 1. Feedback inicial imediato
      updateEditable("Obtendo transcrição...");

      // Listener temporário para atualização de progresso
      const progressListener = (msg: { type: string }) => {
        console.log('[AI Suite] fluxo de mensagens validado. Tipo:', msg.type);
        if (msg.type === 'TRANSCRIPT_FETCHED') {
          updateEditable("Transcrição obtida, gerando resposta com base na transcrição...");
        } else if (msg.type === 'TRANSCRIPT_FAILED') {
          updateEditable("Falha na transcrição, usando contexto básico...");
        }
      };

      // Usa try/catch para garantir limpeza do listener
      try {
        let chromeObj = getChrome(); // Re-obtain chrome object safely
        if (chromeObj?.runtime?.onMessage) {
          chromeObj.runtime.onMessage.addListener(progressListener);
        }

        // ENVIA PARA O BACKGROUND
        if (!chromeObj?.runtime?.sendMessage) {
          chromeObj = (window as unknown as { chrome: typeof chrome }).chrome;
        }

        if (!chromeObj?.runtime?.sendMessage) {
          console.error("[AI Suite] Chrome API perdido. Recarregue a página.");
          alert("A extensão foi atualizada. Por favor, recarregue esta página do YouTube Studio.");
          throw new Error('Chrome API não disponível em nenhum contexto');
        }

        // Lê o modo do storage
        const storageResult = await new Promise<{ generationMode?: string }>((resolve) => {
          chromeObj.storage.local.get(['generationMode'], (result) => {
            resolve(result as { generationMode?: string });
          });
        });
        const mode = storageResult.generationMode || 'simple';

        // Envia para o background - ele fará a busca se necessário
        const response = await chromeObj.runtime.sendMessage({
          type: 'GENERATE_REPLY',
          context: context,
          mode: mode
        });


        if (response && response.success) {
          if (!updateEditable(response.text)) {
            console.warn('[AI Suite] Campo de texto não encontrado, copiando para clipboard.');
            navigator.clipboard.writeText(response.text).then(() => {
              alert("Resposta gerada! O texto foi copiado para a área de transferência. Cole com Ctrl+V.");
            }).catch(() => {
              alert("Resposta gerada: " + response.text);
            });
          }
        } else {
          console.error('[AI Suite] Erro:', response?.error);
          alert("Erro ao gerar resposta: " + (response?.error || "Verifique se está logado no Puter."));
        }
      } catch (err) {
        console.error('[AI Suite] Erro:', err);
        alert("Erro de comunicação com a extensão. Tente recarregar a página.");
      } finally {
        // Remove listener
        const chromeObj = getChrome();
        if (chromeObj?.runtime?.onMessage) {
          chromeObj.runtime.onMessage.removeListener(progressListener);
        }

        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
        btn.innerHTML = originalIcon;
      }
    }, { capture: true });

    buttonsContainer.prepend(btn);
    console.log(`[AI-Suite Debug] SUCESSO: Botão injetado na caixa ${index}!`);

  });
};

// Loop Menos Agressivo
setInterval(injectButtons, 3000);

// Listener extra para cliques
document.addEventListener('click', () => {
  setTimeout(injectButtons, 100);
  setTimeout(injectButtons, 500);
});

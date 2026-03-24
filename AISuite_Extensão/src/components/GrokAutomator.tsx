

import { useState, useRef, useEffect } from "react";
import { Play, Pause, Trash2, Video, CheckCircle2, AlertCircle, Loader2, Link as LinkIcon, FileImage, Film, ImagePlus } from "lucide-react";
import styles from './GrokAutomator.module.css';

export type GrokMode = 'animation' | 'creation';

export interface PromptItem {
  id: string;
  key: string;
  duration?: string;
  cleanPrompt: string;
  animate: boolean;
}

interface GrokState {
  isRunning: boolean;
  currentIndex: number;
  totalPrompts: number;
  currentPrompt?: PromptItem;
  status: 'idle' | 'processing' | 'completed' | 'error' | 'paused';
}

export const GrokAutomator = () => {
  const [mode, setMode] = useState<GrokMode>('animation');
  const [baseImage, setBaseImage] = useState<string | null>(null);
  const [animationImages, setAnimationImages] = useState<Array<{dataUrl: string; filename: string}>>([]);
  const [textareaValue, setTextareaValue] = useState("");
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  
  const [grokState, setGrokState] = useState<GrokState>({
    isRunning: false,
    currentIndex: 0,
    totalPrompts: 0,
    status: 'idle'
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animFilesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chrome.storage.local.get(['grokState', 'grokBaseImage', 'grokTextarea', 'grokPrompts', 'grokMode'], (result: any) => {
      if (result.grokState) setGrokState(result.grokState);
      if (result.grokBaseImage) setBaseImage(result.grokBaseImage);
      if (result.grokTextarea) setTextareaValue(result.grokTextarea);
      if (result.grokPrompts) setPrompts(result.grokPrompts);
      if (result.grokMode) setMode(result.grokMode);
    });

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.grokState?.newValue) {
        setGrokState(changes.grokState.newValue as GrokState);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const saveStateToStorage = (updates: any) => {
    chrome.storage.local.set(updates);
  };

  const handleModeChange = (newMode: GrokMode) => {
    if (grokState.isRunning) return;
    setMode(newMode);
    saveStateToStorage({ grokMode: newMode });
  };

  // --- Creation Mode: Single Image ---
  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setBaseImage(dataUrl);
        saveStateToStorage({ grokBaseImage: dataUrl });
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setBaseImage(null);
    saveStateToStorage({ grokBaseImage: null });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const extractSortKey = (filename: string): number => {
    const match = filename.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : Infinity;
  };

  // --- Animation Mode: Multiple Images ---
  // NOTE: Images are kept only in memory (React state) to avoid chrome.storage.local quota limits.
  const handleAnimationImagesSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const files = Array.from(event.target.files);
      const readers: Promise<{dataUrl: string; filename: string}>[] = files.map(f => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: reader.result as string, filename: f.name });
        reader.readAsDataURL(f);
      }));

      Promise.all(readers).then((items) => {
        setAnimationImages(prev => {
          const combined = [...prev, ...items];
          combined.sort((a, b) => extractSortKey(a.filename) - extractSortKey(b.filename));
          return combined;
        });
      });
    }
  };

  const removeAnimationImage = (index: number) => {
    setAnimationImages(prev => prev.filter((_, i) => i !== index));
  };

  const clearAnimationImages = () => {
    setAnimationImages([]);
    if (animFilesInputRef.current) animFilesInputRef.current.value = '';
  };

  // --- Prompts (Creation mode) ---
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextareaValue(e.target.value);
    saveStateToStorage({ grokTextarea: e.target.value });
  };

  const handleParsePrompts = () => {
    const regex = /^\[(\d+)\]\s*\[([^\]]+)\](?:\s*\[([^\]]+)\])?\s*(.*)$/gm;
    const results: PromptItem[] = [];
    let match;
    while ((match = regex.exec(textareaValue)) !== null) {
      results.push({
        id: match[1],
        key: match[2],
        duration: match[3],
        cleanPrompt: match[4]?.trim() || '',
        animate: true
      });
    }
    setPrompts(results);
    saveStateToStorage({ grokPrompts: results });
  };

  const toggleAnimate = (index: number) => {
    const newPrompts = [...prompts];
    newPrompts[index].animate = !newPrompts[index].animate;
    setPrompts(newPrompts);
    saveStateToStorage({ grokPrompts: newPrompts });
  };

  const selectAll = (val: boolean) => {
    const newPrompts = prompts.map(p => ({ ...p, animate: val }));
    setPrompts(newPrompts);
    saveStateToStorage({ grokPrompts: newPrompts });
  };

  // --- Queue Start ---
  const handleStart = async () => {
    if (mode === 'creation' && (!baseImage || prompts.length === 0)) return;
    if (mode === 'animation' && animationImages.length === 0) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab?.url?.includes('grok.com')) {
      chrome.tabs.create({ url: 'https://grok.com/imagine' });
      return;
    }

    const totalItems = mode === 'creation' ? prompts.length : animationImages.length;

    const newState: GrokState = { 
      isRunning: true, 
      status: 'processing', 
      totalPrompts: totalItems,
      currentIndex: grokState.currentIndex,
    };
    if (grokState.status === 'idle' || grokState.status === 'completed') {
      newState.currentIndex = 0;
    }

    setGrokState(newState);

    if (mode === 'creation') {
      saveStateToStorage({ grokState: newState, grokBaseImage: baseImage, grokPrompts: prompts, grokMode: mode });
    } else {
      // Images are NOT saved to storage (quota limit); they are sent directly in the message below.
      saveStateToStorage({ grokState: newState, grokMode: mode });
    }

    // Ensure content script is injected, then send message
    const tabId = tab.id;
    try {
      // Try injecting the script programmatically in case it wasn't auto-injected
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/grok.js'],
      });
    } catch {
      // Script may already be injected, ignore injection errors
    }

    // Small delay to ensure script is initialized
    await new Promise(r => setTimeout(r, 500));

    // Send message with error handling and retry
    const sendWithRetry = async (retries: number): Promise<boolean> => {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await chrome.tabs.sendMessage(tabId, {
            action: 'startGrokQueue',
            animationImages: mode === 'animation' ? animationImages : undefined,
          });
          if (response?.success) {
            console.log('[GrokAutomator] Content script respondeu:', response);
            return true;
          }
          console.warn('[GrokAutomator] Content script respondeu sem sucesso:', response);
        } catch (err) {
          console.warn(`[GrokAutomator] Tentativa ${i + 1}/${retries} falhou:`, err);
          if (i < retries - 1) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }
      return false;
    };

    const ok = await sendWithRetry(3);
    if (!ok) {
      console.error('[GrokAutomator] Falha ao enviar mensagem para content script');
      setGrokState(prev => ({ ...prev, isRunning: false, status: 'error' }));
      saveStateToStorage({ grokState: { ...newState, isRunning: false, status: 'error', lastError: 'Content script não respondeu' } });
    }
  };

  const handleStop = () => {
    chrome.storage.local.set({ grokShouldStop: true });
    setGrokState(prev => ({ ...prev, isRunning: false, status: 'paused' }));
  };

  const handleReset = () => {
    const newState: GrokState = {
      isRunning: false,
      currentIndex: 0,
      totalPrompts: 0,
      status: 'idle'
    };
    setGrokState(newState);
    setBaseImage(null);
    setTextareaValue("");
    setPrompts([]);
    setAnimationImages([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (animFilesInputRef.current) animFilesInputRef.current.value = '';
    chrome.storage.local.remove(['grokState', 'grokShouldStop', 'grokBaseImage', 'grokTextarea', 'grokPrompts', 'grokAnimationImages']);
  };

  const progress = grokState.totalPrompts > 0
    ? (grokState.currentIndex / grokState.totalPrompts) * 100
    : 0;

  const canStart = mode === 'creation' 
    ? (!!baseImage && prompts.length > 0) 
    : (animationImages.length > 0);

  return (
    <div className={styles.container}>
      <div className={styles.card}>
      
        {/* Header Platform */}
        <div>
          <label className={styles.label}>
            Plataforma
          </label>
          <a href="https://grok.com/imagine" target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
            <div className={styles.linkContent}>
              <div className={styles.iconBox}>
                <Video className={styles.icon} />
              </div>
              <div className={styles.linkText}>
                <span className={styles.linkTitle}>Grok Automator</span>
                <span className={styles.linkSubtitle}>grok.com/imagine</span>
              </div>
            </div>
            <LinkIcon className={styles.linkArrow} />
          </a>
        </div>

        {/* Mode Toggle */}
        <div>
          <label className={styles.label}>Modo de Operação</label>
          <div className={styles.modeToggle}>
            <button
              className={`${styles.modeBtn} ${mode === 'animation' ? styles.modeBtnActive : ''}`}
              onClick={() => handleModeChange('animation')}
              disabled={grokState.isRunning}
            >
              <Film className={styles.modeBtnIcon} />
              Só Animação
            </button>
            <button
              className={`${styles.modeBtn} ${mode === 'creation' ? styles.modeBtnActive : ''}`}
              onClick={() => handleModeChange('creation')}
              disabled={grokState.isRunning}
            >
              <ImagePlus className={styles.modeBtnIcon} />
              Criação + Animação
            </button>
          </div>
        </div>

        {/* ========================== */}
        {/* ANIMATION MODE UI          */}
        {/* ========================== */}
        {mode === 'animation' && (
          <>
            <div className={styles.fileInputWrapper}>
              <label className={styles.label}>Imagens para Animar ({animationImages.length})</label>
              
              {animationImages.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '8px' }}>
                  {animationImages.map((item, i) => (
                    <div key={i} style={{ position: 'relative', borderRadius: '6px', overflow: 'hidden', border: '1px solid #333', aspectRatio: '1' }}>
                      <img src={item.dataUrl} alt={item.filename} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <button
                        onClick={() => removeAnimationImage(i)}
                        disabled={grokState.isRunning}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '3px', padding: '2px', cursor: 'pointer', color: 'white', lineHeight: 0 }}
                      >
                        <Trash2 size={12} />
                      </button>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', fontSize: '9px', color: '#ccc', textAlign: 'center', padding: '1px 0' }}>
                        {item.filename.match(/^(\d+)/)?.[1] ?? (i + 1)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.uploadArea}>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  ref={animFilesInputRef}
                  onChange={handleAnimationImagesSelect}
                  disabled={grokState.isRunning}
                  className={styles.hiddenInput}
                  id="anim-file-upload"
                />
                <label htmlFor="anim-file-upload" className={`${styles.uploadLabel} ${grokState.isRunning ? styles.disabled : ''}`} style={{ minHeight: animationImages.length > 0 ? '60px' : '100px' }}>
                  <FileImage className={styles.uploadIcon} style={{ width: '1.5rem', height: '1.5rem', marginBottom: '0.5rem' }} />
                  <span className={styles.uploadText}>Clique para adicionar imagens</span>
                </label>
              </div>

              {animationImages.length > 0 && (
                <button 
                  onClick={clearAnimationImages} 
                  disabled={grokState.isRunning}
                  style={{ marginTop: '6px', width: '100%', padding: '6px', background: 'transparent', border: '1px solid #444', color: '#94a3b8', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
                >
                  Limpar todas as imagens
                </button>
              )}
            </div>
          </>
        )}

        {/* ========================== */}
        {/* CREATION MODE UI           */}
        {/* ========================== */}
        {mode === 'creation' && (
          <>
            {/* Image DropZone */}
            <div className={styles.fileInputWrapper}>
              <label className={styles.label}>Imagem Base (Referência)</label>
              {baseImage ? (
                <div style={{ position: 'relative', width: '100%', borderRadius: '8px', overflow: 'hidden', border: '1px solid #333' }}>
                  <img src={baseImage} alt="Base" style={{ width: '100%', display: 'block' }} />
                  <button 
                    onClick={removeImage} 
                    disabled={grokState.isRunning}
                    style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '4px', padding: '4px', cursor: 'pointer', color: 'white' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : (
                <div className={styles.uploadArea}>
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                    disabled={grokState.isRunning}
                    className={styles.hiddenInput}
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className={`${styles.uploadLabel} ${grokState.isRunning ? styles.disabled : ''}`}>
                    <FileImage className={styles.uploadIcon} />
                    <span className={styles.uploadText}>Clique para selecionar imagem</span>
                  </label>
                </div>
              )}
            </div>

            {/* Textarea Prompts */}
            <div>
              <label className={styles.label}>Fila de Prompts</label>
              <textarea 
                value={textareaValue}
                onChange={handleTextareaChange}
                disabled={grokState.isRunning}
                style={{ width: '100%', height: '80px', padding: '8px', borderRadius: '8px', border: '1px solid #333', background: '#1c1c1c', color: '#fff', fontSize: '12px', resize: 'vertical', boxSizing: 'border-box' }}
                placeholder="Cole o roteiro com marcações [1] [Intro] ..."
              />
              <button 
                onClick={handleParsePrompts} 
                disabled={grokState.isRunning || !textareaValue.trim()}
                style={{ marginTop: '8px', width: '100%', padding: '8px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
              >
                PROCESSAR PROMPTS
              </button>
            </div>

            {/* Prompts List */}
            {prompts.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label className={styles.label} style={{ margin: 0 }}>Prompts Encontrados ({prompts.length})</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => selectAll(true)} disabled={grokState.isRunning} style={{ fontSize: '10px', background: 'transparent', border: '1px solid #444', color: '#ccc', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}>Todos Anim</button>
                    <button onClick={() => selectAll(false)} disabled={grokState.isRunning} style={{ fontSize: '10px', background: 'transparent', border: '1px solid #444', color: '#ccc', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}>Nenhum Anim</button>
                  </div>
                </div>
                <div style={{ maxHeight: '150px', overflowY: 'auto', background: '#1c1c1c', border: '1px solid #333', borderRadius: '8px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {prompts.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '4px', background: i === grokState.currentIndex ? '#2a2a2a' : 'transparent', borderRadius: '4px' }}>
                      <input type="checkbox" checked={p.animate} onChange={() => toggleAnimate(i)} disabled={grokState.isRunning} style={{ marginTop: '4px' }} />
                      <div style={{ fontSize: '11px', color: '#ccc', flex: 1 }}>
                        <strong style={{ color: '#fff' }}>[{p.id}]</strong> {p.key} {p.duration ? `(${p.duration})` : ''} - {p.cleanPrompt}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Status Bar */}
        {grokState.status !== 'idle' && (
          <div className={styles.statusBar} style={{ marginTop: '0' }}>
            <div className={styles.statusHeader}>
              <div className={styles.statusLeft}>
                {grokState.status === 'processing' && <Loader2 className={`${styles.statusIcon} ${styles.processing}`} />}
                {grokState.status === 'completed' && <CheckCircle2 className={`${styles.statusIcon} ${styles.completed}`} />}
                {grokState.status === 'error' && <AlertCircle className={`${styles.statusIcon} ${styles.error}`} />}
                {grokState.status === 'paused' && <Pause className={`${styles.statusIcon} ${styles.paused}`} />}
                <span className={styles.statusText}>
                  {grokState.status === 'processing' ? 'Processando...' : grokState.status === 'completed' ? 'Finalizado' : grokState.status === 'error' ? 'Erro' : 'Pausado'}
                </span>
              </div>
              <span className={styles.statusCounter}>
                {grokState.currentIndex} / {grokState.totalPrompts}
              </span>
            </div>
            
            <div className={styles.progressBarContainer}>
              <div
                className={`${styles.progressBar} ${grokState.status === 'completed' ? styles.completed : grokState.status === 'error' ? styles.error : styles.processing}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

      </div>

      <div className={styles.footer}>
        {!grokState.isRunning ? (
          <button onClick={handleStart} disabled={!canStart} className={styles.btnPrimary}>
            <Play className={styles.actionIcon} /> INICIAR FILA
          </button>
        ) : (
          <button onClick={handleStop} className={styles.btnSecondary}>
            <Pause className={styles.actionIcon} /> PAUSAR
          </button>
        )}
        <button onClick={handleReset} disabled={grokState.isRunning} className={styles.btnIcon} title="Resetar">
          <Trash2 className={styles.trashIcon} />
        </button>
      </div>
    </div>
  );
};

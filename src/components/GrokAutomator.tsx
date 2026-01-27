

import { useState, useRef, useEffect } from "react";
import { Play, Pause, Trash2, Video, CheckCircle2, AlertCircle, Loader2, Link as LinkIcon, FileVideo } from "lucide-react";
import styles from './GrokAutomator.module.css';

interface GrokState {
  isRunning: boolean;
  currentIndex: number;
  totalFiles: number;
  currentFile: string;
  status: 'idle' | 'processing' | 'completed' | 'error' | 'paused';
}

export const GrokAutomator = () => {
  const [upscale, setUpscale] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [grokState, setGrokState] = useState<GrokState>({
    isRunning: false,
    currentIndex: 0,
    totalFiles: 0,
    currentFile: '',
    status: 'idle'
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load state from storage
    chrome.storage.local.get(['grokState', 'grokUpscale'], (result: { grokState?: GrokState; grokUpscale?: boolean }) => {
      if (result.grokState) setGrokState(result.grokState);
      if (result.grokUpscale) setUpscale(result.grokUpscale);
    });

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.grokState?.newValue) {
        setGrokState(changes.grokState.newValue as GrokState);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const files = Array.from(event.target.files).sort((a, b) => a.name.localeCompare(b.name));
      setSelectedFiles(files);
    }
  };

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleStart = async () => {
    if (selectedFiles.length === 0) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('grok.com')) {
      chrome.tabs.create({ url: 'https://grok.com/imagine' });
      return;
    }

    setGrokState(prev => ({ ...prev, isRunning: true, status: 'processing', totalFiles: selectedFiles.length }));
    await chrome.storage.local.set({ grokUpscale: upscale });

    // Process files to send to content script
    const filesData = await Promise.all(selectedFiles.map(async (file) => ({
      name: file.name,
      type: file.type,
      dataUrl: await readFileAsDataURL(file)
    })));

    chrome.tabs.sendMessage(tab.id!, {
      action: 'startGrokQueue',
      files: filesData,
      upscale
    });
  };

  const handleStop = () => {
    chrome.storage.local.set({ grokShouldStop: true });
    setGrokState(prev => ({ ...prev, isRunning: false, status: 'paused' }));
  };

  const handleReset = () => {
    setGrokState({
      isRunning: false,
      currentIndex: 0,
      totalFiles: 0,
      currentFile: '',
      status: 'idle'
    });
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    chrome.storage.local.remove(['grokState', 'grokShouldStop']);
  };

  const progress = grokState.totalFiles > 0
    ? (grokState.currentIndex / grokState.totalFiles) * 100
    : 0;

  return (
    <div className={styles.container}>

      {/* HEADER CARD */}
      <div className={styles.card}>

        {/* External Link */}
        <div>
          <label className={styles.label}>
            Plataforma
          </label>
          <a
            href="https://grok.com/imagine"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.externalLink}
          >
            <div className={styles.linkContent}>
              <div className={styles.iconBox}>
                <Video className={styles.icon} />
              </div>
              <div className={styles.linkText}>
                <span className={styles.linkTitle}>
                  Grok Animator
                </span>
                <span className={styles.linkSubtitle}>
                  grok.com/imagine
                </span>
              </div>
            </div>
            <LinkIcon className={styles.linkArrow} />
          </a>
        </div>

        {/* File Input */}
        <div className={styles.fileInputWrapper}>
          <label className={styles.label}>
            Arquivos de Entrada
          </label>
          <div className={styles.uploadArea}>
            <input
              type="file"
              multiple
              accept="image/*"
              ref={fileInputRef}
              onChange={handleFileSelect}
              disabled={grokState.isRunning}
              className={styles.hiddenInput}
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className={`${styles.uploadLabel} ${selectedFiles.length > 0 ? styles.active : ''} ${grokState.isRunning ? styles.disabled : ''}`}
            >
              <FileVideo className={`${styles.uploadIcon} ${selectedFiles.length > 0 ? styles.active : ''}`} />
              <span className={styles.uploadText}>
                {selectedFiles.length > 0
                  ? `${selectedFiles.length} arquivos selecionados`
                  : 'Clique para selecionar imagens'}
              </span>
              {selectedFiles.length > 0 && (
                <span className={styles.uploadSubtext}>
                  Prontos para fila
                </span>
              )}
            </label>
          </div>
        </div>

        {/* Options */}
        <div>
          <label className={styles.checkboxLabel}>
            <div className={styles.checkboxWrapper}>
              <input
                type="checkbox"
                checked={upscale}
                onChange={(e) => setUpscale(e.target.checked)}
                disabled={grokState.isRunning}
                className={styles.checkbox}
              />
              <CheckCircle2 className={styles.checkIcon} strokeWidth={3} />
            </div>
            <div className={styles.checkboxText}>
              <span className={styles.checkboxTitle}>Aguardar Upscale (HD)</span>
              <span className={styles.checkboxSubtitle}>Gera vídeos em alta definição (demora mais)</span>
            </div>
          </label>
        </div>

        {/* Status Bar */}
        {grokState.status !== 'idle' && (
          <div className={styles.statusBar}>
            <div className={styles.statusHeader}>
              <div className={styles.statusLeft}>
                {grokState.status === 'processing' && <Loader2 className={`${styles.statusIcon} ${styles.processing}`} />}
                {grokState.status === 'completed' && <CheckCircle2 className={`${styles.statusIcon} ${styles.completed}`} />}
                {grokState.status === 'error' && <AlertCircle className={`${styles.statusIcon} ${styles.error}`} />}
                {grokState.status === 'paused' && <Pause className={`${styles.statusIcon} ${styles.paused}`} />}

                <span className={styles.statusText}>
                  {grokState.status === 'processing' ? 'Processando...' :
                    grokState.status === 'completed' ? 'Finalizado' :
                      grokState.status === 'error' ? 'Erro' : 'Pausado'}
                </span>
              </div>
              <span className={styles.statusCounter}>
                {grokState.currentIndex} / {grokState.totalFiles}
              </span>
            </div>

            {/* Log Message */}
            <div className={styles.logMessage}>
              {grokState.currentFile ? `>> ${grokState.currentFile}` : 'Aguardando...'}
            </div>

            <div className={styles.progressBarContainer}>
              <div
                className={`${styles.progressBar} ${grokState.status === 'completed' ? styles.completed :
                  grokState.status === 'error' ? styles.error :
                    styles.processing
                  }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

      </div>

      {/* Footer Actions */}
      <div className={styles.footer}>
        {!grokState.isRunning ? (
          <button
            onClick={handleStart}
            disabled={selectedFiles.length === 0}
            className={styles.btnPrimary}
          >
            <Play className={styles.actionIcon} />
            INICIAR FILA
          </button>
        ) : (
          <button
            onClick={handleStop}
            className={styles.btnSecondary}
          >
            <Pause className={styles.actionIcon} />
            PAUSAR
          </button>
        )}

        <button
          onClick={handleReset}
          disabled={grokState.isRunning}
          className={styles.btnIcon}
          title="Resetar"
        >
          <Trash2 className={styles.trashIcon} />
        </button>

      </div>
    </div>
  );
};

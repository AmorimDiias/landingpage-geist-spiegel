import React, { useState, useEffect } from 'react';
import { X, Settings, Loader2, AlertCircle } from 'lucide-react';
import { generateReply } from '../services/aiService';
import { fetchTranscript } from '../services/youtubeService';
import { GlobalSettings } from './GlobalSettings';

interface AIReplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  commentText: string;
  videoId: string;
  videoTitle: string;
  parentElement: HTMLElement;
}

export const AIReplyModal: React.FC<AIReplyModalProps> = ({
  isOpen,
  onClose,
  commentText,
  videoId,
  videoTitle,
  parentElement
}) => {
  const [status, setStatus] = useState('Iniciando...');
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || showSettings) return;

    let isMounted = true;

    const runAutomation = async () => {
      setError(null);
      if (isMounted) setStatus('Lendo configurações...');

      try {
        // 1. Get Global Prompt
        const globalPrompt = await new Promise<string>((resolve) => {
          chrome.storage.local.get(['globalPrompt'], (result: { globalPrompt?: string }) => {
            resolve(result.globalPrompt || 'Aja como um criador de conteúdo profissional. Seja breve e gentil.');
          });
        });

        if (!isMounted) return;

        // 2. Fetch Context
        if (isMounted) setStatus('Analisando vídeo...');
        let transcript = '';
        try {
          transcript = await fetchTranscript(videoId);
        } catch (e) {
          console.warn('AI Suite: Transcript fetch failed, proceeding without it.', e);
          transcript = '(Legendas indisponíveis. Responda baseando-se apenas no comentário e título do vídeo)';
        }

        if (!isMounted) return;

        // 3. Generate
        if (isMounted) setStatus('Gerando resposta mágica...');
        const reply = await generateReply(transcript, commentText, globalPrompt, videoTitle);

        if (!isMounted) return;

        // 4. Dispatch Insert Event
        if (isMounted) setStatus('Finalizando...');

        // Delay visual para UX
        setTimeout(() => {
          if (!isMounted) return;

          const event = new CustomEvent('ai-suite-insert', {
            detail: { text: reply, triggerElement: parentElement }
          });
          window.dispatchEvent(event);

          // 5. Close
          onClose();
        }, 800);

      } catch (err: unknown) {
        if (!isMounted) return;
        console.error('AI Suite Automation Error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Falha na geração da resposta.';
        setError(errorMessage);
        setStatus('Erro');
      }
    };

    runAutomation();

    return () => {
      isMounted = false;
    };
  }, [isOpen, showSettings, videoId, videoTitle, commentText, parentElement, onClose]);

  const handleRetry = () => {
    // Force re-run by toggling settings or just calling logic if extracted, 
    // but simpler to close/open or just implement a state trigger. 
    // Since effect depends on showSettings, we can toggle it or just reset error state if we extract logic.
    // For now, let's just use a trick or reload.
    setError(null);
    // Trigger effect by unmounting/mounting or simple state hack? 
    // Actually, simply resetting error isn't enough as effect runs on dep change. 
    // Let's effectively "reload" by calling onClose then user clicks again? No, bad UX.
    // We can extract logic to a function inside component but outside effect? No, dep warnings.
    // Easiest: Close and ask user to click again, or better: 
    // We can have a render-key or explicit trigger count.
    window.dispatchEvent(new CustomEvent('ai-suite-open', {
      detail: { commentText, videoId, videoTitle, triggerElement: parentElement }
    })); // Re-trigger event? No, that just updates state in parent.

    // Simplest: Just close it. The user will click again.
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed z-[9999] top-20 right-20 w-[350px] font-sans text-slate-300">
      <div className="ai-suite-card p-5 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in duration-200 border border-slate-700 bg-slate-900 rounded-xl relative overflow-hidden">

        {/* Decorative Background */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#6b4fe0] to-[#3c82f6]"></div>

        {/* Content Area */}
        {showSettings ? (
          <div className="relative z-10">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-white text-sm">Configurações</h3>
              <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-slate-800 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <GlobalSettings onClose={() => { setShowSettings(false); }} />
          </div>
        ) : (
          <div className="relative z-10 flex flex-col items-center justify-center text-center gap-4 py-2">

            {/* Header Actions (Absolute) */}
            <div className="absolute top-0 right-0 flex gap-1">
              {error && (
                <button onClick={() => setShowSettings(true)} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition" title="Configurações">
                  <Settings className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition" title="Cancelar">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {error ? (
              <div className="w-full">
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="w-6 h-6 text-red-400" />
                </div>
                <p className="text-red-300 font-medium text-sm mb-1">{error}</p>
                <p className="text-slate-500 text-xs mb-4">Verifique sua conexão ou tokens.</p>
                <button
                  onClick={handleRetry}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-xs font-medium transition"
                >
                  Fechar e Tentar Novamente
                </button>
              </div>
            ) : (
              <>
                <div className="relative mt-2">
                  <div className="absolute inset-0 bg-[#6b4fe0] blur-2xl opacity-20 animate-pulse"></div>
                  <div className="relative bg-slate-800/50 p-3 rounded-full ring-1 ring-white/10">
                    <Loader2 className="w-6 h-6 text-[#6b4fe0] animate-spin" />
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-white font-semibold text-sm animate-pulse">{status}</h3>
                  <p className="text-slate-500 text-[11px] max-w-[220px] truncate mx-auto">{videoTitle}</p>
                </div>

                {/* Progress Bar Visual */}
                <div className="w-32 h-1 bg-slate-800 rounded-full overflow-hidden mt-2">
                  <div className="h-full bg-gradient-to-r from-[#6b4fe0] to-[#3c82f6] w-full origin-left animate-[shimmer_2s_infinite]"></div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

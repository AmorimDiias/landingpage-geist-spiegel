import { useState, useEffect } from 'react';
import puter from './lib/puter-web';
import './App.css';
import { Zap, HelpCircle, LogIn, CheckCircle2, AlertCircle, FileText, Image, MessageSquare, Loader2, Video } from 'lucide-react';
import { ImageFXAutomator } from './components/ImageFXAutomator';
import { GrokAutomator } from './components/GrokAutomator';

type ActiveTab = 'youtube' | 'imagefx' | 'grok';

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('youtube');
  const [globalPrompt, setGlobalPrompt] = useState('Aja como um canal profissional do YouTube.');
  const [generationMode, setGenerationMode] = useState<'simple' | 'full'>('simple');
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'' | 'saved'>('');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    // Load Settings
    chrome.storage.local.get(['globalPrompt', 'generationMode'], (result: { globalPrompt?: string, generationMode?: 'simple' | 'full' }) => {
      if (result.globalPrompt) {
        setGlobalPrompt(result.globalPrompt);
      }
      if (result.generationMode) {
        setGenerationMode(result.generationMode);
      }
    });

    // Check Auth
    // Puter is loaded via npm bundle now
    if (!window.puter) {
      window.puter = puter;
    }

    // Robust Auth Check
    const checkAuthStatus = () => {
      // Wait for puter to be injected
      if (window.puter && window.puter.auth) {
        const signedIn = window.puter.auth.isSignedIn();
        setIsAuthenticated(signedIn);

        // Sync auth token to Background Script via chrome.storage.local
        if (signedIn) {
          const dump: Record<string, string> = {};
          // Sync all localStorage keys to ensure Puter token is passed
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) dump[k] = localStorage.getItem(k) || '';
          }

          // Salva explicitamente o token do Puter
          if (window.puter.authToken) {
            dump['puter.auth.token'] = window.puter.authToken;
          }

          chrome.storage.local.set(dump);
          console.log('[AI Suite] Token sincronizado com background script');
        }
      } else {
        console.warn("Puter not ready yet");
        setIsAuthenticated(false);
      }
    };

    // Initial check
    checkAuthStatus();

    // Poll for changes/loading
    const interval = setInterval(checkAuthStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const updateGenerationMode = (mode: 'simple' | 'full') => {
    setGenerationMode(mode);
    chrome.storage.local.set({ generationMode: mode }, () => {
      console.log('[AI Suite] Modo de geração salvo:', mode);
    });
  };


  const handleSave = () => {
    setLoading(true);
    chrome.storage.local.set({ globalPrompt, generationMode }, () => {
      setLoading(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2000);
    });
  };

  const handleLogin = async () => {
    try {
      await window.puter.auth.signIn();
      setIsAuthenticated(true);
    } catch (e) {
      console.error('Login failed', e);
    }
  };

  return (
    <div className="font-sans text-slate-200 p-5 min-h-[450px] flex flex-col gap-5 bg-[#0b0f19] selection:bg-[#6b4fe0]/30 selection:text-white">
      {/* Header Premium */}
      <div className="flex items-center gap-4">
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-tr from-[#6b4fe0] to-[#3c82f6] rounded-xl blur opacity-40 group-hover:opacity-60 transition-opacity duration-300" />
          <div className="relative p-2.5 bg-[#1e293b] rounded-xl border border-slate-700/50 shadow-xl">
            <Zap className="w-5 h-5 text-transparent bg-clip-text bg-gradient-to-tr from-[#6b4fe0] to-[#3c82f6] fill-[#6b4fe0]" />
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-xl text-white tracking-tight leading-none">
              AI Suite
            </h1>
            <span className="text-[10px] font-bold text-[#6b4fe0] bg-[#6b4fe0]/10 border border-[#6b4fe0]/20 px-1.5 py-0.5 rounded tracking-wider uppercase">
              Extension
            </span>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-0.5">
            Seu copiloto inteligente
          </p>
        </div>
        <div className="ml-auto">
          {activeTab === 'youtube' && (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider shadow-sm transition-all ${isAuthenticated
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-emerald-900/20'
              : 'bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-rose-900/20'
              }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isAuthenticated ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {isAuthenticated ? 'Conectado' : 'Desconectado'}
            </div>
          )}
        </div>
      </div>

      {/* Modern Navigation Tabs */}
      <div className="p-1 bg-slate-900/60 rounded-xl border border-slate-800/60 flex shrink-0 relative overflow-hidden backdrop-blur-sm">
        <button
          onClick={() => setActiveTab('youtube')}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold uppercase tracking-wide transition-all duration-300 ${activeTab === 'youtube'
            ? 'text-white shadow-lg'
            : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
            }`}
        >
          {activeTab === 'youtube' && (
            <div className="absolute inset-0 bg-gradient-to-r from-[#6b4fe0] to-[#3c82f6] rounded-lg -z-10 animate-in zoom-in-95 duration-200" />
          )}
          <MessageSquare className={`w-3.5 h-3.5 ${activeTab === 'youtube' ? 'text-white' : 'text-slate-500'}`} />
          YouTube
        </button>
        <button
          onClick={() => setActiveTab('imagefx')}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold uppercase tracking-wide transition-all duration-300 ${activeTab === 'imagefx'
            ? 'text-white shadow-lg'
            : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
            }`}
        >
          {activeTab === 'imagefx' && (
            <div className="absolute inset-0 bg-gradient-to-r from-[#6b4fe0] to-[#3c82f6] rounded-lg -z-10 animate-in zoom-in-95 duration-200" />
          )}
          <Image className={`w-3.5 h-3.5 ${activeTab === 'imagefx' ? 'text-white' : 'text-slate-500'}`} />
          ImageFX
        </button>
        <button
          onClick={() => setActiveTab('grok')}
          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold uppercase tracking-wide transition-all duration-300 ${activeTab === 'grok'
            ? 'text-white shadow-lg'
            : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
            }`}
        >
          {activeTab === 'grok' && (
            <div className="absolute inset-0 bg-gradient-to-r from-[#6b4fe0] to-[#3c82f6] rounded-lg -z-10 animate-in zoom-in-95 duration-200" />
          )}
          <Video className={`w-3.5 h-3.5 ${activeTab === 'grok' ? 'text-white' : 'text-slate-500'}`} />
          Grok
        </button>
      </div>

      {/* CONTENT AREA */}
      <div className="flex-1 min-h-0 relative">
        {/* YouTube Assistant Content */}
        {activeTab === 'youtube' && (
          <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* Login Action (if needed) */}
            {isAuthenticated === false && (
              <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl p-4 flex flex-col gap-3 shadow-lg shadow-rose-900/10">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-rose-900/30 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-rose-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-rose-200">Autenticação Necessária</h3>
                    <p className="text-xs text-rose-300/80 mt-1 leading-relaxed">
                      Conecte sua conta Puter.js para desbloquear o poder da IA nos comentários.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleLogin}
                  className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white transition-all py-2.5 rounded-lg text-xs font-bold uppercase tracking-wide shadow-lg shadow-rose-900/20 active:scale-[0.98]"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Conectar Agora
                </button>
              </div>
            )}

            {/* Settings Section */}
            <div className="space-y-4">
              {/* Seção Modo de Geração */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">
                  Modo de Inteligência
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {/* Card Rápido */}
                  {/* Card Rápido */}
                  <button
                    onClick={() => updateGenerationMode('simple')}
                    className={`relative p-4 rounded-xl border text-left transition-all duration-300 overflow-hidden group hover:-translate-y-0.5 ${generationMode === 'simple'
                      ? 'border-[#6b4fe0] bg-[#6b4fe0]/10 shadow-[0_0_20px_-5px_rgba(107,79,224,0.3)]'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-800/60'
                      }`}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br from-[#6b4fe0]/20 to-transparent opacity-0 transition-opacity duration-500 ${generationMode === 'simple' ? 'opacity-100' : 'group-hover:opacity-50'}`} />

                    <div className="relative z-10 flex items-center gap-2.5 mb-2">
                      <div className={`p-1.5 rounded-lg transition-colors ${generationMode === 'simple' ? 'bg-[#6b4fe0] text-white shadow-lg shadow-[#6b4fe0]/40' : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700'}`}>
                        <Zap className="w-3.5 h-3.5" />
                      </div>
                      <span className={`text-xs font-bold uppercase tracking-wide transition-colors ${generationMode === 'simple' ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}>Rápido</span>
                    </div>
                    <p className={`relative z-10 text-[10px] leading-relaxed font-medium transition-colors ${generationMode === 'simple' ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-400'}`}>
                      Respostas ágeis baseadas apenas no contexto visual do comentário.
                    </p>
                  </button>

                  {/* Card Contexto Total */}
                  <button
                    onClick={() => updateGenerationMode('full')}
                    className={`relative p-4 rounded-xl border text-left transition-all duration-300 overflow-hidden group hover:-translate-y-0.5 ${generationMode === 'full'
                      ? 'border-[#3c82f6] bg-[#3c82f6]/10 shadow-[0_0_20px_-5px_rgba(60,130,246,0.3)]'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-800/60'
                      }`}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br from-[#3c82f6]/20 to-transparent opacity-0 transition-opacity duration-500 ${generationMode === 'full' ? 'opacity-100' : 'group-hover:opacity-50'}`} />

                    <div className="relative z-10 flex items-center gap-2.5 mb-2">
                      <div className={`p-1.5 rounded-lg transition-colors ${generationMode === 'full' ? 'bg-[#3c82f6] text-white shadow-lg shadow-[#3c82f6]/40' : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700'}`}>
                        <FileText className="w-3.5 h-3.5" />
                      </div>
                      <span className={`text-xs font-bold uppercase tracking-wide transition-colors ${generationMode === 'full' ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}>Profundo</span>
                    </div>
                    <p className={`relative z-10 text-[10px] leading-relaxed font-medium transition-colors ${generationMode === 'full' ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-400'}`}>
                      Analisa a transcrição completa do vídeo para respostas ricas.
                    </p>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">
                  Persona do Canal (System Prompt)
                </label>
                <div className="relative group">
                  <textarea
                    value={globalPrompt}
                    onChange={(e) => setGlobalPrompt(e.target.value)}
                    className="w-full h-32 bg-black/20 border border-slate-700 rounded-xl p-4 text-sm text-slate-300 focus:text-white placeholder-slate-600 resize-none outline-none transition-all duration-300 focus:border-[#6b4fe0] focus:bg-slate-900/60 focus:shadow-[0_0_0_2px_rgba(107,79,224,0.15)] scrollbar-thin scrollbar-thumb-slate-700"
                    placeholder="Defina a personalidade da IA..."
                  />
                  <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <span className="text-[10px] text-slate-600 font-mono">{globalPrompt.length} chars</span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleSave}
                disabled={loading}
                className={`w-full py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 relative overflow-hidden group ${saveStatus === 'saved'
                  ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                  : 'bg-transparent text-slate-300 border border-slate-700 hover:text-white hover:border-[#6b4fe0]/60'
                  }`}
              >
                {/* Efeito de brilho no hover */}
                {saveStatus !== 'saved' && (
                  <div className="absolute inset-0 bg-gradient-to-r from-[#6b4fe0]/10 to-[#3c82f6]/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                )}

                {/* Conteúdo */}
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" /> : saveStatus === 'saved' ? <CheckCircle2 className="w-3.5 h-3.5 relative z-10" /> : null}
                <span className="relative z-10 flex items-center gap-2">
                  {loading ? 'SINCRONIZANDO...' : saveStatus === 'saved' ? 'CONFIGURAÇÕES SALVAS!' : 'SALVAR PREFERÊNCIAS'}
                </span>
              </button>
            </div>

            {/* Help Footer */}
            <div className="mt-4 pt-4 border-t border-slate-800/50">
              <div className="flex items-start gap-3 text-xs text-slate-400 bg-slate-900/40 p-3 rounded-xl border border-slate-800">
                <div className="p-1 bg-slate-800 rounded-md shrink-0">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="leading-relaxed">
                  <strong className="text-slate-200 block mb-0.5">Como usar no YouTube?</strong>
                  Vá para o <strong>YouTube Studio &gt; Comentários</strong>. Procure pelo ícone <Zap className="w-3 h-3 inline text-[#6b4fe0] mx-0.5 align-text-bottom" /> ao lado do botão "Responder".
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ImageFX Automator Content */}
        {activeTab === 'imagefx' && <ImageFXAutomator />}

        {/* Grok Automator Content */}
        {activeTab === 'grok' && <GrokAutomator />}
      </div>
    </div>
  )
}

export default App


import { useState, useEffect } from 'react';
import puter from './lib/puter-web';
import './App.css';
import { Zap, HelpCircle, LogIn, CheckCircle2, AlertCircle, FileText } from 'lucide-react';


function App() {
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
    <div className="font-sans text-slate-200 p-4 min-h-[400px] flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 pb-4">
        <div className="p-2 bg-gradient-to-tr from-[#6b4fe0] to-[#3c82f6] rounded-xl shadow-lg shadow-blue-900/20">
          <Zap className="w-5 h-5 text-white fill-white" />
        </div>
        <div>
          <h1 className="font-bold text-lg text-white leading-tight">AI Suite</h1>
          <p className="text-xs text-slate-500">YouTube Assistant</p>
        </div>
        <div className="ml-auto">
          {isAuthenticated === true && (
            <span className="flex items-center gap-1 text-[10px] bg-green-500/10 text-green-400 px-2 py-1 rounded-full border border-green-500/20">
              <CheckCircle2 className="w-3 h-3" />
              Connected
            </span>
          )}
          {isAuthenticated === false && (
            <span className="flex items-center gap-1 text-[10px] bg-red-500/10 text-red-400 px-2 py-1 rounded-full border border-red-500/20">
              <AlertCircle className="w-3 h-3" />
              Not Connected
            </span>
          )}
        </div>
      </div>

      {/* Login Action (if needed) */}
      {isAuthenticated === false && (
        <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-3 flex flex-col gap-2">
          <p className="text-xs text-red-200/80">
            Você precisa conectar sua conta Puter.js para usar a IA.
          </p>
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-2 bg-white text-black hover:bg-slate-200 transition py-1.5 rounded-md text-sm font-medium"
          >
            <LogIn className="w-4 h-4" />
            Conectar Conta
          </button>
        </div>
      )}

      {/* Settings Section */}
      <div className="flex-1 flex flex-col gap-2">

        {/* Seção Modo de Geração */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
            Modo de Geração
          </label>
          <div className="grid grid-cols-2 gap-2">
            {/* Card Rápido */}
            <button
              onClick={() => updateGenerationMode('simple')}
              className={`p-3 rounded-lg border text-left transition-all relative overflow-hidden group ${generationMode === 'simple'
                ? 'border-[#6b4fe0] bg-[#6b4fe0]/10 ring-1 ring-[#6b4fe0]/50'
                : 'border-slate-800 bg-slate-900/50 hover:bg-slate-800 hover:border-slate-700'
                }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className={`p-1.5 rounded-md ${generationMode === 'simple' ? 'bg-[#6b4fe0]/20 text-[#6b4fe0]' : 'bg-slate-800 text-slate-400'}`}>
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <span className={`text-sm font-medium ${generationMode === 'simple' ? 'text-white' : 'text-slate-300'}`}>Rápido</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">
                Resposta instantânea baseada no título e comentário.
              </p>
            </button>

            {/* Card Contexto Total */}
            <button
              onClick={() => updateGenerationMode('full')}
              className={`p-3 rounded-lg border text-left transition-all relative overflow-hidden group ${generationMode === 'full'
                ? 'border-[#6b4fe0] bg-[#6b4fe0]/10 ring-1 ring-[#6b4fe0]/50'
                : 'border-slate-800 bg-slate-900/50 hover:bg-slate-800 hover:border-slate-700'
                }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className={`p-1.5 rounded-md ${generationMode === 'full' ? 'bg-[#6b4fe0]/20 text-[#6b4fe0]' : 'bg-slate-800 text-slate-400'}`}>
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <span className={`text-sm font-medium ${generationMode === 'full' ? 'text-white' : 'text-slate-300'}`}>Contexto Total</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">
                Lê a transcrição do vídeo para respostas profundas.
              </p>
            </button>
          </div>
        </div>

        <label className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
          Prompt Global do Canal
        </label>
        <textarea
          value={globalPrompt}
          onChange={(e) => setGlobalPrompt(e.target.value)}
          className="flex-1 bg-slate-900/50 border border-slate-800 rounded-lg p-3 text-sm focus:border-[#6b4fe0] outline-none text-slate-300 resize-none min-h-[120px]"
          placeholder="Defina aqui como a IA deve se comportar..."
        />
        <button
          onClick={handleSave}
          disabled={loading}
          className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
        >
          {loading ? 'Salvando...' : saveStatus === 'saved' ? 'Salvo!' : 'Salvar Configurações'}
        </button>
      </div>

      {/* Help Footer */}
      <div className="mt-auto pt-4 border-t border-white/5">
        <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-900/30 p-2 rounded-lg">
          <HelpCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p>
            Vá para o <strong>YouTube Studio &gt; Comentários</strong>. Procure pelo ícone <Zap className="w-3 h-3 inline text-[#6b4fe0]" /> ao lado do botão "Responder" ou na barra de ações.
          </p>
        </div>
      </div>
    </div>
  )
}

export default App


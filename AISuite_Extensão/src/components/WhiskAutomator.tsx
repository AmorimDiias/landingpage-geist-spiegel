import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  ExternalLink,
  Download,
  Image,
  Trash2,
  ChevronDown,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';

type DownloadMode = 'all' | 'first' | 'none';

interface ProcessingState {
  isRunning: boolean;
  currentIndex: number;
  totalPrompts: number;
  currentPrompt: string;
  status: 'idle' | 'processing' | 'completed' | 'error' | 'paused';
}

export const WhiskAutomator = () => {
  const [prompts, setPrompts] = useState('');
  const [downloadMode, setDownloadMode] = useState<DownloadMode>('first');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [processingState, setProcessingState] = useState<ProcessingState>({
    isRunning: false,
    currentIndex: 0,
    totalPrompts: 0,
    currentPrompt: '',
    status: 'idle'
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chrome.storage.local.get(['whiskPrompts', 'whiskDownloadMode', 'whiskProcessingState'], (result: {
      whiskPrompts?: string;
      whiskDownloadMode?: DownloadMode;
      whiskProcessingState?: ProcessingState;
    }) => {
      if (result.whiskPrompts) setPrompts(result.whiskPrompts);
      if (result.whiskDownloadMode) setDownloadMode(result.whiskDownloadMode);
      if (result.whiskProcessingState) setProcessingState(result.whiskProcessingState);
    });

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.whiskProcessingState?.newValue) {
        setProcessingState(changes.whiskProcessingState.newValue as ProcessingState);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const savePrompts = (value: string) => {
    setPrompts(value);
    chrome.storage.local.set({ whiskPrompts: value });
  };

  const handleDownloadModeChange = (mode: DownloadMode) => {
    setDownloadMode(mode);
    setIsDropdownOpen(false);
    chrome.storage.local.set({ whiskDownloadMode: mode });
  };

  const getPromptList = () => {
    return prompts
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);
  };

  const handleStart = async () => {
    const promptList = getPromptList();
    if (promptList.length === 0) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes('labs.google')) {
      chrome.tabs.create({ url: 'https://labs.google/fx/pt/tools/whisk/project' });
      return;
    }

    const initialState: ProcessingState = {
      isRunning: true,
      currentIndex: 0,
      totalPrompts: promptList.length,
      currentPrompt: promptList[0],
      status: 'processing'
    };

    await chrome.storage.local.set({
      whiskProcessingState: initialState,
      whiskShouldStop: false
    });
    setProcessingState(initialState);

    chrome.tabs.sendMessage(tab.id!, {
      action: 'generateWhiskImages',
      prompts: promptList,
      downloadMode
    });
  };

  const handleStop = async () => {
    await chrome.storage.local.set({
      whiskShouldStop: true,
      whiskProcessingState: { ...processingState, status: 'paused', isRunning: false }
    });
    setProcessingState(prev => ({ ...prev, status: 'paused', isRunning: false }));
  };

  const handleClear = () => {
    setPrompts('');
    setProcessingState({
      isRunning: false,
      currentIndex: 0,
      totalPrompts: 0,
      currentPrompt: '',
      status: 'idle'
    });
    chrome.storage.local.remove(['whiskPrompts', 'whiskProcessingState', 'whiskShouldStop']);
  };

  const promptCount = getPromptList().length;
  const progress = processingState.totalPrompts > 0
    ? (processingState.currentIndex / processingState.totalPrompts) * 100
    : 0;

  const downloadOptions: { value: DownloadMode; label: string; icon: React.ReactNode }[] = [
    { value: 'all', label: 'Baixar todas as imagens', icon: <Download className="w-3.5 h-3.5" /> },
    { value: 'first', label: 'Baixar apenas a primeira', icon: <Image className="w-3.5 h-3.5" /> },
    { value: 'none', label: 'Não baixar imagens', icon: <ExternalLink className="w-3.5 h-3.5" /> }
  ];

  const currentOption = downloadOptions.find(o => o.value === downloadMode)!;

  return (
    <div className="flex flex-col h-full gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl backdrop-blur-sm shadow-xl p-4 flex flex-col gap-4">

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block pl-1">
            Ferramenta
          </label>
          <a
            href="https://labs.google/fx/pt/tools/whisk/project"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative flex items-center justify-between p-3 rounded-xl border border-slate-700 bg-slate-900/50 hover:border-[#6b4fe0] transition-all duration-300"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#6b4fe0]/10 rounded-lg group-hover:bg-[#6b4fe0]/20 transition-colors">
                <Sparkles className="w-4 h-4 text-[#6b4fe0]" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-slate-200 group-hover:text-white transition-colors">
                  Google Whisk
                </span>
                <span className="text-[10px] text-slate-500 group-hover:text-[#6b4fe0] transition-colors">
                  labs.google/fx/whisk
                </span>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-slate-600 group-hover:text-[#6b4fe0] transition-colors" />
          </a>
        </div>

        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-1.5 pl-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Fila de Prompts
            </label>
            {promptCount > 0 && (
              <span className="text-[10px] font-medium text-[#6b4fe0] bg-[#6b4fe0]/10 px-2 py-0.5 rounded-full border border-[#6b4fe0]/20">
                {promptCount} {promptCount === 1 ? 'Prompt' : 'Prompts'} • {prompts.length} chars
              </span>
            )}
          </div>
          <div className="relative group flex-1">
            <textarea
              ref={textareaRef}
              value={prompts}
              onChange={(e) => savePrompts(e.target.value)}
              placeholder={"Cole seus prompts aqui...\n(Um prompt por linha)"}
              className="w-full h-32 bg-black/20 border border-slate-700 rounded-xl p-3 text-sm text-slate-300 placeholder-slate-600 outline-none resize-none focus:border-[#6b4fe0] focus:ring-1 focus:ring-[#6b4fe0]/50 transition-all leading-relaxed font-mono"
              disabled={processingState.isRunning}
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block pl-1">
            Configuração de Download
          </label>
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              disabled={processingState.isRunning}
              className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-sm font-medium ${isDropdownOpen
                ? "bg-slate-800 border-slate-600 text-white"
                : "bg-black/20 border-slate-700 text-slate-300 hover:border-slate-600"
                }`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-lg ${downloadMode !== 'none' ? 'bg-[#6b4fe0]/20 text-[#6b4fe0]' : 'bg-slate-800 text-slate-500'}`}>
                  {currentOption.icon}
                </div>
                <span>{currentOption.label}</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-[#0f172a] border border-slate-700 rounded-xl overflow-hidden z-20 shadow-2xl p-1 animate-in fade-in zoom-in-95 duration-200">
                {downloadOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleDownloadModeChange(option.value)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-xs font-medium transition-all ${downloadMode === option.value
                      ? 'bg-[#6b4fe0]/10 text-[#6b4fe0]'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                  >
                    <div className={downloadMode === option.value ? 'opacity-100' : 'opacity-50'}>
                      {option.icon}
                    </div>
                    <span>{option.label}</span>
                    {downloadMode === option.value && <CheckCircle2 className="w-3.5 h-3.5 ml-auto text-[#6b4fe0]" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {processingState.status !== 'idle' && (
          <div className="mt-2 bg-black/20 border border-slate-800 rounded-xl p-3 animate-in slide-in-from-top-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {processingState.status === 'processing' && <Loader2 className="w-3.5 h-3.5 text-[#6b4fe0] animate-spin" />}
                {processingState.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                {processingState.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-400" />}
                {processingState.status === 'paused' && <Pause className="w-3.5 h-3.5 text-amber-400" />}
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  {processingState.status === 'processing' ? 'Gerando...' :
                    processingState.status === 'completed' ? 'Finalizado' :
                      processingState.status === 'error' ? 'Erro' : 'Pausado'}
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                {processingState.currentIndex} / {processingState.totalPrompts}
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
              <div
                className={`h-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(107,79,224,0.5)] ${processingState.status === 'completed' ? 'bg-emerald-500' :
                  processingState.status === 'error' ? 'bg-rose-500' :
                    'bg-gradient-to-r from-[#6b4fe0] to-[#3c82f6]'
                  }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

      </div>

      <div className="mt-auto flex gap-3">
        {!processingState.isRunning ? (
          <button
            onClick={handleStart}
            disabled={promptCount === 0}
            className="flex-1 py-3.5 bg-gradient-to-r from-[#6b4fe0] to-[#3c82f6] text-white font-bold rounded-xl shadow-lg shadow-blue-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale disabled:hover:scale-100"
          >
            <Play className="w-4 h-4 fill-white" />
            INICIAR GERAÇÃO
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex-1 py-3.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 font-bold rounded-xl hover:bg-amber-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <Pause className="w-4 h-4 fill-current" />
            PAUSAR BLOCO
          </button>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleClear}
            disabled={processingState.isRunning}
            className="w-12 h-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:text-rose-400 hover:border-rose-500/50 hover:bg-rose-500/10 rounded-xl transition-all flex items-center justify-center disabled:opacity-50"
            title="Limpar"
          >
            <Trash2 className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              setProcessingState({
                isRunning: false,
                currentIndex: 0,
                totalPrompts: 0,
                currentPrompt: '',
                status: 'idle'
              });
              chrome.storage.local.remove(['whiskProcessingState', 'whiskShouldStop']);
            }}
            disabled={processingState.isRunning}
            className="w-12 h-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 hover:bg-slate-700 rounded-xl transition-all flex items-center justify-center disabled:opacity-50"
            title="Resetar"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>
      </div>

    </div>
  );
};

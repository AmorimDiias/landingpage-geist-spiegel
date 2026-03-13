import React, { useState, useEffect } from 'react';

interface GlobalSettingsProps {
  onClose: () => void;
}

export const GlobalSettings: React.FC<GlobalSettingsProps> = ({ onClose }) => {
  const [globalPrompt, setGlobalPrompt] = useState('Aja como um canal profissional do YouTube.');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['globalPrompt'], (result: { globalPrompt?: string }) => {
      if (result.globalPrompt) {
        setGlobalPrompt(result.globalPrompt);
      }
    });
  }, []);

  const handleSaveSettings = () => {
    setLoading(true);
    chrome.storage.local.set({ globalPrompt }, () => {
      setLoading(false);
      onClose();
    });
  };

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-right-4 duration-200">
      <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Configurações Globais</span>

      <label className="block text-sm text-slate-400">Prompt do Canal</label>
      <textarea
        className="bg-black/20 border border-slate-700 rounded-lg focus:border-[#6b4fe0] outline-none p-3 w-full text-slate-200 placeholder:text-slate-500 transition-colors min-h-[150px] text-sm"
        value={globalPrompt}
        onChange={(e) => setGlobalPrompt(e.target.value)}
        placeholder="Ex: Responda de forma descontraída, sempre agradecendo..."
      />

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-sm"
        >
          Cancelar
        </button>
        <button
          onClick={handleSaveSettings}
          className="bg-gradient-to-r from-[#6b4fe0] to-[#3c82f6] text-white hover:scale-[1.02] active:scale-95 transition-transform font-medium py-2 px-4 rounded-lg shadow-lg shadow-blue-900/20 text-sm"
        >
          {loading ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </div>
    </div>
  );
};

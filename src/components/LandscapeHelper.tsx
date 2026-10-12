import React, { useState, useEffect } from 'react';
import { Smartphone, RotateCw, Maximize2, X } from 'lucide-react';

interface LandscapeHelperProps {
  onToggleFullscreen?: () => void;
}

export const LandscapeHelper: React.FC<LandscapeHelperProps> = ({ onToggleFullscreen }) => {
  const [isPortrait, setIsPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      if (typeof window === 'undefined') return;
      const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 768;
      setIsPortrait(portrait);
    };

    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  if (!isPortrait || dismissed) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-6 text-center shadow-2xl relative">
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          title="Continuar en vertical"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-cyan-950/50 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
          <RotateCw className="w-8 h-8 animate-spin" style={{ animationDuration: '6s' }} />
        </div>

        <h3 className="text-base font-display font-bold text-slate-100 mb-2">
          Gira a Modo Horizontal (Landscape)
        </h3>

        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
          Esta cabina táctil está diseñada para sostener el dispositivo con ambas manos y operar las 3 palancas con los pulgares durante el combate de sumo.
        </p>

        <div className="flex flex-col gap-2">
          {onToggleFullscreen && (
            <button
              onClick={() => {
                onToggleFullscreen();
                setDismissed(true);
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-lg shadow-cyan-500/20"
            >
              <Maximize2 className="w-4 h-4" />
              Pantalla Completa
            </button>
          )}

          <button
            onClick={() => setDismissed(true)}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            Continuar en vertical
          </button>
        </div>
      </div>
    </div>
  );
};

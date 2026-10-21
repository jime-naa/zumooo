import React, { useState } from 'react';
import { ChevronUp, ChevronDown, RotateCcw, RotateCw, Octagon } from 'lucide-react';
import { MovementDir } from '../types';

interface DirectionalPadProps {
  onDirectionStart: (dir: MovementDir) => void;
  onDirectionEnd: () => void;
  activeDirection: MovementDir;
  speed: number;
  disabled?: boolean;
}

export const DirectionalPad: React.FC<DirectionalPadProps> = ({
  onDirectionStart,
  onDirectionEnd,
  activeDirection,
  speed,
  disabled = false,
}) => {
  const [pressedBtn, setPressedBtn] = useState<MovementDir | null>(null);

  const handlePointerDown = (dir: MovementDir, e: React.PointerEvent) => {
    e.preventDefault();
    if (disabled) return;
    setPressedBtn(dir);
    onDirectionStart(dir);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(25); } catch {}
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    setPressedBtn(null);
    onDirectionEnd();
  };

  const isF = activeDirection === 'F' || pressedBtn === 'F';
  const isR = activeDirection === 'R' || pressedBtn === 'R';
  const isL = activeDirection === 'L' || pressedBtn === 'L';
  const isD = activeDirection === 'D' || pressedBtn === 'D';
  const isS = activeDirection === 'S' || pressedBtn === 'S';

  return (
    <div className="flex flex-col items-center justify-center select-none touch-none">
      <div className="relative w-56 h-56 sm:w-64 sm:h-64 grid grid-cols-3 grid-rows-3 gap-2 p-2 bg-slate-900/90 border-2 border-slate-700/80 rounded-3xl shadow-2xl backdrop-blur-md">
        
        {/* Esquina sup izq vacía */}
        <div className="flex items-center justify-center text-[10px] font-mono text-slate-600">
          W / ↑
        </div>

        {/* BOTÓN ADELANTE ('F') */}
        <button
          type="button"
          disabled={disabled}
          onPointerDown={(e) => handlePointerDown('F', e)}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`relative col-start-2 row-start-1 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 shadow-md ${
            isF
              ? 'bg-emerald-500 text-slate-950 font-black shadow-emerald-500/50 ring-4 ring-emerald-400 scale-95'
              : 'bg-slate-800 text-emerald-400 hover:bg-slate-750 border border-emerald-500/30'
          }`}
          title="Adelante ('F') - Presiona y mantén"
        >
          <ChevronUp className="w-8 h-8 sm:w-10 sm:h-10" />
          <span className="text-[11px] font-mono font-bold tracking-wider leading-none">
            F {isF ? speed : ''}
          </span>
        </button>

        {/* Esquina sup der vacía */}
        <div className="flex items-center justify-center text-[10px] font-mono text-slate-600">
          PWM {speed}
        </div>

        {/* BOTÓN GIRO IZQUIERDA ('L') */}
        <button
          type="button"
          disabled={disabled}
          onPointerDown={(e) => handlePointerDown('L', e)}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`relative col-start-1 row-start-2 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 shadow-md ${
            isL
              ? 'bg-amber-500 text-slate-950 font-black shadow-amber-500/50 ring-4 ring-amber-400 scale-95'
              : 'bg-slate-800 text-amber-400 hover:bg-slate-750 border border-amber-500/30'
          }`}
          title="Giro Izquierda ('L') - Presiona y mantén"
        >
          <RotateCcw className="w-7 h-7 sm:w-8 sm:h-8" />
          <span className="text-[11px] font-mono font-bold tracking-wider leading-none">
            L {isL ? speed : ''}
          </span>
        </button>

        {/* BOTÓN CENTRAL DE FRENO ('S') */}
        <button
          type="button"
          disabled={disabled}
          onPointerDown={(e) => handlePointerDown('S', e)}
          onPointerUp={handlePointerUp}
          className={`relative col-start-2 row-start-2 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-90 shadow-inner ${
            isS
              ? 'bg-rose-600 text-white font-black shadow-rose-600/60 ring-4 ring-rose-400'
              : 'bg-slate-850 text-rose-400 hover:bg-slate-800 border-2 border-rose-500/40'
          }`}
          title="Freno Inmediato ('S')"
        >
          <Octagon className="w-6 h-6 sm:w-7 sm:h-7" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-tight mt-0.5">
            FRENO
          </span>
          <span className="text-[9px] text-rose-300/80 font-mono">S 0</span>
        </button>

        {/* BOTÓN GIRO DERECHA ('D') */}
        <button
          type="button"
          disabled={disabled}
          onPointerDown={(e) => handlePointerDown('D', e)}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`relative col-start-3 row-start-2 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 shadow-md ${
            isD
              ? 'bg-amber-500 text-slate-950 font-black shadow-amber-500/50 ring-4 ring-amber-400 scale-95'
              : 'bg-slate-800 text-amber-400 hover:bg-slate-750 border border-amber-500/30'
          }`}
          title="Giro Derecha ('D') - Presiona y mantén"
        >
          <RotateCw className="w-7 h-7 sm:w-8 sm:h-8" />
          <span className="text-[11px] font-mono font-bold tracking-wider leading-none">
            D {isD ? speed : ''}
          </span>
        </button>

        {/* Esquina inf izq vacía */}
        <div className="flex items-center justify-center text-[10px] font-mono text-slate-600">
          A / ◀
        </div>

        {/* BOTÓN ATRÁS ('R') */}
        <button
          type="button"
          disabled={disabled}
          onPointerDown={(e) => handlePointerDown('R', e)}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`relative col-start-2 row-start-3 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 shadow-md ${
            isR
              ? 'bg-cyan-500 text-slate-950 font-black shadow-cyan-500/50 ring-4 ring-cyan-400 scale-95'
              : 'bg-slate-800 text-cyan-400 hover:bg-slate-750 border border-cyan-500/30'
          }`}
          title="Atrás ('R') - Presiona y mantén"
        >
          <ChevronDown className="w-8 h-8 sm:w-10 sm:h-10" />
          <span className="text-[11px] font-mono font-bold tracking-wider leading-none">
            R {isR ? speed : ''}
          </span>
        </button>

        {/* Esquina inf der vacía */}
        <div className="flex items-center justify-center text-[10px] font-mono text-slate-600">
          D / ▶
        </div>
      </div>
      
      <div className="flex items-center gap-2 mt-2 text-[10px] font-mono text-slate-400">
        <span>Mantén presionado para mover</span>
        <span aria-hidden="true">·</span>
        <span>Suelta para frenar</span>
      </div>
    </div>
  );
};

import React, { useRef, useState, useEffect, useCallback } from 'react';

interface LeverControlProps {
  id: 'left' | 'center' | 'right';
  label: string;
  sublabel: string;
  value: number; // -100 to 100
  onChange: (value: number) => void;
  disabled?: boolean;
  isOverridden?: boolean;
  hasSnapping?: boolean;
  accentColor?: 'cyan' | 'amber' | 'emerald';
}

const SNAP_POINTS = [-100, -75, -50, -25, 0, 25, 50, 75, 100];
const SNAP_THRESHOLD = 8; // Snap magnet zone in percentage

export const LeverControl: React.FC<LeverControlProps> = ({
  id,
  label,
  sublabel,
  value,
  onChange,
  disabled = false,
  isOverridden = false,
  hasSnapping = false,
  accentColor = 'cyan',
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPointerActive, setIsPointerActive] = useState(false);

  // Calcula el valor correspondiente a la posición Y
  const calculateValueFromClientY = useCallback((clientY: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const trackHeight = rect.height;
    const relativeY = clientY - rect.top;
    
    // Invertir Y: arriba es +100 (Forward), abajo es -100 (Reverse)
    const normalized = 1 - (relativeY / trackHeight); // 0 at bottom, 1 at top
    let rawPercent = Math.round((normalized - 0.5) * 200); // -100 to 100
    rawPercent = Math.max(-100, Math.min(100, rawPercent));

    // Si tiene snapping activado, verificar imán en muescas
    if (hasSnapping) {
      for (const snap of SNAP_POINTS) {
        if (Math.abs(rawPercent - snap) <= SNAP_THRESHOLD) {
          return snap;
        }
      }
    } else {
      // Pequeña zona muerta central (deadband) de 3% para garantizar reposo en 0
      if (Math.abs(rawPercent) < 4) {
        return 0;
      }
    }

    return rawPercent;
  }, [hasSnapping]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || isOverridden) return;
    
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    setIsPointerActive(true);

    const newVal = calculateValueFromClientY(e.clientY);
    onChange(newVal);

    // Haptic feedback ligero en dispositivos compatibles
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(12); } catch {}
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || disabled || isOverridden) return;
    e.preventDefault();
    const newVal = calculateValueFromClientY(e.clientY);
    onChange(newVal);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    setIsDragging(false);
    setIsPointerActive(false);

    // RESORTE VIRTUAL: Retorno automático e inmediato a 0% al soltar
    onChange(0);

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(8); } catch {}
    }
  };

  // Posición del cabezal en porcentaje CSS (0% = centro físico)
  // value -100 -> top 100%, value 0 -> top 50%, value 100 -> top 0%
  const thumbTopPercent = 50 - (value / 2);

  const getAccentColors = () => {
    if (isOverridden) {
      return {
        thumb: 'bg-amber-500 border-amber-300 shadow-amber-500/30',
        activeBar: 'bg-amber-500/20',
        badge: 'text-amber-400 bg-amber-950/60 border-amber-800/80',
      };
    }
    if (accentColor === 'amber') {
      return {
        thumb: 'bg-amber-500 border-amber-300 shadow-amber-500/50',
        activeBar: 'bg-amber-500/40',
        badge: 'text-amber-400 bg-amber-950/40 border-amber-700/60',
      };
    }
    if (accentColor === 'emerald') {
      return {
        thumb: 'bg-emerald-500 border-emerald-300 shadow-emerald-500/50',
        activeBar: 'bg-emerald-500/40',
        badge: 'text-emerald-400 bg-emerald-950/40 border-emerald-700/60',
      };
    }
    // Default Cyan
    return {
      thumb: 'bg-cyan-500 border-cyan-300 shadow-cyan-500/50',
      activeBar: 'bg-cyan-500/40',
      badge: 'text-cyan-400 bg-cyan-950/40 border-cyan-700/60',
    };
  };

  const colors = getAccentColors();

  return (
    <div className={`relative flex flex-col items-center select-none w-full h-full max-w-[200px] transition-opacity duration-200 ${
      isOverridden ? 'opacity-70' : 'opacity-100'
    }`}>
      {/* Cabecera de la Palanca */}
      <div className="flex flex-col items-center mb-1 text-center">
        <div className="flex items-center gap-1.5">
          <span className="font-display text-sm font-bold tracking-wider text-slate-200 uppercase">
            {label}
          </span>
          {hasSnapping && (
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 bg-slate-800/80 px-1 py-0.5 rounded border border-slate-700/50">
              Snap
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-400 whitespace-nowrap">
          {sublabel}
        </span>
      </div>

      {/* Lectura numérica en tiempo real */}
      <div className="mb-2">
        <div className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold border transition-colors ${
          isOverridden 
            ? 'bg-amber-950/70 border-amber-700/80 text-amber-300' 
            : value !== 0 
              ? 'bg-slate-900 border-cyan-500/60 text-cyan-300 shadow-sm shadow-cyan-500/20' 
              : 'bg-slate-900/80 border-slate-700/60 text-slate-400'
        }`}>
          {isOverridden ? 'ANULADA' : `${value > 0 ? '+' : ''}${value}%`}
        </div>
      </div>

      {/* Pista de Deslizamiento Táctil */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative flex-1 w-20 min-h-[160px] sm:min-h-[200px] max-h-[360px] rounded-2xl bg-gradient-to-b from-slate-900/90 via-slate-950 to-slate-900/90 border-2 touch-none cursor-pointer p-1 transition-all ${
          isOverridden
            ? 'border-amber-600/50 bg-amber-950/20 shadow-inner'
            : isPointerActive
              ? 'border-cyan-400 shadow-lg shadow-cyan-500/20'
              : 'border-slate-700/80 hover:border-slate-500'
        }`}
        style={{ touchAction: 'none' }}
      >
        {/* Guía Central (Línea de 0%) */}
        <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-0.5 bg-slate-600/80 pointer-events-none z-10 flex items-center justify-between px-1">
          <span className="text-[9px] font-mono text-slate-500 font-bold -translate-y-3">0%</span>
          <span className="text-[9px] font-mono text-slate-500 font-bold -translate-y-3">STOP</span>
        </div>

        {/* Marcas de muesca (Notches de snapping) */}
        {SNAP_POINTS.map((pt) => {
          if (pt === 0) return null;
          const posTop = 50 - pt / 2;
          const isMajor = pt === 100 || pt === -100 || pt === 50 || pt === -50;
          return (
            <div
              key={pt}
              className={`absolute left-3 right-3 pointer-events-none flex items-center justify-between z-0 ${
                isMajor ? 'h-[2px] bg-slate-700/60' : 'h-[1px] bg-slate-800/80'
              }`}
              style={{ top: `${posTop}%` }}
            >
              <span className={`text-[8px] font-mono ${isMajor ? 'text-slate-400' : 'text-slate-600'} -translate-y-2`}>
                {pt > 0 ? `+${pt}` : pt}
              </span>
            </div>
          );
        })}

        {/* Barra de Fuerza Dinámica (Relleno desde el centro hacia arriba o abajo) */}
        {!isOverridden && value !== 0 && (
          <div
            className={`absolute left-4 right-4 rounded pointer-events-none transition-all ${
              value > 0 ? 'bg-cyan-500/30 border-t border-cyan-400/80' : 'bg-rose-500/30 border-b border-rose-400/80'
            }`}
            style={{
              top: value > 0 ? `${thumbTopPercent}%` : '50%',
              bottom: value < 0 ? `${100 - thumbTopPercent}%` : '50%',
            }}
          />
        )}

        {/* Cabezal de la Palanca (Puck / Slider Handle) */}
        <div
          className={`absolute left-1.5 right-1.5 h-14 -mt-7 rounded-xl border-2 shadow-md flex flex-col items-center justify-center transition-transform z-20 ${
            isOverridden
              ? 'bg-gradient-to-b from-amber-600 to-amber-800 border-amber-300 text-amber-100 shadow-amber-500/30'
              : isPointerActive
                ? 'scale-105 bg-gradient-to-b from-cyan-500 to-cyan-700 border-cyan-200 text-white shadow-cyan-500/40'
                : 'bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 border-slate-500 text-slate-200'
          }`}
          style={{
            top: `${thumbTopPercent}%`,
            transition: isDragging ? 'none' : 'top 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Estrías de agarre táctil */}
          <div className="flex flex-col gap-1 w-8 pointer-events-none">
            <div className="h-[2px] bg-white/40 rounded-full" />
            <div className="h-[2px] bg-white/40 rounded-full" />
            <div className="h-[2px] bg-white/40 rounded-full" />
          </div>

          <div className="text-[9px] font-mono font-bold mt-1 tracking-tighter uppercase opacity-90">
            {isOverridden ? 'LOCK' : value > 0 ? 'FWD' : value < 0 ? 'REV' : 'NEU'}
          </div>
        </div>

        {/* Advertencia de Override superpuesta en la palanca central */}
        {isOverridden && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-[1px] rounded-2xl flex flex-col items-center justify-center p-2 text-center z-30 pointer-events-none border border-amber-500/40">
            <span className="text-[10px] font-bold text-amber-400 font-display uppercase tracking-wider">
              Override
            </span>
            <span className="text-[9px] text-amber-200/90 leading-tight mt-1">
              Desacoplada por palancas laterales
            </span>
          </div>
        )}
      </div>

      {/* Indicador de Resorte */}
      <div className="mt-2 text-center">
        <span className="text-[10px] text-slate-400 flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-600" />
          Auto-retorno al soltar
        </span>
      </div>
    </div>
  );
};

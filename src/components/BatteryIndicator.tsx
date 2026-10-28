import React, { useState } from 'react';
import { 
  Battery, 
  BatteryFull, 
  BatteryMedium, 
  BatteryLow, 
  BatteryWarning,
  Zap,
  Activity
} from 'lucide-react';
import { getBatteryColorInfo } from '../types';

interface BatteryIndicatorProps {
  percentage: number;
  voltage?: number | null;
  formattedText?: string;
  isConnected: boolean;
  onSimulateChange?: (newPct: number, newVolts?: number) => void;
  className?: string;
}

export const BatteryIndicator: React.FC<BatteryIndicatorProps> = ({
  percentage,
  voltage,
  formattedText,
  isConnected,
  onSimulateChange,
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  
  // Limitar porcentaje entre 0 y 100
  const validPct = Math.max(0, Math.min(100, Math.round(isNaN(percentage) ? 0 : percentage)));
  
  // Estilos cromáticos estrictos:
  // > 50% -> Verde (emerald)
  // 20% a 50% -> Amarillo (amber)
  // < 20% -> Rojo (rose)
  const info = getBatteryColorInfo(validPct);

  // Texto completo de batería: preferir el enviado exactamente por la ESP32 (ej: "7.8V (85%)")
  const displayText = formattedText || (
    voltage !== undefined && voltage !== null 
      ? `${voltage.toFixed(1)}V (${validPct}%)` 
      : `${(6.6 + (validPct / 100) * 1.8).toFixed(1)}V (${validPct}%)`
  );

  // Extraer partes para renderizado tipográfico refinado si coincide con el formato
  const match = displayText.match(/^([0-9.]+\s*V)?\s*(\(\s*\d{1,3}%\s*\)|\d{1,3}%)?$/i);
  const voltPart = match && match[1] ? match[1].trim() : null;
  const pctPart = match && match[2] ? match[2].trim() : null;

  // Selección dinámica de ícono según nivel
  const renderBatteryIcon = () => {
    if (validPct > 70) {
      return <BatteryFull className={`w-4 h-4 ${info.textColor} shrink-0 transition-transform group-hover:scale-110`} />;
    } else if (validPct > 50) {
      return <Battery className={`w-4 h-4 ${info.textColor} shrink-0 transition-transform group-hover:scale-110`} />;
    } else if (validPct >= 20) {
      return <BatteryMedium className={`w-4 h-4 ${info.textColor} shrink-0`} />;
    } else if (validPct > 10) {
      return <BatteryLow className={`w-4 h-4 ${info.textColor} shrink-0 animate-pulse`} />;
    } else {
      return <BatteryWarning className={`w-4 h-4 ${info.textColor} shrink-0 animate-bounce`} />;
    }
  };

  // Ciclo interactivo para probar los valores y colores en pantalla
  const handleTestCycle = () => {
    if (!onSimulateChange) return;
    const testPresets = [
      { pct: 85, volts: 7.8 }, // Valor nominal solicitado por el usuario
      { pct: 95, volts: 8.2 }, // Batería óptima
      { pct: 45, volts: 7.4 }, // Nivel medio (amarillo)
      { pct: 15, volts: 6.8 }, // Nivel bajo (rojo de alerta)
      { pct: 100, volts: 8.4 }, // Carga completa
    ];
    const currentIndex = testPresets.findIndex((p) => Math.abs(p.pct - validPct) <= 5);
    const nextIndex = (currentIndex + 1) % testPresets.length;
    const next = testPresets[nextIndex];
    onSimulateChange(next.pct, next.volts);
  };

  return (
    <div 
      className={`group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border transition-all duration-300 select-none cursor-pointer ${
        info.borderColor
      } ${info.bgColor} ${
        validPct < 20 
          ? 'shadow-md shadow-rose-950/60 ring-1 ring-rose-500/30' 
          : 'shadow-sm shadow-black/40 hover:border-slate-600'
      } ${className}`}
      onClick={handleTestCycle}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      title="Estado de batería del robot ESP32. Toca para alternar simulación de prueba."
      role="status"
      aria-label={`Batería del robot: ${displayText}`}
    >
      {/* Ícono de batería con color dinámico */}
      <div className="flex items-center justify-center relative">
        {renderBatteryIcon()}
        {validPct < 20 && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 animate-ping" />
        )}
      </div>

      {/* Texto completo dedicado: "7.8V (85%)" */}
      <div className="flex items-baseline gap-1 font-mono tracking-tight whitespace-nowrap">
        {voltPart && pctPart ? (
          <>
            <span className="text-xs font-bold text-slate-100 group-hover:text-cyan-300 transition-colors">
              {voltPart}
            </span>
            <span className={`text-xs font-black ${info.textColor}`}>
              {pctPart}
            </span>
          </>
        ) : (
          <span className={`text-xs font-black ${info.textColor}`}>
            {displayText}
          </span>
        )}
      </div>

      {/* Barra de progreso visual con color según nivel */}
      <div 
        className="w-10 sm:w-12 h-1.5 bg-slate-950/90 rounded-full overflow-hidden p-[1px] border border-slate-800 shrink-0"
        aria-hidden="true"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${info.barColor} ${
            validPct < 20 ? 'animate-pulse' : ''
          }`}
          style={{ width: `${validPct}%` }}
        />
      </div>

      {/* Indicador de estado sutil si es nivel crítico */}
      {validPct < 20 && (
        <span className="hidden sm:inline-block text-[9px] font-mono font-black uppercase text-rose-300 bg-rose-950/90 px-1 py-0.2 rounded border border-rose-700/80">
          BAJA
        </span>
      )}

      {/* Tooltip táctico con detalles completos */}
      {showTooltip && (
        <div className="absolute top-full mt-2 right-0 z-50 bg-slate-950/95 border border-slate-700 rounded-xl px-3 py-2 shadow-2xl text-[10px] font-mono whitespace-nowrap text-slate-200 pointer-events-none animate-fadeIn backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 mb-1">
            <span className="text-slate-400">Mini-Sumo ESP32:</span>
            <span className={`font-black ${info.textColor}`}>{displayText}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-slate-400 text-[9px]">
            <span>Estado Batería:</span>
            <span className={info.textColor}>{info.label} ({validPct}%)</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-slate-500 text-[9px] mt-0.5">
            <span>Enlace BLE:</span>
            <span className={isConnected ? 'text-emerald-400' : 'text-slate-400'}>
              {isConnected ? 'Transmitiendo' : 'Desconectado'}
            </span>
          </div>
          <div className="text-[9px] text-cyan-400/90 mt-1.5 border-t border-slate-800/80 pt-1 flex items-center gap-1">
            <Zap className="w-3 h-3 text-cyan-400" />
            <span>Toca para alternar simulación (7.8V, 8.2V, 7.4V, 6.8V)</span>
          </div>
        </div>
      )}
    </div>
  );
};

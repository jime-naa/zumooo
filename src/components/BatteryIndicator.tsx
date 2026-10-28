import React, { useState } from 'react';
import { 
  Battery, 
  BatteryFull, 
  BatteryMedium, 
  BatteryLow, 
  BatteryWarning,
  Zap
} from 'lucide-react';
import { getBatteryColorInfo } from '../types';

interface BatteryIndicatorProps {
  percentage: number;
  isConnected: boolean;
  onSimulateChange?: (newPct: number) => void;
  className?: string;
  showDetails?: boolean;
}

export const BatteryIndicator: React.FC<BatteryIndicatorProps> = ({
  percentage,
  isConnected,
  onSimulateChange,
  className = '',
  showDetails = false,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  
  // Limitar valor entre 0 y 100
  const validPct = Math.max(0, Math.min(100, Math.round(isNaN(percentage) ? 0 : percentage)));
  
  // Obtener estilos cromáticos estrictos:
  // > 50% -> Verde
  // 20% a 50% -> Amarillo
  // < 20% -> Rojo
  const info = getBatteryColorInfo(validPct);

  // Selección dinámica de ícono según nivel
  const renderBatteryIcon = () => {
    if (validPct > 70) {
      return <BatteryFull className={`w-4 h-4 ${info.textColor} shrink-0`} />;
    } else if (validPct > 50) {
      return <Battery className={`w-4 h-4 ${info.textColor} shrink-0`} />;
    } else if (validPct >= 20) {
      return <BatteryMedium className={`w-4 h-4 ${info.textColor} shrink-0`} />;
    } else if (validPct > 10) {
      return <BatteryLow className={`w-4 h-4 ${info.textColor} shrink-0 animate-pulse`} />;
    } else {
      return <BatteryWarning className={`w-4 h-4 ${info.textColor} shrink-0 animate-bounce`} />;
    }
  };

  // Ciclo interactivo de simulación al tocar para pruebas de colores
  const handleTestCycle = () => {
    if (!onSimulateChange) return;
    const testLevels = [100, 75, 45, 15, 8];
    const currentIndex = testLevels.findIndex((l) => Math.abs(l - validPct) <= 5);
    const nextIndex = (currentIndex + 1) % testLevels.length;
    onSimulateChange(testLevels[nextIndex]);
  };

  return (
    <div 
      className={`relative inline-flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-900/90 border transition-all duration-300 select-none ${
        info.borderColor
      } ${info.bgColor} ${validPct < 20 ? 'shadow-sm shadow-rose-950/40 ring-1 ring-rose-500/20' : ''} ${className}`}
      onClick={handleTestCycle}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      title="Estado de batería del robot ESP32. Toca para probar niveles (100% → 75% → 45% → 15%)."
      role="status"
      aria-label={`Batería del robot: ${validPct}% (${info.label})`}
    >
      {/* Ícono de batería dinámico */}
      <div className="flex items-center justify-center">
        {renderBatteryIcon()}
      </div>

      {/* Indicador numérico de porcentaje (0% - 100%) */}
      <div className="flex items-baseline gap-0.5 font-mono">
        <span className={`text-xs font-black tracking-tight ${info.textColor}`}>
          {validPct}
        </span>
        <span className="text-[10px] font-semibold text-slate-400">%</span>
      </div>

      {/* Barra de progreso visual con color según nivel */}
      <div 
        className="w-10 sm:w-12 h-1.5 bg-slate-950 rounded-full overflow-hidden p-[1px] border border-slate-800 shrink-0"
        aria-hidden="true"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${info.barColor} ${
            validPct < 20 ? 'animate-pulse' : ''
          }`}
          style={{ width: `${validPct}%` }}
        />
      </div>

      {/* Badge discreto de estado en modo detalles si es crítico */}
      {validPct < 20 && (
        <span className="hidden sm:inline-block text-[9px] font-mono font-bold uppercase text-rose-400 bg-rose-950/80 px-1 rounded border border-rose-800/80">
          Baja
        </span>
      )}

      {/* Tooltip sutil en hover con información adicional */}
      {showTooltip && (
        <div className="absolute top-full mt-1.5 right-0 z-40 bg-slate-950/95 border border-slate-700/80 rounded-lg px-2.5 py-1.5 shadow-xl text-[10px] font-mono whitespace-nowrap text-slate-300 pointer-events-none animate-fadeIn">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-400">Robot ESP32:</span>
            <span className={`font-bold ${info.textColor}`}>{validPct}% ({info.label})</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-slate-500 text-[9px] mt-0.5">
            <span>Enlace BLE:</span>
            <span className={isConnected ? 'text-emerald-400' : 'text-slate-400'}>
              {isConnected ? 'Sincronizado' : 'Sin conexión'}
            </span>
          </div>
          <div className="text-[9px] text-cyan-400/80 mt-1 border-t border-slate-800/60 pt-0.5">
            💡 Toca para alternar nivel de prueba
          </div>
        </div>
      )}
    </div>
  );
};

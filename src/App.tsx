import React, { useState, useEffect, useCallback } from 'react';
import { 
  Bluetooth, 
  BluetoothConnected, 
  BluetoothOff, 
  Cpu, 
  Maximize2, 
  Minimize2, 
  RotateCcw, 
  Activity, 
  Layers, 
  ShieldAlert, 
  Gauge,
  Sliders
} from 'lucide-react';
import { bleService } from './services/bleService';
import { BleConnectionStatus, BleTelemetry, LeverValues, MotorSpeeds } from './types';
import { LeverControl } from './components/LeverControl';
import { DohyoSimulator } from './components/DohyoSimulator';
import { FirmwareModal } from './components/FirmwareModal';
import { LandscapeHelper } from './components/LandscapeHelper';

export default function App() {
  // Estado de las 3 Palancas Virtuales (-100 a +100)
  const [levers, setLevers] = useState<LeverValues>({
    center: 0,
    left: 0,
    right: 0,
  });

  // Intervalo de Throttling configurable (50ms a 100ms)
  const [throttleMs, setThrottleMs] = useState<number>(60);

  // Estado BLE
  const [bleStatus, setBleStatus] = useState<BleConnectionStatus>(bleService.status);
  const [bleError, setBleError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<BleTelemetry>({
    packetsSent: 0,
    packetsPerSec: 0,
    lastPacketPayload: 'V:0,0,0',
    lastLatencyMs: 0,
    bytesSent: 0,
    lastPacketTimestamp: 0,
    isWriting: false,
    deviceName: null,
  });

  // UI Modals y Modos
  const [isFirmwareOpen, setIsFirmwareOpen] = useState(false);
  const [showSimulator, setShowSimulator] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [snappingEnabled, setSnappingEnabled] = useState(true);

  // Watchdog virtual indicador (se reinicia con cada paquete)
  const [watchdogProgress, setWatchdogProgress] = useState(100);

  // REGLA DE PRIORIDAD (OVERRIDE):
  // Si las palancas laterales están accionadas (|L| > 3 o |R| > 3),
  // la palanca central se anula automáticamente.
  const isOverrideActive = Math.abs(levers.left) > 3 || Math.abs(levers.right) > 3;

  // Cálculo de tracción efectiva a motores:
  const motorSpeeds: MotorSpeeds = isOverrideActive
    ? { left: levers.left, right: levers.right }
    : { left: levers.center, right: levers.center };

  // Sincronizar el Throttling en BleService cada vez que cambian las palancas
  useEffect(() => {
    bleService.updateLevers({
      center: isOverrideActive ? 0 : levers.center,
      left: levers.left,
      right: levers.right,
    });
  }, [levers, isOverrideActive]);

  // Suscripción al servicio BLE y a la telemetría
  useEffect(() => {
    bleService.onStatusChange((status, errorMsg) => {
      setBleStatus(status);
      if (errorMsg) setBleError(errorMsg);
      else setBleError(null);
    });

    bleService.onTelemetry((telem) => {
      setTelemetry({ ...telem });
      setWatchdogProgress(100);
    });

    return () => {
      bleService.destroy();
    };
  }, []);

  // Temporizador para simular barra de watchdog en el HUD
  useEffect(() => {
    const timer = setInterval(() => {
      setWatchdogProgress((prev) => Math.max(0, prev - 10));
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // Actualizar intervalo de Throttling (50ms - 100ms)
  const handleThrottleChange = (ms: number) => {
    setThrottleMs(ms);
    bleService.setThrottleInterval(ms);
  };

  // Manejadores de palancas individuales (actualizan estado local de inmediato)
  const handleCenterChange = useCallback((val: number) => {
    setLevers((prev) => ({ ...prev, center: val }));
  }, []);

  const handleLeftChange = useCallback((val: number) => {
    setLevers((prev) => ({ ...prev, left: val }));
  }, []);

  const handleRightChange = useCallback((val: number) => {
    setLevers((prev) => ({ ...prev, right: val }));
  }, []);

  // Parada inmediata de emergencia
  const handleEmergencyStop = () => {
    setLevers({ center: 0, left: 0, right: 0 });
    bleService.forceStopImmediate();
  };

  // Conectar / Desconectar Bluetooth
  const toggleBleConnection = async () => {
    if (bleStatus === 'connected' || bleStatus === 'connecting') {
      await bleService.disconnect();
    } else {
      await bleService.connect();
    }
  };

  // Alternar Pantalla Completa
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Atajos de teclado para pruebas en PC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          setLevers((prev) => ({ ...prev, center: 80 }));
          break;
        case 's':
        case 'arrowdown':
          setLevers((prev) => ({ ...prev, center: -80 }));
          break;
        case 'a':
        case 'arrowleft':
          // Giro diferencial a la izquierda
          setLevers((prev) => ({ ...prev, left: -80, right: 80 }));
          break;
        case 'd':
        case 'arrowright':
          // Giro diferencial a la derecha
          setLevers((prev) => ({ ...prev, left: 80, right: -80 }));
          break;
        case 'q':
          setLevers((prev) => ({ ...prev, left: 80 }));
          break;
        case 'e':
          setLevers((prev) => ({ ...prev, right: 80 }));
          break;
        case ' ':
          handleEmergencyStop();
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'w':
        case 's':
        case 'arrowup':
        case 'arrowdown':
          setLevers((prev) => ({ ...prev, center: 0 }));
          break;
        case 'a':
        case 'd':
        case 'arrowleft':
        case 'arrowright':
        case 'q':
        case 'e':
          setLevers((prev) => ({ ...prev, left: 0, right: 0 }));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div className="relative w-screen h-screen min-h-[460px] bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none font-sans">
      
      {/* Guía visual si el móvil se coloca en vertical */}
      <LandscapeHelper onToggleFullscreen={toggleFullscreen} />

      {/* Modal de Firmware ESP32 y Diagrama */}
      <FirmwareModal
        isOpen={isFirmwareOpen}
        onClose={() => setIsFirmwareOpen(false)}
      />

      {/* BARRA SUPERIOR COMPACTA (Top Bar Contract: 3 Zonas) */}
      <header className="h-12 px-4 md:px-6 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md flex items-center justify-between gap-4 shrink-0 z-30">
        
        {/* Zona 1: Brand Wordmark & Metadata limpia */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm bg-cyan-400 rotate-45" />
            <h1 className="font-display font-bold text-sm tracking-wide text-slate-100 uppercase whitespace-nowrap">
              SumoBot BLE
            </h1>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 font-mono">
            <span>ESP32 C++</span>
            <span aria-hidden="true">·</span>
            <span>TB6612FNG</span>
            <span aria-hidden="true">·</span>
            <span>TCRT5000 IR</span>
          </div>
        </div>

        {/* Zona 2: Control de Throttling y Frecuencia TX */}
        <div className="hidden md:flex items-center gap-3 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-1.5 bg-slate-950/70 px-2 py-0.5 rounded border border-slate-800">
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[10px] uppercase text-slate-500">Throttling:</span>
            <div className="flex items-center gap-1 ml-1">
              {[50, 60, 80, 100].map((ms) => (
                <button
                  key={ms}
                  onClick={() => handleThrottleChange(ms)}
                  className={`px-1.5 py-0.2 rounded text-[10px] transition-colors ${
                    throttleMs === ms
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-slate-200 bg-slate-900'
                  }`}
                  title={`Intervalo de envío BLE de ${ms}ms`}
                >
                  {ms}ms
                </button>
              ))}
            </div>
          </div>

          <span aria-hidden="true" className="text-slate-700">|</span>

          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>TX: {telemetry.packetsPerSec} Hz</span>
          </div>

          <span aria-hidden="true" className="text-slate-700">|</span>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase text-slate-500">Watchdog:</span>
            <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-100 ${
                  watchdogProgress > 40 ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
                style={{ width: `${watchdogProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Zona 3: Botones de Acción (Firmware, Simulador, BLE Connect) */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSimulator(!showSimulator)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              showSimulator 
                ? 'bg-slate-800 border-cyan-500/50 text-cyan-300' 
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Alternar vista del simulador de Dohyo"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Dohyo</span>
          </button>

          <button
            onClick={() => setIsFirmwareOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1.5"
            title="Ver código fuente C++ para ESP32"
          >
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Firmware C++</span>
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title="Pantalla completa"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Botón Principal BLE */}
          <button
            onClick={toggleBleConnection}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
              bleStatus === 'connected'
                ? 'bg-emerald-600 hover:bg-rose-700 text-white shadow-emerald-600/30'
                : bleStatus === 'connecting'
                  ? 'bg-amber-600 text-white animate-pulse'
                  : bleStatus === 'unsupported'
                    ? 'bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700'
                    : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/30'
            }`}
          >
            {bleStatus === 'connected' ? (
              <>
                <BluetoothConnected className="w-3.5 h-3.5" />
                <span>Conectado</span>
              </>
            ) : bleStatus === 'connecting' ? (
              <>
                <Bluetooth className="w-3.5 h-3.5 animate-spin" />
                <span>Buscando...</span>
              </>
            ) : bleStatus === 'unsupported' ? (
              <>
                <BluetoothOff className="w-3.5 h-3.5" />
                <span>Sin Web BLE</span>
              </>
            ) : (
              <>
                <Bluetooth className="w-3.5 h-3.5" />
                <span>Emparejar BLE</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Alerta de Error BLE */}
      {bleError && (
        <div className="bg-rose-950/80 border-b border-rose-800 text-rose-200 px-4 py-1.5 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>{bleError}</span>
          </div>
          <button onClick={() => setBleError(null)} className="text-rose-400 hover:text-white text-xs underline">
            Descartar
          </button>
        </div>
      )}

      {/* CABINA PRINCIPAL EN ORIENTACIÓN HORIZONTAL (LANDSCAPE) */}
      <main className="flex-1 w-full p-2 md:p-4 grid grid-cols-12 gap-2 md:gap-4 overflow-hidden items-stretch">
        
        {/* COLUMNA IZQUIERDA: PALANCA IZQUIERDA (Giro / Tracción Oruga Izquierda) */}
        <section className="col-span-3 sm:col-span-3 flex flex-col items-center justify-between p-2 rounded-2xl bg-slate-900/40 border border-slate-800/80 shadow-lg">
          <LeverControl
            id="left"
            label="Rueda Izq"
            sublabel="Giro / Ataque"
            value={levers.left}
            onChange={handleLeftChange}
            hasSnapping={snappingEnabled}
            accentColor="cyan"
          />

          {/* Medidor de Potencia Izquierda */}
          <div className="w-full mt-2 pt-2 border-t border-slate-800 flex items-center justify-between px-2 text-[10px] font-mono text-slate-400">
            <span>MOTOR L</span>
            <span className={`font-bold ${motorSpeeds.left !== 0 ? 'text-cyan-300' : 'text-slate-500'}`}>
              {Math.round(motorSpeeds.left)}%
            </span>
          </div>
        </section>

        {/* COLUMNA CENTRAL: PALANCA CENTRAL + HUD COMBATE + DOHYO */}
        <section className="col-span-6 sm:col-span-6 flex flex-col justify-between p-2 md:p-3 rounded-2xl bg-slate-900/60 border border-slate-800 shadow-xl overflow-y-auto">
          
          {/* Header del Centro: Estado de Combate y Aviso de Override */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border ${
                isOverrideActive
                  ? 'bg-amber-950/80 border-amber-600 text-amber-300 animate-pulse'
                  : levers.center !== 0
                    ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}>
                {isOverrideActive ? 'PRIORIDAD DIFERENCIAL ACTIVA' : 'AVANCE RECTILÍNEO'}
              </span>
            </div>

            {/* Botón de Parada de Emergencia Inmediata */}
            <button
              onClick={handleEmergencyStop}
              className="px-2.5 py-1 rounded bg-rose-600/80 hover:bg-rose-500 text-white font-mono text-[10px] font-bold flex items-center gap-1 transition-transform active:scale-95 shadow"
            >
              <RotateCcw className="w-3 h-3" />
              PARADA (0%)
            </button>
          </div>

          {/* Área Central: Simulador de Dohyo y Palanca Central */}
          <div className="flex-1 flex items-center justify-around gap-2 my-1">
            
            {/* Palanca Central (Avance / Retroceso Rectilíneo) */}
            <div className="h-full flex items-center justify-center">
              <LeverControl
                id="center"
                label="Empuje Central"
                sublabel="Avance / Reversa"
                value={levers.center}
                onChange={handleCenterChange}
                isOverridden={isOverrideActive}
                accentColor="emerald"
              />
            </div>

            {/* Simulador de Dohyo Integrado */}
            {showSimulator && (
              <div className="hidden lg:flex flex-col items-center justify-center">
                <DohyoSimulator
                  motorSpeeds={motorSpeeds}
                  overrideActive={isOverrideActive}
                />
              </div>
            )}
          </div>

          {/* Telemetría Inferior y Trama de Paquete BLE en Vivo */}
          <div className="mt-2 pt-2 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[10px] font-mono">
            <div className="p-1 rounded bg-slate-950/70 border border-slate-800">
              <span className="text-slate-500 block text-[9px]">TRAMA BLE</span>
              <span className="text-cyan-300 font-bold truncate block">
                {telemetry.lastPacketPayload || 'V:0,0,0'}
              </span>
            </div>
            <div className="p-1 rounded bg-slate-950/70 border border-slate-800">
              <span className="text-slate-500 block text-[9px]">FRECUENCIA</span>
              <span className="text-slate-200 font-bold">
                {telemetry.packetsPerSec} pkt/s
              </span>
            </div>
            <div className="p-1 rounded bg-slate-950/70 border border-slate-800">
              <span className="text-slate-500 block text-[9px]">THROTTLING</span>
              <span className="text-cyan-400 font-bold">
                {throttleMs} ms ({Math.round(1000 / throttleMs)} Hz)
              </span>
            </div>
            <div className="p-1 rounded bg-slate-950/70 border border-slate-800">
              <span className="text-slate-500 block text-[9px]">LATENCIA</span>
              <span className="text-slate-200 font-bold">
                {telemetry.lastLatencyMs} ms
              </span>
            </div>
          </div>
        </section>

        {/* COLUMNA DERECHA: PALANCA DERECHA (Giro / Tracción Oruga Derecha) */}
        <section className="col-span-3 sm:col-span-3 flex flex-col items-center justify-between p-2 rounded-2xl bg-slate-900/40 border border-slate-800/80 shadow-lg">
          <LeverControl
            id="right"
            label="Rueda Der"
            sublabel="Giro / Ataque"
            value={levers.right}
            onChange={handleRightChange}
            hasSnapping={snappingEnabled}
            accentColor="cyan"
          />

          {/* Medidor de Potencia Derecha */}
          <div className="w-full mt-2 pt-2 border-t border-slate-800 flex items-center justify-between px-2 text-[10px] font-mono text-slate-400">
            <span>MOTOR R</span>
            <span className={`font-bold ${motorSpeeds.right !== 0 ? 'text-cyan-300' : 'text-slate-500'}`}>
              {Math.round(motorSpeeds.right)}%
            </span>
          </div>
        </section>
      </main>

      {/* PIE DE PÁGINA ULTRA-COMPACTO: Instrucciones y Atajos */}
      <footer className="h-7 px-4 bg-slate-950 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
        <div className="flex items-center gap-3">
          <span>Táctil: Desliza pulgares en cada palanca</span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">PC: W/S (Centro), A/D (Giro), Q/E (Orugas), Espacio (Stop)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSnappingEnabled(!snappingEnabled)}
            className="hover:text-slate-300 transition-colors"
          >
            Muescas (Snap): {snappingEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </footer>
    </div>
  );
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Sliders,
  Zap,
  Timer,
  Swords,
  Octagon,
  Volume2,
  VolumeX,
  FileCode,
  Sparkles,
  Info
} from 'lucide-react';
import { bleService } from './services/bleService';
import { soundEffects } from './services/soundEffects';
import { BleConnectionStatus, BleTelemetry, LeverValues, MotorSpeeds, MovementDir, computeSumoMovement } from './types';
import { DirectionalPad } from './components/DirectionalPad';
import { LeverControl } from './components/LeverControl';
import { DohyoSimulator } from './components/DohyoSimulator';
import { FirmwareModal } from './components/FirmwareModal';
import { BatteryIndicator } from './components/BatteryIndicator';

export default function App() {
  // Modo de Control: 'dpad' (Mobile-First Pad Direccional) o 'levers' (3 Palancas virtuales)
  const [controlMode, setControlMode] = useState<'levers' | 'dpad'>('dpad');

  // Formato de Trama BLE: 'char' ('F','R','L','D','S','G') o 'pwm' ("F 255")
  const [payloadFormat, setPayloadFormat] = useState<'char' | 'pwm'>('char');

  // Dirección activa en D-Pad ('F', 'R', 'L', 'D', 'S')
  const [activeDir, setActiveDir] = useState<MovementDir>('S');

  // Control Deslizante de Velocidad PWM (100 a 255)
  const [speed, setSpeed] = useState<number>(220);

  // Estado de las 3 Palancas Virtuales (-100 a +100) para modo Palancas
  const [levers, setLevers] = useState<LeverValues>({
    center: 0,
    left: 0,
    right: 0,
  });

  // Intervalo de Throttling configurable (50ms a 100ms)
  const [throttleMs, setThrottleMs] = useState<number>(60);

  // Estado de Batería del Robot (0% a 100%) recibido desde ESP32
  const [batteryLevel, setBatteryLevel] = useState<number>(bleService.getBattery());

  // Estado BLE y Telemetría
  const [bleStatus, setBleStatus] = useState<BleConnectionStatus>(bleService.status);
  const [bleError, setBleError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<BleTelemetry>({
    packetsSent: 0,
    packetsPerSec: 0,
    lastPacketPayload: 'S 0',
    lastLatencyMs: 0,
    bytesSent: 0,
    lastPacketTimestamp: 0,
    isWriting: false,
    deviceName: null,
    batteryPercentage: bleService.getBattery(),
  });

  // UI Modales y Ajustes
  const [isFirmwareOpen, setIsFirmwareOpen] = useState(false);
  const [firmwareInitialTab, setFirmwareInitialTab] = useState<'appjsx' | 'packagejson' | 'code' | 'wiring'>('appjsx');
  const [showSimulator, setShowSimulator] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Watchdog virtual indicador
  const [watchdogProgress, setWatchdogProgress] = useState(100);

  // Estado del Arranque de Combate ('G') y cuenta regresiva reglamentaria de 3s
  const [combatState, setCombatState] = useState<'idle' | 'countdown' | 'active'>('idle');
  const [countdownSeconds, setCountdownSeconds] = useState<number>(3);

  // Sincronizar controlMode y payloadFormat en el servicio BLE
  useEffect(() => {
    bleService.setControlMode(controlMode);
  }, [controlMode]);

  useEffect(() => {
    bleService.setPayloadFormat(payloadFormat);
  }, [payloadFormat]);

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
      if (telem.batteryPercentage !== undefined) {
        setBatteryLevel(telem.batteryPercentage);
      }
    });

    bleService.onBattery((pct) => {
      setBatteryLevel(pct);
    });

    return () => {
      bleService.destroy();
    };
  }, []);

  // Temporizador para barra de watchdog
  useEffect(() => {
    const timer = setInterval(() => {
      setWatchdogProgress((prev) => Math.max(0, prev - 10));
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // Control de Throttling
  const handleThrottleChange = (ms: number) => {
    setThrottleMs(ms);
    bleService.setThrottleInterval(ms);
  };

  // MANEJO DE MOVIMIENTOS EN MODO D-PAD
  const handleDirectionStart = useCallback((dir: MovementDir) => {
    setActiveDir(dir);
    if (dir === 'S') {
      bleService.forceStopImmediate();
    } else {
      bleService.setDirectCommand(dir, speed);
    }
  }, [speed]);

  const handleDirectionEnd = useCallback(() => {
    setActiveDir('S');
    bleService.forceStopImmediate();
  }, []);

  // Actualizar velocidad en caliente si se mueve en D-Pad
  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (activeDir !== 'S' && controlMode === 'dpad') {
      bleService.setDirectCommand(activeDir, newSpeed);
    }
  };

  // MANEJO DE PALANCAS EN MODO LEVERS
  const isOverrideActive = Math.abs(levers.left) > 3 || Math.abs(levers.right) > 3;
  const currentLeverCmd = computeSumoMovement(levers);

  const motorSpeeds: MotorSpeeds = controlMode === 'dpad'
    ? {
        left: activeDir === 'F' ? (speed / 255) * 100 : activeDir === 'R' ? -(speed / 255) * 100 : activeDir === 'L' ? -(speed / 255) * 80 : activeDir === 'D' ? (speed / 255) * 80 : 0,
        right: activeDir === 'F' ? (speed / 255) * 100 : activeDir === 'R' ? -(speed / 255) * 100 : activeDir === 'L' ? (speed / 255) * 80 : activeDir === 'D' ? -(speed / 255) * 80 : 0,
      }
    : isOverrideActive
    ? { left: levers.left, right: levers.right }
    : { left: levers.center, right: levers.center };

  useEffect(() => {
    if (controlMode === 'levers') {
      bleService.updateLevers({
        center: isOverrideActive ? 0 : levers.center,
        left: levers.left,
        right: levers.right,
      });
    }
  }, [levers, isOverrideActive, controlMode]);

  const handleCenterChange = useCallback((val: number) => {
    setLevers((prev) => ({ ...prev, center: val }));
  }, []);

  const handleLeftChange = useCallback((val: number) => {
    setLevers((prev) => ({ ...prev, left: val }));
  }, []);

  const handleRightChange = useCallback((val: number) => {
    setLevers((prev) => ({ ...prev, right: val }));
  }, []);

  // ARRANQUE DE COMBATE ('G'): Envía 'G' al ESP32 para iniciar el combate
  const handleCombatStart = async () => {
    await bleService.sendCombatStart();
    setCombatState('countdown');
    setCountdownSeconds(3);

    if (soundEnabled) {
      soundEffects.playCountdownBeep();
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate([100, 50, 100]); } catch {}
    }
  };

  // Cuenta regresiva reglamentaria de 3 segundos de quietud en el dohyo
  useEffect(() => {
    if (combatState !== 'countdown') return;

    if (countdownSeconds > 0) {
      const timer = setTimeout(() => {
        setCountdownSeconds((prev) => prev - 1);
        if (soundEnabled) {
          soundEffects.playCountdownBeep();
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(80); } catch {}
        }
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setCombatState('active');
      if (soundEnabled) {
        soundEffects.playCombatStartTone();
      }
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate([200, 100, 300]); } catch {}
      }
    }
  }, [combatState, countdownSeconds, soundEnabled]);

  // Parada inmediata de emergencia ('S 0')
  const handleEmergencyStop = () => {
    setActiveDir('S');
    setLevers({ center: 0, left: 0, right: 0 });
    setCombatState('idle');
    setCountdownSeconds(3);
    if (soundEnabled) {
      soundEffects.playStopTone();
    }
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

  // Atajos de teclado para pruebas en PC (W, A, S, D, Espacio, G)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          handleDirectionStart('F');
          break;
        case 's':
        case 'arrowdown':
          handleDirectionStart('R');
          break;
        case 'a':
        case 'arrowleft':
          handleDirectionStart('L');
          break;
        case 'd':
        case 'arrowright':
          handleDirectionStart('D');
          break;
        case 'g':
          handleCombatStart();
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
        case 'a':
        case 'd':
        case 'arrowup':
        case 'arrowdown':
        case 'arrowleft':
        case 'arrowright':
          handleDirectionEnd();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleDirectionStart, handleDirectionEnd]);

  const openCodeModal = (tab: 'appjsx' | 'packagejson' | 'code' | 'wiring') => {
    setFirmwareInitialTab(tab);
    setIsFirmwareOpen(true);
  };

  return (
    <div className="relative w-screen h-screen min-h-[460px] bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none font-sans">
      
      {/* Modal de Código Fuente, Vercel package.json, y Firmware ESP32 */}
      <FirmwareModal
        isOpen={isFirmwareOpen}
        onClose={() => setIsFirmwareOpen(false)}
        initialTab={firmwareInitialTab}
      />

      {/* BARRA SUPERIOR COMPACTA (Top Bar Contract: 3 Zonas) */}
      <header className="h-12 px-3 sm:px-6 border-b border-slate-800/80 bg-slate-900/95 backdrop-blur-md flex items-center justify-between gap-3 shrink-0 z-30">
        
        {/* Zona 1: Logo & Switch de Modo */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm bg-cyan-400 rotate-45 shadow-sm shadow-cyan-400" />
            <h1 className="font-display font-bold text-sm tracking-wide text-slate-100 uppercase whitespace-nowrap">
              SumoBot BLE
            </h1>
          </div>

          {/* Toggle Modo 3 Palancas vs D-Pad */}
          <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setControlMode('levers')}
              className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                controlMode === 'levers'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              3 Palancas
            </button>
            <button
              onClick={() => setControlMode('dpad')}
              className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                controlMode === 'dpad'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              D-Pad Táctil
            </button>
          </div>
        </div>

        {/* Zona 2: Control de Throttling & Formato BLE & Telemetría en vivo */}
        <div className="hidden md:flex items-center gap-3 text-xs font-mono text-slate-400">
          {/* Selector de Protocolo de Comandos: Carácter ('F') vs PWM ('F 255') */}
          <div className="flex items-center gap-1.5 bg-slate-950/70 px-2 py-0.5 rounded border border-slate-800">
            <span className="text-[10px] uppercase text-slate-500">Trama:</span>
            <button
              type="button"
              onClick={() => {
                const next = payloadFormat === 'char' ? 'pwm' : 'char';
                setPayloadFormat(next);
                bleService.setPayloadFormat(next);
              }}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors"
              title="Alternar entre comandos simples de un carácter ('F','R','L','D','S','G') y comandos con PWM ('F 255')"
            >
              {payloadFormat === 'char' ? "Solo Char ('F','G')" : "PWM ('F 255')"}
            </button>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-950/70 px-2 py-0.5 rounded border border-slate-800">
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[10px] uppercase text-slate-500">Throttling:</span>
            <div className="flex items-center gap-1 ml-1">
              {[50, 60, 80, 100].map((ms) => (
                <button
                  key={ms}
                  type="button"
                  onClick={() => handleThrottleChange(ms)}
                  className={`px-1.5 py-0.2 rounded text-[10px] transition-colors ${
                    throttleMs === ms
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-slate-200 bg-slate-900'
                  }`}
                  title={`Enviar comandos cada ${ms}ms`}
                >
                  {ms}ms
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-950/70 px-2 py-0.5 rounded border border-slate-800 text-[11px]">
            <span>TX: <strong className="text-slate-200">{telemetry.packetsPerSec} Hz</strong></span>
            <span className="text-slate-600">|</span>
            <span>Trama: <strong className="text-cyan-400">{telemetry.lastPacketPayload}</strong></span>
          </div>
        </div>

        {/* Zona 3: Botones de Acción (Batería, Bluetooth, Código, Sonido, Fullscreen) */}
        <div className="flex items-center gap-2">
          {/* Tarjeta Visual Discreta: Estado de Batería del Robot */}
          <BatteryIndicator
            percentage={batteryLevel}
            isConnected={bleStatus === 'connected'}
            onSimulateChange={(newPct) => bleService.setMockBattery(newPct)}
          />

          {/* Botón Ver Código / Vercel */}
          <button
            onClick={() => openCodeModal('appjsx')}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
            title="Ver código fuente de App.jsx y package.json para Vercel"
          >
            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px]">Código Vercel</span>
          </button>

          {/* Botón Audio */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/80 transition-colors"
            title={soundEnabled ? 'Silenciar sonidos de combate' : 'Activar sonidos de combate'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-amber-400" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Botón Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/80 transition-colors"
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa horizontal'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Botón Principal Web Bluetooth */}
          {bleStatus === 'connected' ? (
            <button
              onClick={toggleBleConnection}
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs font-bold hover:bg-emerald-500/30 transition-all shadow-sm shadow-emerald-500/20"
            >
              <BluetoothConnected className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="truncate max-w-[90px] sm:max-w-none">
                {telemetry.deviceName || 'Conectado'}
              </span>
            </button>
          ) : (
            <button
              onClick={toggleBleConnection}
              disabled={bleStatus === 'connecting'}
              className="flex items-center gap-1.5 px-3.5 py-1 rounded-xl bg-cyan-500 hover:bg-cyan-400 active:scale-95 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/25"
            >
              <Bluetooth className={`w-4 h-4 ${bleStatus === 'connecting' ? 'animate-spin' : ''}`} />
              <span>{bleStatus === 'connecting' ? 'Buscando...' : 'Conectar ESP32'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Banner de Error o Alerta si ocurre */}
      {bleError && (
        <div className="bg-rose-950/80 border-b border-rose-800 px-4 py-1.5 flex items-center justify-between text-xs text-rose-300 z-20">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{bleError}</span>
          </div>
          <button
            onClick={() => setBleError(null)}
            className="text-[11px] underline text-rose-400 hover:text-rose-200"
          >
            Entendido
          </button>
        </div>
      )}

      {/* CUERPO PRINCIPAL DEL COCKPIT (MOBILE-FIRST: RESPONSIVE LANDSCAPE & PORTRAIT) */}
      <main className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden relative pb-3 lg:pb-0">
        
        {/* Fondo sutil con grid cibernético de combate */}
        <div 
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.15) 0%, transparent 70%),
                              linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                              linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)`,
            backgroundSize: '100% 100%, 32px 32px, 32px 32px'
          }}
        />

        {/* COLUMNA 1: ZONA TÁCTIL (D-PAD O PALANCA IZQ) */}
        <section className="w-full lg:w-[32%] lg:min-w-[220px] p-2 sm:p-3 flex flex-col justify-center items-center border-b lg:border-b-0 lg:border-r border-slate-800/80 bg-slate-900/40 relative z-10 shrink-0 lg:shrink lg:h-full order-2 lg:order-1">
          <div className="w-full flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {controlMode === 'dpad' ? 'D-Pad Táctil' : 'Tracción Izq.'}
            </span>
            <span className="text-[9px] font-mono text-slate-500">
              {controlMode === 'dpad' ? `DIR: ${activeDir}` : `${levers.left}%`}
            </span>
          </div>

          <div className="flex-1 w-full flex items-center justify-center py-2 lg:py-0">
            {controlMode === 'dpad' ? (
              <DirectionalPad
                onDirectionStart={handleDirectionStart}
                onDirectionEnd={handleDirectionEnd}
                activeDirection={activeDir}
                speed={speed}
              />
            ) : (
              <div className="h-full flex items-center justify-center py-2">
                <LeverControl
                  id="left"
                  label="TRACCIÓN IZQUIERDA"
                  sublabel="Diferencial Izq."
                  value={levers.left}
                  onChange={handleLeftChange}
                  accentColor="cyan"
                  hasSnapping={true}
                  isOverridden={false}
                />
              </div>
            )}
          </div>
        </section>

        {/* COLUMNA 2: NÚCLEO TÁCTICO CENTRAL (INICIO DE COMBATE 'G', DOHYO SIMULATOR, PALANCA CENTRAL Y FRENO) */}
        <section className="flex-1 w-full p-2 sm:p-3 flex flex-col justify-between items-center bg-slate-950/60 relative z-10 min-h-[140px] lg:h-full shrink-0 lg:shrink order-1 lg:order-2 gap-3 lg:gap-0">
          
          {/* 1. SECCIÓN SUPERIOR: BOTÓN DESTACADO DE INICIO DE COMBATE ('G') Y BOTÓN DE FRENO */}
          <div className="w-full max-w-xl flex items-center gap-2 shrink-0">
            {/* BOTÓN DESTACADO DE COMBATE O CUENTA REGRESIVA */}
            <div className="flex-1">
              {combatState === 'countdown' ? (
                <div className="w-full py-2 px-3 bg-gradient-to-r from-amber-600/30 via-amber-500/20 to-amber-600/30 border-2 border-amber-400 rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-amber-500/20 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center font-black text-xl font-mono shadow-md">
                    {countdownSeconds}
                  </div>
                  <div className="text-left">
                    <span className="text-xs font-black uppercase text-amber-300 tracking-wider block">
                      ¡3s de Quietud Reglamentaria!
                    </span>
                    <span className="text-[9px] font-mono text-amber-200/80">
                      Motores bloqueados en el dohyo
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCombatStart}
                  className="w-full group relative py-2.5 px-3 bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:via-rose-500 hover:to-amber-500 active:scale-[0.98] text-white rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-rose-600/30 transition-all border border-rose-400/40"
                >
                  <Swords className="w-4 h-4 text-amber-300 shrink-0 group-hover:rotate-12 transition-transform" />
                  <span className="drop-shadow-sm font-display tracking-wider">
                    {combatState === 'active' ? '¡REINICIAR COMBATE (G)!' : 'INICIAR COMBATE (G)'}
                  </span>
                  <span className="ml-auto text-[9px] font-mono bg-black/40 px-1.5 py-0.5 rounded text-amber-200">
                    3s
                  </span>
                </button>
              )}
            </div>

            {/* BOTÓN DE FRENO DE EMERGENCIA ('S' o 'S 0') */}
            <button
              type="button"
              onClick={handleEmergencyStop}
              className="py-2.5 px-3 bg-rose-950/70 hover:bg-rose-900 border-2 border-rose-600/80 active:scale-95 text-rose-200 rounded-xl font-bold text-xs uppercase flex items-center gap-1.5 shadow-md shadow-rose-950/50 transition-all shrink-0"
              title="Detener motores inmediatamente (Espacio / 'S')"
            >
              <Octagon className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="hidden sm:inline">FRENO</span>
              <span>({payloadFormat === 'char' ? "'S'" : "'S 0'"})</span>
            </button>
          </div>

          {/* 2. SECCIÓN CENTRAL INTERMEDIA: PALANCA CENTRAL */}
          {controlMode === 'levers' ? (
            <div className="flex-1 w-full max-w-xl flex items-center justify-center my-1 min-h-0">
              {/* Palanca Central (Empuje Rectilíneo Avance / Reversa) */}
              <div className="h-full flex flex-col items-center justify-center py-1">
                <LeverControl
                  id="center"
                  label="EMPUJE CENTRAL"
                  sublabel="Avance / Reversa"
                  value={levers.center}
                  onChange={handleCenterChange}
                  accentColor="emerald"
                  hasSnapping={true}
                  isOverridden={isOverrideActive}
                />
              </div>
            </div>
          ) : (
            /* Modo D-Pad: slider de velocidad */
            <div className="flex-1 w-full max-w-md flex flex-col items-center justify-center gap-3 my-1">
              <div className="w-full bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-lg">
                <div className="flex items-center justify-between text-xs font-mono mb-2">
                  <div className="flex items-center gap-2 text-slate-300 font-semibold">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span className="text-xs">Velocidad PWM</span>
                  </div>
                  <strong className="text-cyan-400 text-xs">{speed} / 255</strong>
                </div>
                <input
                  type="range"
                  min="100"
                  max="255"
                  step="5"
                  value={speed}
                  onChange={(e) => handleSpeedChange(Number(e.target.value))}
                  className="w-full h-3 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>
            </div>
          )}

          {/* 3. SECCIÓN INFERIOR: PRESETS RÁPIDOS DE POTENCIA Y BARRA DE ESTADO */}
          <div className="w-full max-w-xl flex items-center justify-between gap-2 px-1 text-xs font-mono shrink-0">
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-slate-500 uppercase">Trim:</span>
              {[
                { val: 100, label: 'Min' },
                { val: 180, label: '180' },
                { val: 220, label: '220' },
                { val: 255, label: 'Max' },
              ].map((p) => (
                <button
                  key={p.val}
                  type="button"
                  onClick={() => handleSpeedChange(p.val)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    speed === p.val
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Telemetría Compacta */}
            <div className="flex items-center gap-2 text-[10px] text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
              <span>TX: <strong className="text-slate-200">{telemetry.packetsPerSec} Hz</strong></span>
              <span className="text-slate-600">•</span>
              <span>Trama: <strong className="text-cyan-400">{telemetry.lastPacketPayload}</strong></span>
              <span className="text-slate-600">•</span>
              <span>Bat: <strong className={batteryLevel > 50 ? 'text-emerald-400' : batteryLevel >= 20 ? 'text-amber-400' : 'text-rose-400'}>{batteryLevel}%</strong></span>
            </div>

            {/* Enlace rápido para ver package.json limpio */}
            <button
              type="button"
              onClick={() => openCodeModal('packagejson')}
              className="px-2 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded text-[10px] font-mono flex items-center gap-1 transition-colors"
              title="Copiar package.json sin conflictos ERESOLVE"
            >
              <FileCode className="w-3 h-3 text-emerald-400" />
              <span>Vercel</span>
            </button>
          </div>
        </section>

        {/* COLUMNA 3: ZONA DERECHA (MANIOBRAS RÁPIDAS / SIMULADOR / PALANCA DERECHA) */}
        <section className="w-full lg:w-[32%] lg:min-w-[220px] p-2 sm:p-3 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-800/80 bg-slate-900/40 relative z-10 shrink-0 lg:shrink lg:h-full order-3">
          
          <div className="w-full flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {controlMode === 'dpad' ? 'Maniobras de Ataque' : 'Tracción Der.'}
            </span>
            <span className="text-[9px] font-mono text-slate-500">
              {controlMode === 'dpad' ? 'Táctico' : `${levers.right}%`}
            </span>
          </div>

          {controlMode === 'dpad' ? (
            <div className="flex-1 flex flex-col justify-between py-1 gap-2">
              
              {/* Botón Embestida Turbo a 255 */}
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); setSpeed(255); handleDirectionStart('F'); }}
                onPointerUp={handleDirectionEnd}
                onPointerCancel={handleDirectionEnd}
                onPointerLeave={handleDirectionEnd}
                className="py-2.5 px-3 bg-gradient-to-r from-slate-800 to-slate-850 hover:bg-slate-750 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-bold flex items-center justify-between shadow-md active:scale-95 transition-all"
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <span>Embestida Turbo</span>
                </div>
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold">
                  F 255
                </span>
              </button>

              {/* Botón Giro Rápido Tornado Izquierda */}
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); setSpeed(240); handleDirectionStart('L'); }}
                onPointerUp={handleDirectionEnd}
                onPointerCancel={handleDirectionEnd}
                onPointerLeave={handleDirectionEnd}
                className="py-2.5 px-3 bg-gradient-to-r from-slate-800 to-slate-850 hover:bg-slate-750 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-between shadow-md active:scale-95 transition-all"
              >
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-amber-400" />
                  <span>Tornado Izq. ↺</span>
                </div>
                <span className="text-[10px] font-mono bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">
                  L 240
                </span>
              </button>

              {/* Botón Giro Rápido Tornado Derecha */}
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); setSpeed(240); handleDirectionStart('D'); }}
                onPointerUp={handleDirectionEnd}
                onPointerCancel={handleDirectionEnd}
                onPointerLeave={handleDirectionEnd}
                className="py-2.5 px-3 bg-gradient-to-r from-slate-800 to-slate-850 hover:bg-slate-750 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-between shadow-md active:scale-95 transition-all"
              >
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-amber-400 scale-x-[-1]" />
                  <span>Tornado Der. ↻</span>
                </div>
                <span className="text-[10px] font-mono bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">
                  D 240
                </span>
              </button>

              {/* Monitor de Sensores TCRT5000 (Pines GPIO 35 y 34) */}
              <div className="bg-slate-950/90 p-2.5 rounded-xl border border-slate-800 text-[11px] font-mono">
                <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold mb-1.5">
                  <span>Sensores de Borde</span>
                  <span className="text-emerald-400">Activos</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="bg-slate-900 px-2 py-1 rounded border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400 text-[10px]">Delantero (35):</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400" title="Línea no detectada" />
                  </div>
                  <div className="bg-slate-900 px-2 py-1 rounded border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400 text-[10px]">Trasero (34):</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400" title="Línea no detectada" />
                  </div>
                </div>
              </div>

              {/* Mini Simulador de Dohyo */}
              <button
                type="button"
                onClick={() => setShowSimulator(!showSimulator)}
                className="py-1 px-2 bg-slate-950/70 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-lg text-[10px] font-mono flex items-center justify-center gap-1 transition-colors"
              >
                <span>{showSimulator ? 'Ocultar Dohyo 2D' : 'Ver Radar Dohyo 2D'}</span>
              </button>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center py-2">
              <LeverControl
                id="right"
                label="TRACCIÓN DERECHA"
                sublabel="Diferencial Der."
                value={levers.right}
                onChange={handleRightChange}
                accentColor="amber"
                hasSnapping={true}
                isOverridden={false}
              />
            </div>
          )}
        </section>

      </main>

      {/* Modal flotante con Simulador de Dohyo si el usuario lo activa */}
      {showSimulator && (
        <div className="absolute right-4 bottom-4 z-40 w-72 bg-slate-900/95 border-2 border-slate-700 rounded-2xl shadow-2xl p-3 animate-fadeIn">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono font-bold text-cyan-400 uppercase">
              Radar Dohyo 2D
            </span>
            <button
              onClick={() => setShowSimulator(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <DohyoSimulator motorSpeeds={motorSpeeds} overrideActive={isOverrideActive} />
        </div>
      )}

      {/* Watchdog Bar inferior sutil */}
      <div className="h-1 w-full bg-slate-900">
        <div 
          className="h-full bg-cyan-400 transition-all duration-100"
          style={{ width: `${watchdogProgress}%` }}
        />
      </div>

    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Bluetooth, 
  BluetoothConnected, 
  Octagon, 
  Swords, 
  Zap, 
  Sliders, 
  RotateCcw,
  RotateCw,
  ChevronUp,
  ChevronDown,
  Battery,
  ShieldAlert,
  Volume2,
  VolumeX
} from 'lucide-react';

// Parámetros BLE estrictos para Robot de Sumo ESP32
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHARACTERISTIC_UUID = "c565818d-6972-466d-88b0-517865f14d02";

// Puntos de muesca visual para las palancas
const NOTCH_POINTS = [100, 50, 0, -50, -100];

export default function App() {
  // Modo de control: 'dpad' (Mobile-First Pad Direccional) o 'levers' (3 Palancas virtuales)
  const [controlMode, setControlMode] = useState('dpad');

  // Formato de trama BLE: 'char' (envía 'F', 'R', 'L', 'D', 'S', 'G') o 'pwm' (envía 'F 255')
  const [payloadFormat, setPayloadFormat] = useState('char');

  // Estado de Batería del Robot (0% a 100%)
  const [batteryLevel, setBatteryLevel] = useState(85);

  // Estado de conexión Web Bluetooth
  const [device, setDevice] = useState(null);
  const [characteristic, setCharacteristic] = useState(null);
  const [status, setStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  
  // Dirección activa en D-Pad ('F', 'R', 'L', 'D', 'S')
  const [activeDpadDir, setActiveDpadDir] = useState('S');

  // Valores de las 3 Palancas Virtuales (-100 a +100)
  const [levers, setLevers] = useState({ center: 0, left: 0, right: 0 });
  
  // Parámetros de velocidad PWM (100 a 255)
  const [speed, setSpeed] = useState(220);

  // Arranque de Combate ('G') y cuenta regresiva reglamentaria de 3s
  const [combatState, setCombatState] = useState('idle'); // 'idle' | 'countdown' | 'active'
  const [countdown, setCountdown] = useState(3);
  
  // Telemetría de transmisión
  const [lastPayload, setLastPayload] = useState('S');
  const [packetsSent, setPacketsSent] = useState(0);

  // Control de flujo (Throttling a 60ms y Candado Mutex)
  const isWritingRef = useRef(false);
  const characteristicRef = useRef(null);
  const lastSentPayloadRef = useRef('S');
  const leversRef = useRef({ center: 0, left: 0, right: 0 });
  const controlModeRef = useRef('dpad');
  const dpadDirRef = useRef('S');
  const speedRef = useRef(220);
  const payloadFormatRef = useRef('char');

  // Sincronizar referencias para evitar cierres obsoletos en el timer
  characteristicRef.current = characteristic;
  leversRef.current = levers;
  controlModeRef.current = controlMode;
  dpadDirRef.current = activeDpadDir;
  speedRef.current = speed;
  payloadFormatRef.current = payloadFormat;

  // Anulación diferencial: si se toca palanca izquierda o derecha, se desactiva la central
  const isOverrideActive = Math.abs(levers.left) > 3 || Math.abs(levers.right) > 3;

  // Cálculo del comando según las 3 palancas
  const computeCommandFromLevers = (vals) => {
    const hasDiff = Math.abs(vals.left) > 3 || Math.abs(vals.right) > 3;
    if (hasDiff) {
      const netTurn = vals.left - vals.right;
      const netThrust = (vals.left + vals.right) / 2;
      if (Math.abs(netTurn) >= Math.abs(netThrust)) {
        const absTurn = Math.min(100, Math.abs(netTurn));
        const pwm = Math.round((absTurn / 100) * 255);
        return { dir: netTurn > 0 ? 'D' : 'L', speed: pwm };
      } else {
        const pwm = Math.round((Math.abs(netThrust) / 100) * 255);
        return { dir: netThrust > 0 ? 'F' : 'R', speed: pwm };
      }
    }
    if (Math.abs(vals.center) > 3) {
      const pwm = Math.round((Math.abs(vals.center) / 100) * 255);
      return { dir: vals.center > 0 ? 'F' : 'R', speed: pwm };
    }
    return { dir: 'S', speed: 0 };
  };

  // Transmisión de bajo nivel por BLE con candado Mutex
  const sendPacket = async (payload) => {
    if (!characteristicRef.current || isWritingRef.current) return;
    isWritingRef.current = true;
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(payload);
      if (typeof characteristicRef.current.writeValueWithoutResponse === 'function') {
        await characteristicRef.current.writeValueWithoutResponse(data);
      } else {
        await characteristicRef.current.writeValue(data);
      }
      const clean = payload.trim();
      lastSentPayloadRef.current = clean;
      setLastPayload(clean);
      setPacketsSent((p) => p + 1);
    } catch (err) {
      console.warn('[BLE TX Error]', err);
    } finally {
      isWritingRef.current = false;
    }
  };

  // Bucle de Throttling a 60ms (Control de velocidad estricto para no saturar al ESP32)
  useEffect(() => {
    if (status !== 'connected') return;

    const interval = setInterval(() => {
      let dir = 'S';
      let spd = 0;

      if (controlModeRef.current === 'levers') {
        const cmd = computeCommandFromLevers(leversRef.current);
        dir = cmd.dir;
        spd = cmd.speed;
      } else {
        dir = dpadDirRef.current;
        spd = dir === 'S' ? 0 : speedRef.current;
      }

      const payload = payloadFormatRef.current === 'char'
        ? `${dir}\n`
        : `${dir} ${spd}\n`;

      // Transmitir si cambió el valor o keep-alive en movimiento
      if (payload.trim() !== lastSentPayloadRef.current || dir !== 'S') {
        sendPacket(payload);
      }
    }, 60); // 60ms = ~16Hz

    return () => clearInterval(interval);
  }, [status]);

  // Manejo de conexión Web Bluetooth
  const connectBLE = async () => {
    if (!navigator.bluetooth) {
      setStatus('error');
      setErrorMessage('Tu navegador no soporta Web Bluetooth. Usa Chrome o Edge en Android/PC.');
      return;
    }

    try {
      setStatus('connecting');
      setErrorMessage('');

      const selectedDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'ESP32_Sumo' },
          { namePrefix: 'SumoBot' },
          { services: [SERVICE_UUID] }
        ],
        optionalServices: [SERVICE_UUID]
      }).catch(async (err) => {
        if (err.name === 'NotFoundError') throw err;
        return await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [SERVICE_UUID]
        });
      });

      if (!selectedDevice) {
        setStatus('disconnected');
        return;
      }

      setDevice(selectedDevice);

      selectedDevice.addEventListener('gattserverdisconnected', () => {
        setDevice(null);
        setCharacteristic(null);
        setStatus('disconnected');
        setCombatState('idle');
      });

      const server = await selectedDevice.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const char = await service.getCharacteristic(CHARACTERISTIC_UUID);

      // Iniciar notificaciones para recibir la batería desde ESP32 en tiempo real
      try {
        if (typeof char.startNotifications === 'function') {
          await char.startNotifications();
          char.addEventListener('characteristicvaluechanged', (ev) => {
            try {
              const text = new TextDecoder().decode(ev.target.value).trim();
              const match = text.match(/(?:BAT|BATTERY|B)?[:=\s]?\s*(\d{1,3})/i);
              if (match && match[1]) {
                const pct = parseInt(match[1], 10);
                if (!isNaN(pct) && pct >= 0 && pct <= 100) {
                  setBatteryLevel(pct);
                }
              }
            } catch (rxErr) {
              console.warn('[BLE RX Error]', rxErr);
            }
          });
        }
      } catch (notifErr) {
        console.info('[BLE] startNotifications no soportado en esta plataforma', notifErr);
      }

      setCharacteristic(char);
      setStatus('connected');
    } catch (err) {
      console.warn('Fallo al conectar:', err);
      if (err.name === 'NotFoundError') {
        setStatus('disconnected');
      } else {
        setStatus('error');
        setErrorMessage(err.message || 'Error al conectar por Bluetooth con el ESP32');
      }
    }
  };

  const disconnectBLE = async () => {
    if (device && device.gatt && device.gatt.connected) {
      device.gatt.disconnect();
    }
    setDevice(null);
    setCharacteristic(null);
    setStatus('disconnected');
    setCombatState('idle');
  };

  // Botón de Inicio de Combate ('G'): Envía 'G' para desbloquear la cuenta regresiva en ESP32
  const handleCombatStart = async () => {
    setActiveDpadDir('S');
    setLevers({ center: 0, left: 0, right: 0 });
    await sendPacket('G\n');
    setCombatState('countdown');
    setCountdown(3);

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate([100, 50, 100]); } catch {}
    }
  };

  // Cuenta regresiva reglamentaria de 3 segundos
  useEffect(() => {
    if (combatState !== 'countdown') return;

    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((c) => c - 1);
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(80); } catch {}
        }
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setCombatState('active');
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate([200, 100, 300]); } catch {}
      }
    }
  }, [combatState, countdown]);

  // Parada de Emergencia ('S' o 'S 0')
  const handleEmergencyStop = () => {
    setActiveDpadDir('S');
    setLevers({ center: 0, left: 0, right: 0 });
    setCombatState('idle');
    setCountdown(3);
    const stopPayload = payloadFormat === 'char' ? 'S\n' : 'S 0\n';
    sendPacket(stopPayload);
  };

  // Manejo de eventos táctiles para D-Pad
  const handleDpadPress = (dir) => {
    setActiveDpadDir(dir);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(25); } catch {}
    }
  };

  const handleDpadRelease = () => {
    setActiveDpadDir('S');
    const stopPayload = payloadFormat === 'char' ? 'S\n' : 'S 0\n';
    sendPacket(stopPayload);
  };

  // Colores dinámicos de Batería (>50% Verde, 20-50% Amarillo, <20% Rojo)
  const getBatteryTheme = (pct) => {
    if (pct > 50) return { text: 'text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500', bar: 'bg-emerald-400' };
    if (pct >= 20) return { text: 'text-amber-400', border: 'border-amber-500/40', bg: 'bg-amber-500', bar: 'bg-amber-400' };
    return { text: 'text-rose-400', border: 'border-rose-500/40', bg: 'bg-rose-500', bar: 'bg-rose-400' };
  };

  const batTheme = getBatteryTheme(batteryLevel);

  return (
    <div className="relative w-screen h-screen min-h-[460px] bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none font-sans">
      
      {/* BARRA SUPERIOR COMPACTA */}
      <header className="h-12 px-3 sm:px-6 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md flex items-center justify-between gap-3 shrink-0 z-30">
        
        {/* Logo & Toggle de Modo */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm bg-cyan-400 rotate-45 shadow-sm shadow-cyan-400" />
            <h1 className="font-bold text-sm tracking-wide text-slate-100 uppercase whitespace-nowrap">
              SumoBot BLE
            </h1>
          </div>

          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
            <button
              onClick={() => setControlMode('dpad')}
              className={`px-2 py-0.5 rounded font-medium transition-colors ${
                controlMode === 'dpad' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              D-Pad
            </button>
            <button
              onClick={() => setControlMode('levers')}
              className={`px-2 py-0.5 rounded font-medium transition-colors ${
                controlMode === 'levers' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              3 Palancas
            </button>
          </div>
        </div>

        {/* Formato BLE & Telemetría en pantallas medianas */}
        <div className="hidden md:flex items-center gap-2 text-xs font-mono text-slate-400">
          <button
            onClick={() => setPayloadFormat((f) => (f === 'char' ? 'pwm' : 'char'))}
            className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-cyan-400 font-mono hover:bg-slate-900"
            title="Alternar entre protocolo de solo carácter ('F','G') y comando con PWM ('F 255')"
          >
            Trama: {payloadFormat === 'char' ? "Solo Char ('F','G')" : "PWM ('F 255')"}
          </button>
          <span className="text-slate-700">|</span>
          <span>TX: <strong className="text-cyan-400">{lastPayload}</strong></span>
        </div>

        {/* Batería & Conexión Bluetooth */}
        <div className="flex items-center gap-2">
          
          {/* Tarjeta Visual Discreta de Batería */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/90 border ${batTheme.border} text-xs font-mono shadow-sm`}>
            <div className="relative flex items-center">
              <Battery className={`w-4 h-4 ${batTheme.text}`} />
              <div 
                className={`absolute left-0.5 top-1.5 bottom-1.5 rounded-xs ${batTheme.bar} opacity-70`}
                style={{ width: `${Math.max(2, (batteryLevel / 100) * 10)}px` }}
              />
            </div>
            <span className={`font-bold ${batTheme.text}`}>{batteryLevel}%</span>
          </div>

          {/* Botón Principal Web Bluetooth */}
          {status === 'connected' ? (
            <button
              onClick={disconnectBLE}
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs font-bold hover:bg-emerald-500/30 transition-all shadow-sm"
            >
              <BluetoothConnected className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="truncate max-w-[90px] sm:max-w-none">
                {device?.name || 'Conectado'}
              </span>
            </button>
          ) : (
            <button
              onClick={connectBLE}
              disabled={status === 'connecting'}
              className="flex items-center gap-1.5 px-3.5 py-1 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20 active:scale-95"
            >
              <Bluetooth className={`w-4 h-4 ${status === 'connecting' ? 'animate-spin' : ''}`} />
              <span>{status === 'connecting' ? 'Buscando...' : 'Conectar ESP32'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Banner de Error si ocurre */}
      {errorMessage && (
        <div className="bg-rose-950/80 border-b border-rose-800 px-4 py-1.5 text-xs text-rose-300 flex items-center justify-between z-20">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage('')} className="underline text-rose-400 hover:text-rose-200">
            Cerrar
          </button>
        </div>
      )}

      {/* CUERPO PRINCIPAL DEL COCKPIT (MOBILE-FIRST: RESPONSIVO EN PORTRAIT Y LANDSCAPE) */}
      <main className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden relative pb-3 lg:pb-0">

        {/* SECCIÓN 1: D-PAD MANUAL O PALANCA IZQUIERDA */}
        <section className="w-full lg:w-[32%] lg:min-w-[220px] p-2 sm:p-3 flex flex-col justify-center items-center border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-900/30 relative z-10 shrink-0 lg:shrink lg:h-full order-2 lg:order-1">
          <div className="w-full flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-mono font-bold uppercase text-slate-400">
              {controlMode === 'dpad' ? 'Pad de Control Manual' : 'Tracción Izquierda'}
            </span>
            <span className="text-[10px] font-mono text-cyan-400 font-bold">
              {controlMode === 'dpad' ? `DIR: ${activeDpadDir}` : `${levers.left}%`}
            </span>
          </div>

          <div className="flex-1 w-full flex items-center justify-center py-2 lg:py-0">
            {controlMode === 'dpad' ? (
              <div className="flex flex-col items-center justify-center select-none touch-none w-full max-w-xs">
                {/* Pad Direccional 3x3 */}
                <div className="relative w-64 h-64 sm:w-72 sm:h-72 grid grid-cols-3 grid-rows-3 gap-2.5 p-3 bg-slate-900/95 border-2 border-slate-700/80 rounded-3xl shadow-2xl backdrop-blur-md">
                  
                  {/* Esquina sup izq */}
                  <div className="flex flex-col items-center justify-center text-[9px] font-mono text-slate-500 font-bold">
                    <span>W / ↑</span>
                  </div>

                  {/* ADELANTE ('F') */}
                  <button
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); handleDpadPress('F'); }}
                    onPointerUp={handleDpadRelease}
                    onPointerCancel={handleDpadRelease}
                    onPointerLeave={handleDpadRelease}
                    className={`col-start-2 row-start-1 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 shadow-md ${
                      activeDpadDir === 'F'
                        ? 'bg-emerald-500 text-slate-950 font-black ring-4 ring-emerald-400 scale-95'
                        : 'bg-slate-800 text-emerald-400 hover:bg-slate-750 border-2 border-emerald-500/40'
                    }`}
                    title="Adelante (envía 'F')"
                  >
                    <ChevronUp className="w-8 h-8 sm:w-10 sm:h-10" />
                    <span className="text-xs font-mono font-black leading-none">F</span>
                    <span className="text-[8px] font-mono uppercase opacity-80">Adelante</span>
                  </button>

                  {/* Esquina sup der */}
                  <div className="flex flex-col items-center justify-center text-[9px] font-mono text-slate-500 font-bold">
                    <span className="text-cyan-400">{speed}</span>
                    <span className="text-[8px]">PWM</span>
                  </div>

                  {/* GIRO IZQUIERDA ('L') */}
                  <button
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); handleDpadPress('L'); }}
                    onPointerUp={handleDpadRelease}
                    onPointerCancel={handleDpadRelease}
                    onPointerLeave={handleDpadRelease}
                    className={`col-start-1 row-start-2 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 shadow-md ${
                      activeDpadDir === 'L'
                        ? 'bg-amber-500 text-slate-950 font-black ring-4 ring-amber-400 scale-95'
                        : 'bg-slate-800 text-amber-400 hover:bg-slate-750 border-2 border-amber-500/40'
                    }`}
                    title="Giro Izquierda (envía 'L')"
                  >
                    <RotateCcw className="w-7 h-7 sm:w-8 sm:h-8" />
                    <span className="text-xs font-mono font-black leading-none">L</span>
                    <span className="text-[8px] font-mono uppercase opacity-80">Giro Izq</span>
                  </button>

                  {/* FRENO / STOP ('S') */}
                  <button
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); handleEmergencyStop(); }}
                    className={`col-start-2 row-start-2 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-90 shadow-inner ${
                      activeDpadDir === 'S'
                        ? 'bg-rose-600 text-white font-black ring-4 ring-rose-400'
                        : 'bg-slate-850 text-rose-400 hover:bg-slate-800 border-2 border-rose-500/50'
                    }`}
                    title="Detener / Stop (envía 'S')"
                  >
                    <Octagon className="w-6 h-6 sm:w-7 sm:h-7" />
                    <span className="text-[11px] font-mono font-black uppercase mt-0.5">STOP</span>
                    <span className="text-[9px] text-rose-300 font-mono font-bold leading-none">'S'</span>
                  </button>

                  {/* GIRO DERECHA ('D') */}
                  <button
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); handleDpadPress('D'); }}
                    onPointerUp={handleDpadRelease}
                    onPointerCancel={handleDpadRelease}
                    onPointerLeave={handleDpadRelease}
                    className={`col-start-3 row-start-2 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 shadow-md ${
                      activeDpadDir === 'D'
                        ? 'bg-amber-500 text-slate-950 font-black ring-4 ring-amber-400 scale-95'
                        : 'bg-slate-800 text-amber-400 hover:bg-slate-750 border-2 border-amber-500/40'
                    }`}
                    title="Giro Derecha (envía 'D')"
                  >
                    <RotateCw className="w-7 h-7 sm:w-8 sm:h-8" />
                    <span className="text-xs font-mono font-black leading-none">D</span>
                    <span className="text-[8px] font-mono uppercase opacity-80">Giro Der</span>
                  </button>

                  {/* Esquina inf izq */}
                  <div className="flex flex-col items-center justify-center text-[9px] font-mono text-slate-500 font-bold">
                    <span>A / ◀</span>
                  </div>

                  {/* ATRÁS ('R') */}
                  <button
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); handleDpadPress('R'); }}
                    onPointerUp={handleDpadRelease}
                    onPointerCancel={handleDpadRelease}
                    onPointerLeave={handleDpadRelease}
                    className={`col-start-2 row-start-3 flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 shadow-md ${
                      activeDpadDir === 'R'
                        ? 'bg-cyan-500 text-slate-950 font-black ring-4 ring-cyan-400 scale-95'
                        : 'bg-slate-800 text-cyan-400 hover:bg-slate-750 border-2 border-cyan-500/40'
                    }`}
                    title="Atrás (envía 'R')"
                  >
                    <ChevronDown className="w-8 h-8 sm:w-10 sm:h-10" />
                    <span className="text-xs font-mono font-black leading-none">R</span>
                    <span className="text-[8px] font-mono uppercase opacity-80">Atrás</span>
                  </button>

                  {/* Esquina inf der */}
                  <div className="flex flex-col items-center justify-center text-[9px] font-mono text-slate-500 font-bold">
                    <span>D / ▶</span>
                  </div>
                </div>

                <span className="text-[10px] font-mono text-slate-500 mt-2">
                  Mantén presionado para avanzar • Suelta para frenar ('S')
                </span>
              </div>
            ) : (
              <VirtualLever
                label="IZQUIERDA"
                value={levers.left}
                onChange={(val) => setLevers((prev) => ({ ...prev, left: val }))}
                accent="cyan"
              />
            )}
          </div>
        </section>

        {/* SECCIÓN 2: NÚCLEO TÁCTICO CENTRAL (INICIO DE COMBATE 'G', FRENO Y VELOCIDAD) */}
        <section className="flex-1 w-full p-2 sm:p-3 flex flex-col justify-between items-center bg-slate-950/60 relative z-10 min-h-[140px] lg:h-full shrink-0 lg:shrink order-1 lg:order-2 gap-3 lg:gap-0">
          
          {/* Fila Superior: Botón Destacado de Inicio de Combate ('G') y Botón de Freno */}
          <div className="w-full max-w-xl flex items-center gap-2 shrink-0">
            {/* BOTÓN DESTACADO DE COMBATE O CUENTA REGRESIVA */}
            <div className="flex-1">
              {combatState === 'countdown' ? (
                <div className="w-full py-2 px-3 bg-gradient-to-r from-amber-600/30 to-amber-500/20 border-2 border-amber-400 rounded-xl flex items-center justify-center gap-3 animate-pulse shadow-lg shadow-amber-500/20">
                  <div className="w-8 h-8 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center font-black text-xl font-mono shadow-md">
                    {countdown}
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
                  className="w-full group py-2.5 px-3 bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:via-rose-500 hover:to-amber-500 active:scale-98 text-white rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-rose-600/30 border border-rose-400/40 transition-all"
                >
                  <Swords className="w-4 h-4 text-amber-300 shrink-0 group-hover:rotate-12 transition-transform" />
                  <span className="font-bold tracking-wider">
                    {combatState === 'active' ? '¡REINICIAR COMBATE (G)!' : 'INICIAR COMBATE (G)'}
                  </span>
                  <span className="ml-auto text-[9px] font-mono bg-black/40 px-1.5 py-0.5 rounded text-amber-200">
                    3s
                  </span>
                </button>
              )}
            </div>

            {/* BOTÓN DE FRENO DE EMERGENCIA ('S') */}
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

          {/* Zona Intermedia: Palanca Central o Slider de Velocidad */}
          {controlMode === 'levers' ? (
            <div className="flex-1 w-full max-w-xl flex items-center justify-center my-1 min-h-0">
              <VirtualLever
                label="EMPUJE CENTRAL"
                value={levers.center}
                onChange={(val) => setLevers((prev) => ({ ...prev, center: val }))}
                accent="emerald"
                isOverridden={isOverrideActive}
              />
            </div>
          ) : (
            <div className="flex-1 w-full max-w-md flex flex-col items-center justify-center gap-2 my-1">
              <div className="w-full bg-slate-900/90 border border-slate-800 rounded-xl p-3 shadow-lg">
                <div className="flex items-center justify-between text-xs font-mono mb-2">
                  <div className="flex items-center gap-2 text-slate-300 font-semibold">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span>Velocidad PWM</span>
                  </div>
                  <strong className="text-cyan-400">{speed} / 255</strong>
                </div>
                <input
                  type="range"
                  min="100"
                  max="255"
                  step="5"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-full h-3 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>
            </div>
          )}

          {/* Fila Inferior: Presets Rápidos y Telemetría */}
          <div className="w-full max-w-xl flex items-center justify-between gap-2 px-1 text-xs font-mono shrink-0">
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-slate-500 uppercase">Trim:</span>
              {[100, 180, 220, 255].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSpeed(val)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    speed === val ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {val === 100 ? 'Min' : val === 255 ? 'Max' : val}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[10px] text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
              <span>TX: <strong className="text-cyan-400">{lastPayload}</strong></span>
              <span className="text-slate-600">•</span>
              <span>Bat: <strong className={batTheme.text}>{batteryLevel}%</strong></span>
            </div>
          </div>
        </section>

        {/* SECCIÓN 3: MANIOBRAS TÁCTICAS O PALANCA DERECHA */}
        <section className="w-full lg:w-[32%] lg:min-w-[220px] p-2 sm:p-3 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900/30 relative z-10 shrink-0 lg:shrink lg:h-full order-3">
          <div className="w-full flex items-center justify-between px-2 mb-1">
            <span className="text-[10px] font-mono font-bold uppercase text-slate-400">
              {controlMode === 'dpad' ? 'Maniobras Rápidas' : 'Tracción Derecha'}
            </span>
            <span className="text-[10px] font-mono text-amber-400 font-bold">
              {controlMode === 'dpad' ? 'Táctico' : `${levers.right}%`}
            </span>
          </div>

          {controlMode === 'dpad' ? (
            <div className="flex-1 flex flex-col justify-between py-1 gap-2">
              
              {/* Botón Embestida Turbo a 255 */}
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); setSpeed(255); handleDpadPress('F'); }}
                onPointerUp={handleDpadRelease}
                onPointerCancel={handleDpadRelease}
                onPointerLeave={handleDpadRelease}
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

              {/* Botón Tornado Izquierda */}
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); setSpeed(240); handleDpadPress('L'); }}
                onPointerUp={handleDpadRelease}
                onPointerCancel={handleDpadRelease}
                onPointerLeave={handleDpadRelease}
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

              {/* Botón Tornado Derecha */}
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); setSpeed(240); handleDpadPress('D'); }}
                onPointerUp={handleDpadRelease}
                onPointerCancel={handleDpadRelease}
                onPointerLeave={handleDpadRelease}
                className="py-2.5 px-3 bg-gradient-to-r from-slate-800 to-slate-850 hover:bg-slate-750 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-between shadow-md active:scale-95 transition-all"
              >
                <div className="flex items-center gap-2">
                  <RotateCw className="w-4 h-4 text-amber-400" />
                  <span>Tornado Der. ↻</span>
                </div>
                <span className="text-[10px] font-mono bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">
                  D 240
                </span>
              </button>

              {/* Monitor de Sensores de Borde */}
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-[11px] font-mono">
                <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold mb-1.5">
                  <span>Sensores de Borde</span>
                  <span className="text-emerald-400">Activos</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="bg-slate-900 px-2 py-1 rounded border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400 text-[10px]">Delantero (35):</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  </div>
                  <div className="bg-slate-900 px-2 py-1 rounded border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400 text-[10px]">Trasero (34):</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <VirtualLever
              label="DERECHA"
              value={levers.right}
              onChange={(val) => setLevers((prev) => ({ ...prev, right: val }))}
              accent="amber"
            />
          )}
        </section>

      </main>
    </div>
  );
}

// Componente de Palanca Táctil con Auto-Retorno al Soltar (Spring Return)
function VirtualLever({ label, value, onChange, accent = 'cyan', isOverridden = false }) {
  const trackRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const calculateValue = (clientY) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const clampedY = Math.max(0, Math.min(rect.height, relativeY));
    const normalized = 1 - (clampedY / rect.height); // 0 (abajo) a 1 (arriba)
    let percent = Math.round((normalized * 2 - 1) * 100); // -100 a +100
    if (Math.abs(percent) < 5) percent = 0;
    return Math.max(-100, Math.min(100, percent));
  };

  const handlePointerDown = (e) => {
    if (isOverridden) return;
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    setIsDragging(true);
    onChange(calculateValue(e.clientY));
  };

  const handlePointerMove = (e) => {
    if (!isDragging || isOverridden) return;
    onChange(calculateValue(e.clientY));
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    onChange(0); // RESORTE VIRTUAL: Retorno automático a 0 al soltar
  };

  const thumbPercent = 50 - (value / 2);

  const colorStyles = {
    cyan: 'bg-cyan-500 border-cyan-300 shadow-cyan-500/40',
    amber: 'bg-amber-500 border-amber-300 shadow-amber-500/40',
    emerald: 'bg-emerald-500 border-emerald-300 shadow-emerald-500/40'
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`relative w-20 min-h-[170px] max-h-[340px] h-full rounded-2xl bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border-2 touch-none cursor-pointer p-1 transition-all ${
        isOverridden ? 'border-amber-600/50 opacity-60' : isDragging ? 'border-cyan-400 shadow-lg shadow-cyan-500/20' : 'border-slate-700 hover:border-slate-500'
      }`}
      style={{ touchAction: 'none' }}
    >
      {/* Línea Central de Neutro (0%) */}
      <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-0.5 bg-slate-600/80 pointer-events-none flex items-center justify-between px-1">
        <span className="text-[8px] font-mono text-slate-500 font-bold -translate-y-2.5">0%</span>
        <span className="text-[8px] font-mono text-slate-500 font-bold -translate-y-2.5">STOP</span>
      </div>

      {/* Marcas de muesca */}
      {NOTCH_POINTS.map((pt) => {
        if (pt === 0) return null;
        return (
          <div
            key={pt}
            className="absolute left-3 right-3 h-[1px] bg-slate-800 pointer-events-none"
            style={{ top: `${50 - pt / 2}%` }}
          />
        );
      })}

      {/* Relleno dinámico de barra */}
      {!isOverridden && value !== 0 && (
        <div
          className={`absolute left-4 right-4 rounded pointer-events-none ${
            value > 0 ? 'bg-cyan-500/30' : 'bg-rose-500/30'
          }`}
          style={{
            top: value > 0 ? `${thumbPercent}%` : '50%',
            bottom: value < 0 ? `${100 - thumbPercent}%` : '50%',
          }}
        />
      )}

      {/* Cabezal de la Palanca */}
      <div
        className={`absolute left-1.5 right-1.5 h-12 -mt-6 rounded-xl border-2 shadow-md flex flex-col items-center justify-center transition-transform z-10 ${
          isOverridden
            ? 'bg-amber-700 border-amber-300 text-amber-100'
            : isDragging
              ? `${colorStyles[accent]} scale-105 text-white font-bold`
              : 'bg-slate-700 border-slate-500 text-slate-200'
        }`}
        style={{
          top: `${thumbPercent}%`,
          transition: isDragging ? 'none' : 'top 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="flex flex-col gap-1 w-6 pointer-events-none">
          <div className="h-[2px] bg-white/40 rounded-full" />
          <div className="h-[2px] bg-white/40 rounded-full" />
        </div>
        <span className="text-[8px] font-mono font-bold mt-1 uppercase">
          {isOverridden ? 'LOCK' : value > 0 ? 'FWD' : value < 0 ? 'REV' : 'NEU'}
        </span>
      </div>
    </div>
  );
}

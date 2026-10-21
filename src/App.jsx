import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Bluetooth, 
  BluetoothConnected, 
  BluetoothOff, 
  Octagon, 
  Swords, 
  Zap, 
  Sliders, 
  RotateCcw,
  ShieldCheck,
  Cpu,
  Rotate3d,
  Check
} from 'lucide-react';

// UUIDs del servidor BLE del ESP32 (TB6612FNG SumoBot)
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHARACTERISTIC_UUID = "c565818d-6972-466d-88b0-517865f14d02";

// Puntos de muesca visual para las palancas
const NOTCH_POINTS = [100, 50, 0, -50, -100];

export default function App() {
  // Modo de control: 'levers' (3 Palancas) o 'dpad' (Botones direccionales)
  const [controlMode, setControlMode] = useState('levers');

  // Estado de conexión Web Bluetooth
  const [device, setDevice] = useState(null);
  const [characteristic, setCharacteristic] = useState(null);
  const [status, setStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  
  // Valores de las 3 Palancas Virtuales (-100 a +100)
  const [levers, setLevers] = useState({ center: 0, left: 0, right: 0 });
  
  // Parámetros de velocidad PWM (100 a 255)
  const [speed, setSpeed] = useState(220);
  const [activeDpadDir, setActiveDpadDir] = useState('S');

  // Arranque de Combate ('G') y cuenta regresiva reglamentaria de 3s
  const [combatState, setCombatState] = useState('idle'); // 'idle' | 'countdown' | 'active'
  const [countdown, setCountdown] = useState(3);
  
  // Telemetría de transmisión
  const [lastPayload, setLastPayload] = useState('S 0');
  const [packetsSent, setPacketsSent] = useState(0);

  // Control de flujo (Throttling a 60ms y Candado Mutex)
  const isWritingRef = useRef(false);
  const characteristicRef = useRef(null);
  const lastSentPayloadRef = useRef('S 0');
  const leversRef = useRef({ center: 0, left: 0, right: 0 });
  const controlModeRef = useRef('levers');
  const dpadDirRef = useRef('S');
  const speedRef = useRef(220);

  // Sincronizar referencias para evitar cierres obsoletos en el timer
  characteristicRef.current = characteristic;
  leversRef.current = levers;
  controlModeRef.current = controlMode;
  dpadDirRef.current = activeDpadDir;
  speedRef.current = speed;

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

      const payload = `${dir} ${spd}\n`;
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

      setCharacteristic(char);
      setStatus('connected');
    } catch (err) {
      if (err.name === 'NotFoundError') {
        setStatus('disconnected');
      } else {
        setStatus('error');
        setErrorMessage(err.message || 'Error al conectar al robot');
      }
    }
  };

  const disconnectBLE = () => {
    if (device && device.gatt.connected) {
      device.gatt.disconnect();
    }
    setDevice(null);
    setCharacteristic(null);
    setStatus('disconnected');
  };

  // Parada de emergencia inmediata ('S 0')
  const handleEmergencyStop = () => {
    setLevers({ center: 0, left: 0, right: 0 });
    setActiveDpadDir('S');
    setCombatState('idle');
    setCountdown(3);
    sendPacket('S 0\n');
  };

  // Arranque de Combate ('G'): activa cuenta regresiva de 3s reglamentarios
  const handleCombatStart = async () => {
    await sendPacket('G\n');
    setCombatState('countdown');
    setCountdown(3);
  };

  useEffect(() => {
    if (combatState !== 'countdown') return;
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCombatState('active');
    }
  }, [combatState, countdown]);

  return (
    <div className="w-screen h-screen min-h-[420px] bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none font-sans">
      
      {/* BARRA SUPERIOR */}
      <header className="h-12 px-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur flex items-center justify-between gap-3 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-cyan-400 rotate-45 rounded-sm shadow-sm shadow-cyan-400" />
            <span className="font-bold text-sm tracking-wide uppercase">SumoBot BLE</span>
          </div>

          {/* Selector de Modo */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
            <button
              onClick={() => setControlMode('levers')}
              className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                controlMode === 'levers' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              3 Palancas
            </button>
            <button
              onClick={() => setControlMode('dpad')}
              className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                controlMode === 'dpad' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              D-Pad Táctil
            </button>
          </div>
        </div>

        {/* Telemetría Throttling */}
        <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-slate-400 bg-slate-950/70 px-2.5 py-1 rounded-lg border border-slate-800">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          <span>Throttling: <strong>60ms</strong></span>
          <span className="text-slate-600">|</span>
          <span>Trama: <strong className="text-cyan-400">{lastPayload}</strong></span>
        </div>

        {/* Botón de Conexión BLE */}
        <div>
          {status === 'connected' ? (
            <button
              onClick={disconnectBLE}
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs font-bold hover:bg-emerald-500/30 transition-all"
            >
              <BluetoothConnected className="w-4 h-4 animate-pulse" />
              <span>{device?.name || 'ESP32 Conectado'}</span>
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
        <div className="bg-rose-950/80 border-b border-rose-800 px-4 py-1.5 text-xs text-rose-300 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="underline text-rose-400">Cerrar</button>
        </div>
      )}

      {/* CUERPO PRINCIPAL LANDSCAPE (3 COLUMNAS) */}
      <main className="flex-1 flex min-h-0 overflow-hidden relative">

        {/* COLUMNA 1: PALANCA TRACCIÓN IZQUIERDA */}
        <section className="w-[30%] min-w-[200px] h-full p-2 flex flex-col justify-center items-center border-r border-slate-800 bg-slate-900/30">
          <div className="w-full flex items-center justify-between px-2 mb-1">
            <span className="text-[11px] font-mono font-bold uppercase text-slate-300">Tracción Izquierda</span>
            <span className="text-[11px] font-mono text-cyan-400 font-bold">{levers.left}%</span>
          </div>
          <div className="flex-1 w-full flex items-center justify-center py-1">
            <VirtualLever
              label="IZQUIERDA"
              value={levers.left}
              onChange={(val) => setLevers((prev) => ({ ...prev, left: val }))}
              accent="cyan"
            />
          </div>
        </section>

        {/* COLUMNA 2: NÚCLEO CENTRAL (COMBATE 'G', EMPUJE CENTRAL, FRENO TOTAL) */}
        <section className="flex-1 h-full p-2 sm:p-3 flex flex-col justify-between items-center bg-slate-950/60 relative">
          
          {/* Fila Superior: Botón de Combate ('G') y Freno Total ('S 0') */}
          <div className="w-full max-w-md flex items-center gap-2">
            <div className="flex-1">
              {combatState === 'countdown' ? (
                <div className="w-full py-2 px-3 bg-gradient-to-r from-amber-600/30 to-amber-500/20 border-2 border-amber-400 rounded-xl flex items-center justify-center gap-3 animate-pulse">
                  <div className="w-7 h-7 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center font-black text-lg font-mono">
                    {countdown}
                  </div>
                  <span className="text-xs font-bold uppercase text-amber-300 tracking-wider">
                    ¡3s Quietud Dohyo!
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCombatStart}
                  className="w-full py-2.5 px-3 bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:to-amber-500 active:scale-95 text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-rose-600/30 border border-rose-400/30"
                >
                  <Swords className="w-4 h-4 text-amber-300" />
                  <span>{combatState === 'active' ? 'REINICIAR COMBATE (G)' : 'INICIAR COMBATE (G)'}</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleEmergencyStop}
              className="py-2.5 px-3 bg-rose-950/80 hover:bg-rose-900 border-2 border-rose-600 active:scale-95 text-rose-200 rounded-xl font-bold text-xs uppercase flex items-center gap-1.5 shadow-md shadow-rose-950/50"
            >
              <Octagon className="w-4 h-4 text-rose-400" />
              <span>FRENO TOTAL</span>
            </button>
          </div>

          {/* Zona Central: Palanca Central Rectilínea */}
          <div className="flex-1 w-full max-w-md flex flex-col items-center justify-center my-1">
            <div className="flex items-center justify-between w-48 mb-1 px-1">
              <span className="text-[11px] font-mono font-bold uppercase text-slate-300">Empuje Central</span>
              <span className={`text-[11px] font-mono font-bold ${isOverrideActive ? 'text-amber-400' : 'text-emerald-400'}`}>
                {isOverrideActive ? 'OVERRIDE' : `${levers.center}%`}
              </span>
            </div>
            <div className="h-full flex items-center justify-center">
              <VirtualLever
                label="EMPUJE CENTRAL"
                value={levers.center}
                onChange={(val) => setLevers((prev) => ({ ...prev, center: val }))}
                accent="emerald"
                isOverridden={isOverrideActive}
              />
            </div>
          </div>

          {/* Fila Inferior: Presets de Velocidad PWM */}
          <div className="w-full max-w-md flex items-center justify-between gap-1 text-[10px] font-mono bg-slate-900/80 p-1.5 rounded-xl border border-slate-800">
            <span className="text-slate-400 uppercase">PWM:</span>
            {[100, 180, 220, 255].map((val) => (
              <button
                key={val}
                onClick={() => setSpeed(val)}
                className={`px-2 py-0.5 rounded font-mono transition-colors ${
                  speed === val ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                {val}
              </button>
            ))}
            <span className="text-cyan-400 font-bold ml-1">{speed}/255</span>
          </div>
        </section>

        {/* COLUMNA 3: PALANCA TRACCIÓN DERECHA */}
        <section className="w-[30%] min-w-[200px] h-full p-2 flex flex-col justify-center items-center border-l border-slate-800 bg-slate-900/30">
          <div className="w-full flex items-center justify-between px-2 mb-1">
            <span className="text-[11px] font-mono font-bold uppercase text-slate-300">Tracción Derecha</span>
            <span className="text-[11px] font-mono text-amber-400 font-bold">{levers.right}%</span>
          </div>
          <div className="flex-1 w-full flex items-center justify-center py-1">
            <VirtualLever
              label="DERECHA"
              value={levers.right}
              onChange={(val) => setLevers((prev) => ({ ...prev, right: val }))}
              accent="amber"
            />
          </div>
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

  // Posición del cabezal (0% = centro)
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

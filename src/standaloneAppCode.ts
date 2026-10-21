/**
 * Código fuente limpio y preparado para despliegue en Vercel
 * React ^18.3.1 + Vite + Tailwind CSS + Lucide React
 */

export const PACKAGE_JSON_CODE = `{
  "name": "sumobot-ble-controller",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^0.344.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "vite": "^5.3.4"
  }
}`;

export const APP_JSX_CODE = `import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Bluetooth, 
  BluetoothConnected, 
  BluetoothOff, 
  ChevronUp, 
  ChevronDown, 
  RotateCcw, 
  RotateCw, 
  Octagon, 
  Swords, 
  Zap, 
  Sliders, 
  AlertTriangle,
  Rotate3d,
  Maximize2
} from 'lucide-react';

// UUIDs del servidor BLE del ESP32
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHARACTERISTIC_UUID = "c565818d-6972-466d-88b0-517865f14d02";

export default function App() {
  // Estado de Conexión BLE
  const [device, setDevice] = useState(null);
  const [characteristic, setCharacteristic] = useState(null);
  const [status, setStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  
  // Parámetros de Control
  const [speed, setSpeed] = useState(220); // Rango: 100 a 255
  const [activeDir, setActiveDir] = useState('S'); // 'F' | 'R' | 'L' | 'D' | 'S'
  const [combatState, setCombatState] = useState('idle'); // 'idle' | 'countdown' | 'fighting'
  const [countdown, setCountdown] = useState(3);
  
  // Telemetría en tiempo real
  const [lastPayload, setLastPayload] = useState('S 0');
  const [packetsSent, setPacketsSent] = useState(0);

  // Referencias para Control de Flujo (Throttling y Candado Mutex)
  const isWritingRef = useRef(false);
  const currentDirRef = useRef('S');
  const currentSpeedRef = useRef(220);
  const lastSentPayloadRef = useRef('S 0');
  const characteristicRef = useRef(null);

  // Mantener referencias actualizadas
  currentDirRef.current = activeDir;
  currentSpeedRef.current = speed;
  characteristicRef.current = characteristic;

  // 1. TRANSMISIÓN DE BAJO NIVEL (Con protección Mutex y Try-Catch)
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
      setPacketsSent((prev) => prev + 1);
    } catch (err) {
      console.warn('[BLE TX Error]', err);
    } finally {
      isWritingRef.current = false;
    }
  };

  // 2. BUCLE DE CONTROL DE FLUJO (THROTTLING ESTRICTO A 60ms)
  // Evita saturar la memoria y el búfer GATT del ESP32
  useEffect(() => {
    if (status !== 'connected') return;

    const interval = setInterval(() => {
      const dir = currentDirRef.current;
      const spd = dir === 'S' ? 0 : currentSpeedRef.current;
      const payload = \`\${dir} \${spd}\\n\`;

      // Enviar solo si cambió el comando o si continúa en movimiento (keep-alive)
      if (payload.trim() !== lastSentPayloadRef.current || dir !== 'S') {
        sendPacket(payload);
      }
    }, 60); // 60ms = ~16 paquetes por segundo (óptimo para ESP32)

    return () => clearInterval(interval);
  }, [status]);

  // 3. CONEXIÓN WEB BLUETOOTH
  const connectBLE = async () => {
    if (!navigator.bluetooth) {
      setStatus('error');
      setErrorMessage('Web Bluetooth no está soportado en este navegador. Usa Chrome o Edge en Android/PC, o Bluefy en iOS.');
      return;
    }

    try {
      setStatus('connecting');
      setErrorMessage('');

      // Solicitar dispositivo por UUID de servicio o prefijo
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

      setDevice(selectedDevice);

      // Evento de desconexión
      selectedDevice.addEventListener('gattserverdisconnected', () => {
        setStatus('disconnected');
        setCharacteristic(null);
        setActiveDir('S');
        setCombatState('idle');
      });

      const server = await selectedDevice.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const char = await service.getCharacteristic(CHARACTERISTIC_UUID);

      setCharacteristic(char);
      setStatus('connected');
    } catch (err) {
      console.error('[BLE Connect Error]', err);
      if (err.name === 'NotFoundError') {
        setStatus('disconnected');
        setErrorMessage('Búsqueda cancelada por el usuario.');
      } else {
        setStatus('error');
        setErrorMessage(err.message || 'Error al conectar con el ESP32.');
      }
    }
  };

  const disconnectBLE = () => {
    if (device && device.gatt && device.gatt.connected) {
      device.gatt.disconnect();
    }
    setStatus('disconnected');
    setCharacteristic(null);
    setActiveDir('S');
  };

  // 4. INICIO DE COMBATE ('G') Y CUENTA REGRESIVA REGLAMENTARIA DE 3s
  const handleCombatStart = async () => {
    if (status === 'connected') {
      await sendPacket('G\\n');
    }
    setCombatState('countdown');
    setCountdown(3);

    if (navigator.vibrate) {
      try { navigator.vibrate([100, 50, 100]); } catch {}
    }
  };

  // Manejo del contador de 3 segundos
  useEffect(() => {
    if (combatState !== 'countdown') return;

    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((c) => c - 1);
        if (navigator.vibrate) try { navigator.vibrate(80); } catch {}
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setCombatState('fighting');
      if (navigator.vibrate) try { navigator.vibrate([200, 100, 300]); } catch {}
    }
  }, [combatState, countdown]);

  // 5. MANEJADORES DE MOVIMIENTO DIRECCIONAL
  const startMove = (dir) => {
    setActiveDir(dir);
    if (navigator.vibrate) {
      try { navigator.vibrate(20); } catch {}
    }
  };

  const stopMove = () => {
    setActiveDir('S');
    sendPacket('S 0\\n');
  };

  // Atajos de teclado (W, A, S, D, Espacio, G)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat) return;
      switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          startMove('F');
          break;
        case 's':
        case 'arrowdown':
          startMove('R');
          break;
        case 'a':
        case 'arrowleft':
          startMove('L');
          break;
        case 'd':
        case 'arrowright':
          startMove('D');
          break;
        case ' ':
          stopMove();
          break;
        case 'g':
          handleCombatStart();
          break;
      }
    };

    const onKeyUp = (e) => {
      switch (e.key.toLowerCase()) {
        case 'w':
        case 's':
        case 'a':
        case 'd':
        case 'arrowup':
        case 'arrowdown':
        case 'arrowleft':
        case 'arrowright':
          stopMove();
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div className="w-screen h-screen min-h-[460px] bg-slate-950 text-slate-100 flex flex-col select-none overflow-hidden font-sans">
      
      {/* BARRA SUPERIOR (HEADER) */}
      <header className="h-14 px-4 sm:px-6 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-cyan-400 rotate-45 rounded-xs" />
          <h1 className="font-bold text-sm tracking-wide uppercase text-slate-100">
            SumoBot ESP32
          </h1>
          <span className="hidden sm:inline-block px-2 py-0.5 text-[11px] font-mono bg-slate-800 text-slate-400 rounded">
            TB6612FNG · BLE 60ms
          </span>
        </div>

        {/* Telemetría y Estado */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-950 px-3 py-1 rounded border border-slate-800">
            <span>TX: {packetsSent}</span>
            <span className="text-slate-600">|</span>
            <span>Trama: <strong className="text-cyan-400">{lastPayload}</strong></span>
          </div>

          {/* Botón de Conexión BLE */}
          {status === 'connected' ? (
            <button
              onClick={disconnectBLE}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-xl text-xs font-bold hover:bg-emerald-500/30 transition-all"
            >
              <BluetoothConnected className="w-4 h-4 text-emerald-400" />
              <span>Conectado</span>
            </button>
          ) : (
            <button
              onClick={connectBLE}
              disabled={status === 'connecting'}
              className="flex items-center gap-2 px-4 py-1.5 bg-cyan-500 text-slate-950 rounded-xl text-xs font-bold hover:bg-cyan-400 active:scale-95 transition-all shadow-lg shadow-cyan-500/20"
            >
              <Bluetooth className="w-4 h-4" />
              <span>{status === 'connecting' ? 'Buscando...' : 'Conectar Robot'}</span>
            </button>
          )}
        </div>
      </header>

      {/* MENSAJE DE ERROR SI OCURRE */}
      {errorMessage && (
        <div className="bg-rose-500/10 border-b border-rose-500/30 px-4 py-1.5 flex items-center justify-between text-xs text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage('')} className="underline text-[11px]">Cerrar</button>
        </div>
      )}

      {/* COCKPIT EN MODO HORIZONTAL (LANDSCAPE) - 3 COLUMNAS */}
      <main className="flex-1 grid grid-cols-12 gap-3 p-3 sm:p-4 overflow-hidden">
        
        {/* COLUMNA IZQUIERDA: D-PAD TÁCTIL (ADELANTE 'F', ATRÁS 'R', GIROS 'L'/'D', FRENO 'S') */}
        <section className="col-span-5 flex flex-col items-center justify-center bg-slate-900/60 border border-slate-800 rounded-2xl p-2 relative">
          <span className="absolute top-2 left-3 text-[10px] font-mono font-bold tracking-wider uppercase text-slate-400">
            Control Direccional
          </span>

          <div className="w-52 h-52 grid grid-cols-3 grid-rows-3 gap-2 mt-4">
            
            {/* Vacío */}
            <div />

            {/* ADELANTE ('F') */}
            <button
              onPointerDown={(e) => { e.preventDefault(); startMove('F'); }}
              onPointerUp={stopMove}
              onPointerCancel={stopMove}
              onPointerLeave={stopMove}
              className={\`flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 \${
                activeDir === 'F' 
                  ? 'bg-emerald-500 text-slate-950 ring-4 ring-emerald-400 font-bold shadow-lg shadow-emerald-500/40' 
                  : 'bg-slate-800 text-emerald-400 hover:bg-slate-750 border border-emerald-500/30'
              }\`}
            >
              <ChevronUp className="w-9 h-9" />
              <span className="text-[10px] font-mono font-bold">F</span>
            </button>

            {/* Vacío */}
            <div />

            {/* GIRO IZQUIERDA ('L') */}
            <button
              onPointerDown={(e) => { e.preventDefault(); startMove('L'); }}
              onPointerUp={stopMove}
              onPointerCancel={stopMove}
              onPointerLeave={stopMove}
              className={\`flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 \${
                activeDir === 'L' 
                  ? 'bg-amber-500 text-slate-950 ring-4 ring-amber-400 font-bold shadow-lg shadow-amber-500/40' 
                  : 'bg-slate-800 text-amber-400 hover:bg-slate-750 border border-amber-500/30'
              }\`}
            >
              <RotateCcw className="w-7 h-7" />
              <span className="text-[10px] font-mono font-bold">L</span>
            </button>

            {/* FRENO CENTRAL ('S') */}
            <button
              onClick={stopMove}
              className={\`flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-90 \${
                activeDir === 'S' 
                  ? 'bg-rose-600 text-white font-bold ring-2 ring-rose-400' 
                  : 'bg-slate-850 text-rose-400 hover:bg-slate-800 border border-rose-500/40'
              }\`}
            >
              <Octagon className="w-6 h-6" />
              <span className="text-[9px] font-mono font-bold">FRENO</span>
            </button>

            {/* GIRO DERECHA ('D') */}
            <button
              onPointerDown={(e) => { e.preventDefault(); startMove('D'); }}
              onPointerUp={stopMove}
              onPointerCancel={stopMove}
              onPointerLeave={stopMove}
              className={\`flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 \${
                activeDir === 'D' 
                  ? 'bg-amber-500 text-slate-950 ring-4 ring-amber-400 font-bold shadow-lg shadow-amber-500/40' 
                  : 'bg-slate-800 text-amber-400 hover:bg-slate-750 border border-amber-500/30'
              }\`}
            >
              <RotateCw className="w-7 h-7" />
              <span className="text-[10px] font-mono font-bold">D</span>
            </button>

            {/* Vacío */}
            <div />

            {/* ATRÁS ('R') */}
            <button
              onPointerDown={(e) => { e.preventDefault(); startMove('R'); }}
              onPointerUp={stopMove}
              onPointerCancel={stopMove}
              onPointerLeave={stopMove}
              className={\`flex flex-col items-center justify-center rounded-2xl transition-all duration-75 active:scale-95 \${
                activeDir === 'R' 
                  ? 'bg-cyan-500 text-slate-950 ring-4 ring-cyan-400 font-bold shadow-lg shadow-cyan-500/40' 
                  : 'bg-slate-800 text-cyan-400 hover:bg-slate-750 border border-cyan-500/30'
              }\`}
            >
              <ChevronDown className="w-9 h-9" />
              <span className="text-[10px] font-mono font-bold">R</span>
            </button>

            {/* Vacío */}
            <div />
          </div>
        </section>

        {/* COLUMNA CENTRAL: BOTÓN DE COMBATE ('G') Y SLIDER DE VELOCIDAD */}
        <section className="col-span-4 flex flex-col items-center justify-between bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4">
          
          {/* BOTÓN DESTACADO DE INICIO DE COMBATE ('G') */}
          <div className="w-full flex flex-col items-center">
            <span className="text-[10px] font-mono font-bold uppercase text-slate-400 mb-2">
              Reglamento Dohyo (3s de Quietud)
            </span>

            {combatState === 'countdown' ? (
              <div className="w-full py-4 bg-amber-500/20 border-2 border-amber-500 rounded-2xl flex flex-col items-center justify-center animate-pulse">
                <span className="text-4xl font-black font-mono text-amber-400 leading-none">
                  {countdown}
                </span>
                <span className="text-xs uppercase font-bold text-amber-300 mt-1">
                  ¡Quietud Reglamentaria!
                </span>
              </div>
            ) : (
              <button
                onClick={handleCombatStart}
                className="w-full py-3.5 sm:py-4 bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white rounded-2xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2.5 shadow-xl shadow-rose-600/30 hover:brightness-110 active:scale-95 transition-all"
              >
                <Swords className="w-5 h-5 text-amber-300" />
                <span>Iniciar Combate ('G')</span>
              </button>
            )}

            {combatState === 'fighting' && (
              <span className="text-[11px] font-bold text-emerald-400 mt-1 uppercase tracking-wide">
                ¡EN COMBATE ACTIVO!
              </span>
            )}
          </div>

          {/* SLIDER DE VELOCIDAD (100 A 255) */}
          <div className="w-full bg-slate-950/70 border border-slate-800 rounded-xl p-3">
            <div className="flex items-center justify-between text-xs font-mono mb-2">
              <span className="text-slate-400 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Potencia PWM:
              </span>
              <strong className="text-cyan-400 text-sm">{speed} / 255</strong>
            </div>

            <input
              type="range"
              min="100"
              max="255"
              step="5"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full h-2.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />

            {/* Presets Rápidos */}
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {[100, 180, 220, 255].map((val) => (
                <button
                  key={val}
                  onClick={() => setSpeed(val)}
                  className={\`py-1 text-[10px] font-mono rounded \${
                    speed === val 
                      ? 'bg-cyan-500 text-slate-950 font-bold' 
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }\`}
                >
                  {val === 255 ? 'MAX' : val}
                </button>
              ))}
            </div>
          </div>

          {/* BOTÓN DE PARADA TOTAL DE EMERGENCIA */}
          <button
            onClick={stopMove}
            className="w-full py-2.5 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/80 text-rose-300 rounded-xl font-bold text-xs uppercase flex items-center justify-center gap-2 active:scale-95 transition-all"
          >
            <Octagon className="w-4 h-4 text-rose-400" />
            <span>Freno Total ('S 0')</span>
          </button>
        </section>

        {/* COLUMNA DERECHA: ATAQUES RÁPIDOS Y ESTADO DEL ROBOT */}
        <section className="col-span-3 flex flex-col justify-between bg-slate-900/60 border border-slate-800 rounded-2xl p-3">
          <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-slate-400">
            Maniobras Rápidas
          </span>

          <div className="flex flex-col gap-2 my-auto">
            {/* Turbo Adelante */}
            <button
              onPointerDown={(e) => { e.preventDefault(); setSpeed(255); startMove('F'); }}
              onPointerUp={stopMove}
              onPointerCancel={stopMove}
              className="py-2.5 px-3 bg-slate-800 hover:bg-slate-750 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-bold flex items-center justify-between active:scale-95"
            >
              <span>Embestida Turbo</span>
              <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-400 px-1.5 rounded">255</span>
            </button>

            {/* Giro Tornado Izquierda */}
            <button
              onPointerDown={(e) => { e.preventDefault(); setSpeed(240); startMove('L'); }}
              onPointerUp={stopMove}
              onPointerCancel={stopMove}
              className="py-2.5 px-3 bg-slate-800 hover:bg-slate-750 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-between active:scale-95"
            >
              <span>Giro Rápido ↺</span>
              <span className="text-[10px] font-mono bg-amber-500/20 text-amber-400 px-1.5 rounded">L</span>
            </button>

            {/* Giro Tornado Derecha */}
            <button
              onPointerDown={(e) => { e.preventDefault(); setSpeed(240); startMove('D'); }}
              onPointerUp={stopMove}
              onPointerCancel={stopMove}
              className="py-2.5 px-3 bg-slate-800 hover:bg-slate-750 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-between active:scale-95"
            >
              <span>Giro Rápido ↻</span>
              <span className="text-[10px] font-mono bg-amber-500/20 text-amber-400 px-1.5 rounded">D</span>
            </button>
          </div>

          <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-[10px] font-mono text-slate-400">
            <div className="flex justify-between">
              <span>ESP32 BLE:</span>
              <span className={status === 'connected' ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {status.toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span>Driver:</span>
              <span className="text-slate-200">TB6612FNG</span>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}`;

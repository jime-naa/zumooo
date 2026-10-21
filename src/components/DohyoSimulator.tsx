import React, { useRef, useEffect, useState } from 'react';
import { RobotCombatState, MotorSpeeds } from '../types';

interface DohyoSimulatorProps {
  motorSpeeds: MotorSpeeds;
  overrideActive: boolean;
  onTriggerFrontIR?: () => void;
  onTriggerRearIR?: () => void;
  size?: number;
}

export const DohyoSimulator: React.FC<DohyoSimulatorProps> = ({
  motorSpeeds,
  overrideActive,
  size = 200,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Posición del robot en el dohyo virtual (coordenadas relativas al centro)
  const robotRef = useRef({
    x: 0,
    y: 0,
    heading: -Math.PI / 2, // Apuntando hacia arriba
    vx: 0,
    vy: 0,
    omega: 0,
  });

  const [simState, setSimState] = useState<RobotCombatState>('MANUAL_BLE');
  const [escapeTimer, setEscapeTimer] = useState<number>(0);
  const [frontSensorActive, setFrontSensorActive] = useState(false);
  const [rearSensorActive, setRearSensorActive] = useState(false);

  // Radio del Dohyo virtual adaptativo
  const DOHYO_RADIUS = Math.round((size / 2) - 8);
  const WHITE_BORDER_WIDTH = Math.max(8, Math.round(DOHYO_RADIUS * 0.11));

  // Lógica de simulación de combate y sensores
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      const dt = Math.min((currentTime - lastTime) / 1000, 0.05); // cap delta
      lastTime = currentTime;

      const robot = robotRef.current;
      const distFromCenter = Math.sqrt(robot.x * robot.x + robot.y * robot.y);

      // Calcular posiciones de sensores frontal y trasero
      const frontDist = 20; // radio frontal del robot
      const frontSensorX = robot.x + Math.cos(robot.heading) * frontDist;
      const frontSensorY = robot.y + Math.sin(robot.heading) * frontDist;
      const frontSensorDist = Math.sqrt(frontSensorX * frontSensorX + frontSensorY * frontSensorY);

      const rearSensorX = robot.x - Math.cos(robot.heading) * frontDist;
      const rearSensorY = robot.y - Math.sin(robot.heading) * frontDist;
      const rearSensorDist = Math.sqrt(rearSensorX * rearSensorX + rearSensorY * rearSensorY);

      const isFrontOnWhite = frontSensorDist >= (DOHYO_RADIUS - WHITE_BORDER_WIDTH);
      const isRearOnWhite = rearSensorDist >= (DOHYO_RADIUS - WHITE_BORDER_WIDTH);

      setFrontSensorActive(isFrontOnWhite);
      setRearSensorActive(isRearOnWhite);

      // Máquina de estados virtual
      let activeLeft = motorSpeeds.left;
      let activeRight = motorSpeeds.right;

      if (simState === 'FRONT_LINE_ESCAPE') {
        activeLeft = -100;
        activeRight = -100;
        setEscapeTimer((prev) => {
          if (prev <= 0) {
            setSimState('MANUAL_BLE');
            return 0;
          }
          return prev - dt * 1000;
        });
      } else if (simState === 'REAR_LINE_ESCAPE') {
        activeLeft = 100;
        activeRight = 100;
        setEscapeTimer((prev) => {
          if (prev <= 0) {
            setSimState('MANUAL_BLE');
            return 0;
          }
          return prev - dt * 1000;
        });
      } else {
        // Modo manual: comprobar si toca línea blanca
        if (isFrontOnWhite) {
          setSimState('FRONT_LINE_ESCAPE');
          setEscapeTimer(800);
          activeLeft = -100;
          activeRight = -100;
        } else if (isRearOnWhite) {
          setSimState('REAR_LINE_ESCAPE');
          setEscapeTimer(800);
          activeLeft = 100;
          activeRight = 100;
        }
      }

      // Cinemática diferencial del robot
      // V = (vL + vR) / 2, Omega = (vR - vL) / L
      const maxSpeed = 120; // pixeles por segundo a 100%
      const vL = (activeLeft / 100) * maxSpeed;
      const vR = (activeRight / 100) * maxSpeed;
      const vLinear = (vL + vR) / 2;
      const vAngular = (vR - vL) / 30; // Distancia entre ruedas ~30px

      robot.heading += vAngular * dt;
      robot.x += Math.cos(robot.heading) * vLinear * dt;
      robot.y += Math.sin(robot.heading) * vLinear * dt;

      // Colisión suave con límite de borde (para que no salga volando de la pantalla)
      if (distFromCenter > DOHYO_RADIUS + 15) {
        const angle = Math.atan2(robot.y, robot.x);
        robot.x = Math.cos(angle) * (DOHYO_RADIUS + 14);
        robot.y = Math.sin(angle) * (DOHYO_RADIUS + 14);
      }

      // Dibujar en canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const cx = canvas.width / 2;
          const cy = canvas.height / 2;

          ctx.save();
          ctx.translate(cx, cy);

          // 1. DOHYO: Círculo exterior (Borde Blanco)
          ctx.beginPath();
          ctx.arc(0, 0, DOHYO_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = '#f8fafc'; // Blanco oficial dohyo
          ctx.fill();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1;
          ctx.stroke();

          // 2. DOHYO: Superficie interior (Negro mate)
          ctx.beginPath();
          ctx.arc(0, 0, DOHYO_RADIUS - WHITE_BORDER_WIDTH, 0, Math.PI * 2);
          ctx.fillStyle = '#090d16';
          ctx.fill();

          // 3. Líneas de inicio Shikiri (2 líneas marrones en el centro)
          ctx.fillStyle = '#b45309';
          ctx.fillRect(-15, -12, 30, 3);
          ctx.fillRect(-15, 9, 30, 3);

          // 4. Dibujar el Robot de Sumo
          ctx.save();
          ctx.translate(robot.x, robot.y);
          ctx.rotate(robot.heading);

          // Chasis del robot (cuadrado 32x28 con pala metálica delantera)
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = simState.includes('ESCAPE') ? '#ef4444' : overrideActive ? '#f59e0b' : '#06b6d4';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(-14, -14, 28, 28, 4);
          ctx.fill();
          ctx.stroke();

          // Cuchilla / Pala frontal biselada
          ctx.fillStyle = '#cbd5e1';
          ctx.beginPath();
          ctx.moveTo(14, -14);
          ctx.lineTo(20, -10);
          ctx.lineTo(20, 10);
          ctx.lineTo(14, 14);
          ctx.closePath();
          ctx.fill();

          // Orugas / Ruedas izquierda y derecha
          ctx.fillStyle = '#020617';
          ctx.fillRect(-12, -17, 24, 4);
          ctx.fillRect(-12, 13, 24, 4);

          // Indicador de Sensor Frontal TCRT5000
          ctx.beginPath();
          ctx.arc(17, 0, 3, 0, Math.PI * 2);
          ctx.fillStyle = isFrontOnWhite ? '#ef4444' : '#10b981';
          ctx.fill();

          // Indicador de Sensor Trasero TCRT5000
          ctx.beginPath();
          ctx.arc(-12, 0, 3, 0, Math.PI * 2);
          ctx.fillStyle = isRearOnWhite ? '#ef4444' : '#10b981';
          ctx.fill();

          ctx.restore();
          ctx.restore();
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [motorSpeeds, simState, overrideActive]);

  const resetPosition = () => {
    robotRef.current = {
      x: 0,
      y: 0,
      heading: -Math.PI / 2,
      vx: 0,
      vy: 0,
      omega: 0,
    };
    setSimState('MANUAL_BLE');
    setEscapeTimer(0);
  };

  const triggerFrontEscapeManual = () => {
    setSimState('FRONT_LINE_ESCAPE');
    setEscapeTimer(800);
  };

  const triggerRearEscapeManual = () => {
    setSimState('REAR_LINE_ESCAPE');
    setEscapeTimer(800);
  };

  return (
    <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-slate-900/60 border border-slate-800">
      <div className="flex items-center justify-between w-full mb-1 px-1">
        <span className="text-[11px] font-display font-bold text-slate-300 uppercase tracking-wider">
          Simulador de Dohyo y FSM
        </span>
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          <span className={`px-1.5 py-0.2 rounded border ${
            simState === 'FRONT_LINE_ESCAPE'
              ? 'bg-rose-950/80 border-rose-600 text-rose-300 animate-pulse'
              : simState === 'REAR_LINE_ESCAPE'
                ? 'bg-amber-950/80 border-amber-600 text-amber-300 animate-pulse'
                : overrideActive
                  ? 'bg-amber-950/60 border-amber-700 text-amber-300'
                  : 'bg-emerald-950/40 border-emerald-800/80 text-emerald-400'
          }`}>
            {simState === 'FRONT_LINE_ESCAPE' ? 'IR FRONTAL ESCAPE (-100%)' :
             simState === 'REAR_LINE_ESCAPE' ? 'IR TRASERO ESCAPE (+100%)' :
             overrideActive ? 'GIRO DIFERENCIAL' : 'MANUAL BLE'}
          </span>
        </div>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          className="rounded-full shadow-inner bg-slate-950"
        />

        {/* Sensores HUD flotantes */}
        <div className="absolute top-1 left-1 flex flex-col gap-1 text-[9px] font-mono pointer-events-none">
          <span className={`px-1 rounded ${frontSensorActive ? 'bg-rose-500 text-white font-bold' : 'text-slate-400 bg-slate-900/80'}`}>
            IR FRONT: {frontSensorActive ? 'LÍNEA' : 'NEGRO'}
          </span>
          <span className={`px-1 rounded ${rearSensorActive ? 'bg-rose-500 text-white font-bold' : 'text-slate-400 bg-slate-900/80'}`}>
            IR REAR: {rearSensorActive ? 'LÍNEA' : 'NEGRO'}
          </span>
        </div>

        {escapeTimer > 0 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-rose-600/90 text-white text-[10px] font-mono font-bold tracking-tight shadow">
            ESCAPE: {Math.round(escapeTimer)}ms
          </div>
        )}
      </div>

      {/* Controles de prueba rápida para la FSM */}
      <div className="flex items-center gap-1.5 mt-2 text-[10px]">
        <button
          onClick={triggerFrontEscapeManual}
          className="px-2 py-1 rounded bg-slate-800 hover:bg-rose-900/50 text-slate-300 hover:text-rose-200 border border-slate-700 text-[10px] transition-colors"
          title="Prueba la reacción inmediata de reversa de 800ms"
        >
          Test IR Front
        </button>
        <button
          onClick={triggerRearEscapeManual}
          className="px-2 py-1 rounded bg-slate-800 hover:bg-amber-900/50 text-slate-300 hover:text-amber-200 border border-slate-700 text-[10px] transition-colors"
          title="Prueba la reacción de avance de 800ms"
        >
          Test IR Rear
        </button>
        <button
          onClick={resetPosition}
          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 text-[10px] transition-colors"
        >
          Centrar
        </button>
      </div>
    </div>
  );
};

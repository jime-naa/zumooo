export type BleConnectionStatus = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'error' 
  | 'unsupported';

export type RobotCombatState = 
  | 'IDLE_DISCONNECTED'
  | 'MANUAL_BLE'
  | 'OVERRIDE_ACTIVE'
  | 'FRONT_LINE_ESCAPE'
  | 'REAR_LINE_ESCAPE'
  | 'FAILSAFE_TIMEOUT';

export interface LeverValues {
  center: number; // -100 to 100
  left: number;   // -100 to 100
  right: number;  // -100 to 100
}

export interface MotorSpeeds {
  left: number;  // -100 to 100
  right: number; // -100 to 100
}

export type MovementDir = 'F' | 'R' | 'L' | 'D' | 'S';

export interface MovementCommand {
  dir: MovementDir;
  speed: number; // 0 to 255 (PWM TB6612FNG)
  label: string;
  rawPayload: string; // ej: "F 255", "R 200", "L 220", "D 220", "S 0"
}

export function computeSumoMovement(levers: LeverValues): MovementCommand {
  const isOverrideActive = Math.abs(levers.left) > 3 || Math.abs(levers.right) > 3;

  if (isOverrideActive) {
    // Giro diferencial mediante palancas laterales
    // netTurn > 0 -> Giro a la Derecha ('D')
    // netTurn < 0 -> Giro a la Izquierda ('L')
    const netTurn = levers.left - levers.right;
    const netThrust = (levers.left + levers.right) / 2;

    if (Math.abs(netTurn) >= Math.abs(netThrust)) {
      const absTurn = Math.min(100, Math.abs(netTurn));
      const speed = Math.round((absTurn / 100) * 255);
      if (netTurn > 0) {
        return {
          dir: 'D',
          speed,
          label: 'GIRO DERECHA',
          rawPayload: `D ${speed}`,
        };
      } else {
        return {
          dir: 'L',
          speed,
          label: 'GIRO IZQUIERDA',
          rawPayload: `L ${speed}`,
        };
      }
    } else {
      // Ambas palancas empujadas hacia el mismo sentido
      const speed = Math.round((Math.abs(netThrust) / 100) * 255);
      if (netThrust > 0) {
        return {
          dir: 'F',
          speed,
          label: 'AVANCE',
          rawPayload: `F ${speed}`,
        };
      } else {
        return {
          dir: 'R',
          speed,
          label: 'ATRÁS',
          rawPayload: `R ${speed}`,
        };
      }
    }
  }

  // Palanca Central (Avance y Retroceso rectilíneo)
  if (Math.abs(levers.center) > 3) {
    const speed = Math.round((Math.abs(levers.center) / 100) * 255);
    if (levers.center > 0) {
      return {
        dir: 'F',
        speed,
        label: 'AVANCE RECTILÍNEO',
        rawPayload: `F ${speed}`,
      };
    } else {
      return {
        dir: 'R',
        speed,
        label: 'RETROCESO',
        rawPayload: `R ${speed}`,
      };
    }
  }

  // En reposo (Detener motores)
  return {
    dir: 'S',
    speed: 0,
    label: 'DETENIDO',
    rawPayload: 'S 0',
  };
}

export interface BleTelemetry {
  packetsSent: number;
  packetsPerSec: number;
  lastPacketPayload: string;
  lastLatencyMs: number;
  bytesSent: number;
  lastPacketTimestamp: number;
  isWriting: boolean;
  deviceName: string | null;
  rssiEstimate?: number;
}

// Declaraciones de tipos para Web Bluetooth API
declare global {
  interface Navigator {
    bluetooth?: {
      requestDevice(options: {
        filters?: Array<{ namePrefix?: string; services?: string[] }>;
        optionalServices?: string[];
        acceptAllDevices?: boolean;
      }): Promise<BluetoothDevice>;
    };
  }

  interface BluetoothDevice extends EventTarget {
    id: string;
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
  }

  interface BluetoothRemoteGATTServer {
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
  }

  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  interface BluetoothRemoteGATTCharacteristic extends EventTarget {
    value?: DataView;
    writeValue(value: BufferSource): Promise<void>;
    writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  }
}


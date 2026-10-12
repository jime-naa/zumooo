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


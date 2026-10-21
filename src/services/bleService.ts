import { BleConnectionStatus, BleTelemetry, LeverValues, MovementDir, computeSumoMovement } from '../types';

export const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const CHARACTERISTIC_UUID = 'c565818d-6972-466d-88b0-517865f14d02';

export class BleService {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  
  // Control de flujo (Throttling / Mutex)
  private isWriting = false;
  private throttleIntervalMs: number = 60; // Configurable entre 50ms y 100ms
  private throttleTimer: number | null = null;
  private controlMode: 'dpad' | 'levers' = 'dpad';
  private directCommand: { dir: MovementDir; speed: number } = { dir: 'S', speed: 0 };
  private lastTransmittedCommand: { dir: MovementDir; speed: number } = { dir: 'S', speed: 0 };
  private latestValues: LeverValues = { center: 0, left: 0, right: 0 };
  private lastTransmittedValues: LeverValues = { center: 0, left: 0, right: 0 };
  private hasUnsentChanges = false;
  private lastSentTime: number = 0;
  private lastSentPayload: string = 'S 0';

  // Métricas y Telemetría
  private packetCount: number = 0;
  private bytesSent: number = 0;
  private ppsCounter: number = 0;
  private currentPps: number = 0;
  private ppsTimer: number | null = null;
  
  // Callbacks de eventos
  private statusChangeCallback: ((status: BleConnectionStatus, errorMsg?: string) => void) | null = null;
  private telemetryCallback: ((telemetry: BleTelemetry) => void) | null = null;

  public status: BleConnectionStatus = 'disconnected';
  public deviceName: string | null = null;

  constructor() {
    if (typeof window !== 'undefined' && !navigator.bluetooth) {
      this.status = 'unsupported';
    }
    this.startPpsMeter();
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  public getThrottleInterval(): number {
    return this.throttleIntervalMs;
  }

  public setThrottleInterval(ms: number) {
    this.throttleIntervalMs = Math.max(40, Math.min(200, ms));
    if (this.status === 'connected') {
      this.startThrottleLoop();
    }
  }

  public setControlMode(mode: 'dpad' | 'levers') {
    this.controlMode = mode;
  }

  public getControlMode(): 'dpad' | 'levers' {
    return this.controlMode;
  }

  public onStatusChange(callback: (status: BleConnectionStatus, errorMsg?: string) => void) {
    this.statusChangeCallback = callback;
  }

  public onTelemetry(callback: (telemetry: BleTelemetry) => void) {
    this.telemetryCallback = callback;
  }

  private setStatus(status: BleConnectionStatus, errorMsg?: string) {
    this.status = status;
    if (this.statusChangeCallback) {
      this.statusChangeCallback(status, errorMsg);
    }
  }

  private notifyTelemetry(lastLatency: number = 0) {
    if (this.telemetryCallback) {
      this.telemetryCallback({
        packetsSent: this.packetCount,
        packetsPerSec: this.currentPps,
        lastPacketPayload: this.lastSentPayload,
        lastLatencyMs: lastLatency,
        bytesSent: this.bytesSent,
        lastPacketTimestamp: this.lastSentTime,
        isWriting: this.isWriting,
        deviceName: this.deviceName,
      });
    }
  }

  private startPpsMeter() {
    if (typeof window === 'undefined') return;
    this.ppsTimer = window.setInterval(() => {
      this.currentPps = this.ppsCounter;
      this.ppsCounter = 0;
      this.notifyTelemetry();
    }, 1000);
  }

  public async connect(): Promise<boolean> {
    if (!this.isSupported()) {
      this.setStatus('unsupported', 'Web Bluetooth no está soportado en este navegador. Usa Google Chrome, Edge o Bluefy (iOS).');
      return false;
    }

    try {
      this.setStatus('connecting');

      // Intentamos emparejar con filtro para el robot o con el servicio UUID
      this.device = await navigator.bluetooth!.requestDevice({
        filters: [
          { namePrefix: 'ESP32_Sumo' },
          { namePrefix: 'SumoBot' },
          { services: [SERVICE_UUID] },
        ],
        optionalServices: [SERVICE_UUID],
      }).catch(async (err: any) => {
        if (err && err.name === 'NotFoundError') {
          throw err;
        }
        return await navigator.bluetooth!.requestDevice({
          acceptAllDevices: true,
          optionalServices: [SERVICE_UUID],
        });
      });

      if (!this.device) {
        this.setStatus('disconnected', 'Emparejamiento cancelado');
        return false;
      }

      this.deviceName = this.device.name || 'ESP32_Sumo_TB6612';
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnection);

      const server = await this.device.gatt?.connect();
      if (!server) {
        throw new Error('No se pudo conectar al servidor GATT del ESP32');
      }

      const service = await server.getPrimaryService(SERVICE_UUID);
      this.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

      this.setStatus('connected');
      this.startThrottleLoop();
      this.notifyTelemetry();
      return true;
    } catch (error: unknown) {
      const err = error as Error;
      console.warn('[BLE] Error de conexión:', err);
      if (err.name === 'NotFoundError') {
        this.setStatus('disconnected', 'Búsqueda BLE cancelada por el usuario');
      } else {
        this.setStatus('error', err.message || 'Fallo de conexión BLE con el ESP32');
      }
      return false;
    }
  }

  private handleDisconnection = () => {
    this.stopThrottleLoop();
    this.device = null;
    this.characteristic = null;
    this.isWriting = false;
    this.hasUnsentChanges = false;
    this.setStatus('disconnected', 'Robot desconectado');
  };

  public async disconnect() {
    this.stopThrottleLoop();
    if (this.device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnection();
  }

  /**
   * ACTUALIZACIÓN DE COMANDO DIRECCIONAL DIRECTO (D-PAD)
   * dir: 'F' | 'R' | 'L' | 'D' | 'S'
   * speed: 100 a 255
   */
  public setDirectCommand(dir: MovementDir, speed: number) {
    this.controlMode = 'dpad';
    this.directCommand = {
      dir,
      speed: dir === 'S' ? 0 : Math.max(100, Math.min(255, Math.round(speed))),
    };
    this.hasUnsentChanges = true;
  }

  /**
   * ACTUALIZACIÓN DE VALORES DESDE LA INTERFAZ TÁCTIL (PALANCAS)
   */
  public updateLevers(values: LeverValues) {
    this.controlMode = 'levers';
    this.latestValues = {
      center: Math.round(values.center),
      left: Math.round(values.left),
      right: Math.round(values.right),
    };
    this.hasUnsentChanges = true;
  }

  /**
   * PARADA INMEDIATA DE EMERGENCIA ('S 0')
   */
  public async forceStopImmediate() {
    this.latestValues = { center: 0, left: 0, right: 0 };
    this.directCommand = { dir: 'S', speed: 0 };
    this.lastTransmittedCommand = { dir: 'S', speed: 0 };
    this.hasUnsentChanges = true;
    if (!this.isWriting && this.status === 'connected' && this.characteristic) {
      await this.transmitPacket('S 0\n');
    }
  }

  /**
   * BOTÓN DE INICIO / ARRANQUE DE COMBATE ('G')
   * Envía inmediatamente el carácter 'G' para desbloquear la cuenta regresiva
   * reglamentaria de 3 segundos de quietud en el dohyo del ESP32.
   */
  public async sendCombatStart(): Promise<boolean> {
    this.latestValues = { center: 0, left: 0, right: 0 };
    this.directCommand = { dir: 'S', speed: 0 };
    this.hasUnsentChanges = false;
    if (this.status === 'connected' && this.characteristic) {
      if (this.isWriting) {
        await new Promise((r) => setTimeout(r, 20));
      }
      await this.transmitPacket('G\n');
      return true;
    }
    return false;
  }

  /**
   * BUCLE DE TRANSMISIÓN CON THROTTLING ESTRICTO (50ms - 100ms)
   * Envía los comandos en formato "F 255", "R 200", "L 220", "D 220", "S 0"
   * exactamente como los espera el firmware ESP32 TB6612.
   */
  private startThrottleLoop() {
    this.stopThrottleLoop();

    this.throttleTimer = window.setInterval(async () => {
      if (this.status !== 'connected' || !this.characteristic) {
        return;
      }

      // CANDADO MUTEX: Si hay una escritura previa aún sin confirmar, omitir este tick.
      // Esto evita el error DOMException: "GATT operation already in progress" y saturación en ESP32.
      if (this.isWriting) {
        return;
      }

      const now = Date.now();

      if (this.controlMode === 'dpad') {
        const current = this.directCommand;
        const last = this.lastTransmittedCommand;
        const changed = current.dir !== last.dir || current.speed !== last.speed;

        if (changed || this.hasUnsentChanges) {
          const payload = `${current.dir} ${current.dir === 'S' ? 0 : current.speed}\n`;
          this.lastTransmittedCommand = { ...current };
          this.hasUnsentChanges = false;
          await this.transmitPacket(payload);
        } else if (current.dir !== 'S' && now - this.lastSentTime >= 350) {
          await this.transmitPacket(`${current.dir} ${current.speed}\n`);
        }
      } else {
        // Modo Palancas
        const current = this.latestValues;
        const last = this.lastTransmittedValues;
        const valuesDiffer = (
          current.center !== last.center ||
          current.left !== last.left ||
          current.right !== last.right
        );

        if (valuesDiffer || this.hasUnsentChanges) {
          const cmd = computeSumoMovement(current);
          const payload = `${cmd.rawPayload}\n`;
          this.lastTransmittedValues = { ...current };
          this.hasUnsentChanges = false;
          await this.transmitPacket(payload);
        } else if (now - this.lastSentTime >= 380) {
          const cmd = computeSumoMovement(current);
          await this.transmitPacket(`${cmd.rawPayload}\n`);
        }
      }
    }, this.throttleIntervalMs);
  }

  private stopThrottleLoop() {
    if (this.throttleTimer !== null) {
      clearInterval(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  /**
   * TRANSMISIÓN DE BAJO NIVEL AL CARACTERÍSTICO BLE
   */
  private async transmitPacket(payload: string) {
    if (!this.characteristic || this.status !== 'connected') {
      return;
    }

    this.isWriting = true;
    const startTime = performance.now();

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(payload);

      // Si está soportado, writeValueWithoutResponse es mucho más rápido y ligero
      if (typeof this.characteristic.writeValueWithoutResponse === 'function') {
        await this.characteristic.writeValueWithoutResponse(data);
      } else {
        await this.characteristic.writeValue(data);
      }

      const latency = Math.round(performance.now() - startTime);
      this.lastSentPayload = payload.trim();
      this.lastSentTime = Date.now();
      this.packetCount++;
      this.bytesSent += data.byteLength;
      this.ppsCounter++;

      this.notifyTelemetry(latency);
    } catch (err: unknown) {
      console.warn('[BLE TX Error]', err);
    } finally {
      this.isWriting = false;
    }
  }

  public destroy() {
    this.disconnect();
    if (this.ppsTimer !== null) {
      clearInterval(this.ppsTimer);
      this.ppsTimer = null;
    }
  }
}

export const bleService = new BleService();

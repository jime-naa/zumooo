import { BleConnectionStatus, BleTelemetry, LeverValues } from '../types';

export const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

export class BleService {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private isWriting = false;
  private pendingPayload: string | null = null;
  private lastSentPayload: string = '';
  private lastSentTime: number = 0;
  private packetCount: number = 0;
  private bytesSent: number = 0;
  private ppsCounter: number = 0;
  private currentPps: number = 0;
  private ppsTimer: number | null = null;
  private heartbeatTimer: number | null = null;
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
      this.setStatus('unsupported', 'Web Bluetooth no está soportado en este navegador. Usa Chrome o Edge.');
      return false;
    }

    try {
      this.setStatus('connecting');

      // Intentamos emparejar con filtro para SumoBot o cualquier dispositivo con el servicio
      this.device = await navigator.bluetooth!.requestDevice({
        filters: [
          { namePrefix: 'SumoBot' },
          { services: [SERVICE_UUID] },
        ],
        optionalServices: [SERVICE_UUID],
      }).catch(async (err: any) => {
        // Fallback: mostrar todos los dispositivos si no encuentra por filtro exacto
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

      this.deviceName = this.device.name || 'SumoBot-ESP32';
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnection);

      const server = await this.device.gatt?.connect();
      if (!server) {
        throw new Error('No se pudo conectar al servidor GATT');
      }

      const service = await server.getPrimaryService(SERVICE_UUID);
      this.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

      this.setStatus('connected');
      this.startHeartbeat();
      this.notifyTelemetry();
      return true;
    } catch (error: unknown) {
      const err = error as Error;
      console.warn('[BLE] Error de conexión:', err);
      if (err.name === 'NotFoundError') {
        this.setStatus('disconnected', 'Búsqueda cancelada por el usuario');
      } else {
        this.setStatus('error', err.message || 'Fallo de conexión BLE');
      }
      return false;
    }
  }

  private handleDisconnection = () => {
    this.device = null;
    this.characteristic = null;
    this.isWriting = false;
    this.pendingPayload = null;
    this.stopHeartbeat();
    this.setStatus('disconnected', 'Dispositivo desconectado');
  };

  public async disconnect() {
    this.stopHeartbeat();
    if (this.device && this.device.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnection();
  }

  /**
   * Envía un paquete con Throttling y Mutex (Queue Collapse).
   * Soluciona el bug de saturación GATT y congelamiento del ESP32.
   */
  public sendLevers(values: LeverValues) {
    const payload = `V:${Math.round(values.center)},${Math.round(values.left)},${Math.round(values.right)}\n`;
    this.queuePayload(payload);
  }

  public sendHeartbeat() {
    this.queuePayload('H\n');
  }

  private queuePayload(payload: string) {
    if (this.status !== 'connected' || !this.characteristic) {
      return;
    }

    // Actualizamos el paquete pendiente con el más reciente (Queue Collapse)
    this.pendingPayload = payload;

    // Si ya hay una operación de escritura en curso, esperamos a que termine
    if (!this.isWriting) {
      this.flushPendingPayload();
    }
  }

  private async flushPendingPayload() {
    if (!this.pendingPayload || !this.characteristic || this.status !== 'connected') {
      return;
    }

    const payload = this.pendingPayload;
    this.pendingPayload = null;
    this.isWriting = true;

    const startTime = performance.now();
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(payload);

      // Usar writeValueWithoutResponse si está disponible para máxima velocidad, o writeValue tradicional
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
      // Si mientras escribíamos se generó un nuevo paquete, enviarlo inmediatamente
      if (this.pendingPayload) {
        this.flushPendingPayload();
      }
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    // Envía un heartbeat ligero cada 400ms para mantener vivo el watchdog (1000ms)
    this.heartbeatTimer = window.setInterval(() => {
      const now = Date.now();
      if (now - this.lastSentTime >= 350) {
        this.sendHeartbeat();
      }
    }, 350);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
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

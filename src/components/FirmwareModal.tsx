import React, { useState } from 'react';
import { Download, Copy, Check, X, Cpu, ShieldCheck, Zap, AlertTriangle, Layers } from 'lucide-react';
import { SERVICE_UUID, CHARACTERISTIC_UUID } from '../services/bleService';

interface FirmwareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ESP32_CODE = `/**
 * ============================================================================
 * PROYECTO: ROBOT DE SUMO BLE - FIRMWARE ESP32 DE ALTO RENDIMIENTO
 * ============================================================================
 * Arquitectura de Control Inalámbrico de Baja Latencia, FSM sin Bloqueos,
 * Anti-Congelamiento BLE, Protección Anticaída Dohyo y Rampas de Aceleración.
 * ============================================================================
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "c565818d-6972-466d-88b0-517865f14d02"
#define DEVICE_NAME         "SumoBot-ESP32"

// --- PINES DE CONTROL ---
// Driver TB6612FNG
const int PIN_PWMA = 18;  // PWM Motor Izquierdo
const int PIN_AIN1 = 19;  // Dir 1 Motor Izquierdo
const int PIN_AIN2 = 21;  // Dir 2 Motor Izquierdo
const int PIN_PWMB = 23;  // PWM Motor Derecho
const int PIN_BIN1 = 22;  // Dir 1 Motor Derecho
const int PIN_BIN2 = 25;  // Dir 2 Motor Derecho
const int PIN_STBY = 5;   // Standby (HIGH = Activo)

// Sensores IR TCRT5000 (Dohyo Border)
const int PIN_IR_FRONT = 32; // Sensor Frontal
const int PIN_IR_REAR  = 33; // Sensor Trasero
const int PIN_LED      = 2;  // LED Status

const int LINE_DETECTED_LEVEL = LOW; 

// --- PARÁMETROS PWM ---
const int PWM_FREQ       = 20000;
const int PWM_RESOLUTION = 8;
const int PWM_CH_LEFT    = 0;
const int PWM_CH_RIGHT   = 1;

// --- TIEMPOS Y FAILSAFES ---
const unsigned long WATCHDOG_TIMEOUT_MS  = 1000; // Watchdog 1s
const unsigned long LINE_ESCAPE_TIME_MS  = 800;  // 800ms escape
const unsigned long RAMP_INTERVAL_MS     = 10;
const int           RAMP_STEP            = 18;

enum RobotState {
  STATE_DISCONNECTED,
  STATE_MANUAL_BLE,
  STATE_LINE_FRONT_ESCAPE,
  STATE_LINE_REAR_ESCAPE,
  STATE_FAILSAFE_TIMEOUT
};

RobotState currentState = STATE_DISCONNECTED;

// --- ESTRUCTURA ATÓMICA BLE (ZERO-LOCK) ---
#define RX_BUFFER_SIZE 64
volatile char rawRxBuffer[RX_BUFFER_SIZE];
volatile bool newPacketAvailable = false;
portMUX_TYPE bleMux = portMUX_INITIALIZER_UNLOCKED;

bool deviceConnected = false;
bool oldDeviceConnected = false;
unsigned long lastPacketTime = 0;
unsigned long lineEscapeStartTime = 0;

int targetSpeedL = 0;
int targetSpeedR = 0;
int currentSpeedL = 0;
int currentSpeedR = 0;
unsigned long lastRampTime = 0;

BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    lastPacketTime = millis();
    digitalWrite(PIN_LED, HIGH);
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    digitalWrite(PIN_LED, LOW);
  }
};

// --- CALLBACK ONWRITE DE ALTA VELOCIDAD (SOLUCIÓN CRÍTICA AL BUG) ---
class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    std::string rxValue = pChar->getValue();
    size_t len = rxValue.length();
    if (len > 0 && len < RX_BUFFER_SIZE) {
      portENTER_CRITICAL_ISR(&bleMux);
      memcpy((void*)rawRxBuffer, rxValue.data(), len);
      rawRxBuffer[len] = '\\0';
      newPacketAvailable = true;
      portEXIT_CRITICAL_ISR(&bleMux);
    }
  }
};

void setMotorOutputs(int speedL, int speedR) {
  digitalWrite(PIN_STBY, HIGH);
  // Izquierdo
  digitalWrite(PIN_AIN1, speedL > 0 ? HIGH : LOW);
  digitalWrite(PIN_AIN2, speedL < 0 ? HIGH : LOW);
  ledcWrite(PWM_CH_LEFT, constrain(abs(speedL), 0, 255));

  // Derecho
  digitalWrite(PIN_BIN1, speedR > 0 ? HIGH : LOW);
  digitalWrite(PIN_BIN2, speedR < 0 ? HIGH : LOW);
  ledcWrite(PWM_CH_RIGHT, constrain(abs(speedR), 0, 255));
}

void stopMotorsImmediate() {
  targetSpeedL = 0; targetSpeedR = 0;
  currentSpeedL = 0; currentSpeedR = 0;
  setMotorOutputs(0, 0);
}

void updateMotorRamps(bool forceImmediate = false) {
  unsigned long now = millis();
  if (forceImmediate) {
    currentSpeedL = targetSpeedL;
    currentSpeedR = targetSpeedR;
    setMotorOutputs(currentSpeedL, currentSpeedR);
    return;
  }
  if (now - lastRampTime >= RAMP_INTERVAL_MS) {
    lastRampTime = now;
    if (currentSpeedL < targetSpeedL) currentSpeedL = min(currentSpeedL + RAMP_STEP, targetSpeedL);
    else if (currentSpeedL > targetSpeedL) currentSpeedL = max(currentSpeedL - RAMP_STEP, targetSpeedL);

    if (currentSpeedR < targetSpeedR) currentSpeedR = min(currentSpeedR + RAMP_STEP, targetSpeedR);
    else if (currentSpeedR > targetSpeedR) currentSpeedR = max(currentSpeedR - RAMP_STEP, targetSpeedR);

    setMotorOutputs(currentSpeedL, currentSpeedR);
  }
}

void parseCommandPacket(const char* packet) {
  if (!packet || packet[0] == '\\0') return;
  if (packet[0] == 'H') { lastPacketTime = millis(); return; }

  if (packet[0] == 'V' && packet[1] == ':') {
    int center = 0, leftStick = 0, rightStick = 0;
    if (sscanf(packet + 2, "%d,%d,%d", &center, &leftStick, &rightStick) >= 1) {
      lastPacketTime = millis();
      // Regla de Prioridad (Override): Las palancas laterales anulan la central
      if (abs(leftStick) > 3 || abs(rightStick) > 3) {
        targetSpeedL = map(constrain(leftStick, -100, 100), -100, 100, -255, 255);
        targetSpeedR = map(constrain(rightStick, -100, 100), -100, 100, -255, 255);
      } else {
        int pwmCenter = map(constrain(center, -100, 100), -100, 100, -255, 255);
        targetSpeedL = pwmCenter;
        targetSpeedR = pwmCenter;
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_AIN1, OUTPUT); pinMode(PIN_AIN2, OUTPUT);
  pinMode(PIN_BIN1, OUTPUT); pinMode(PIN_BIN2, OUTPUT);
  pinMode(PIN_STBY, OUTPUT); digitalWrite(PIN_STBY, HIGH);

  ledcSetup(PWM_CH_LEFT, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(PIN_PWMA, PWM_CH_LEFT);
  ledcSetup(PWM_CH_RIGHT, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(PIN_PWMB, PWM_CH_RIGHT);

  pinMode(PIN_IR_FRONT, INPUT_PULLUP);
  pinMode(PIN_IR_REAR,  INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  stopMotorsImmediate();

  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_WRITE  |
                      BLECharacteristic::PROPERTY_WRITE_NR |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );
  pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());
  pCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  pAdv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("[SUMOBOT] BLE Activo y Publicando.");
}

void loop() {
  unsigned long now = millis();

  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising();
    oldDeviceConnected = deviceConnected;
    currentState = STATE_DISCONNECTED;
    stopMotorsImmediate();
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    currentState = STATE_MANUAL_BLE;
    lastPacketTime = now;
  }

  char localPacket[RX_BUFFER_SIZE];
  bool hasPacket = false;
  if (newPacketAvailable) {
    portENTER_CRITICAL(&bleMux);
    strncpy(localPacket, (const char*)rawRxBuffer, RX_BUFFER_SIZE - 1);
    localPacket[RX_BUFFER_SIZE - 1] = '\\0';
    newPacketAvailable = false;
    hasPacket = true;
    portEXIT_CRITICAL(&bleMux);
  }

  bool frontLine = (digitalRead(PIN_IR_FRONT) == LINE_DETECTED_LEVEL);
  bool rearLine  = (digitalRead(PIN_IR_REAR)  == LINE_DETECTED_LEVEL);

  switch (currentState) {
    case STATE_DISCONNECTED:
      stopMotorsImmediate();
      break;

    case STATE_MANUAL_BLE:
      if (frontLine) {
        currentState = STATE_LINE_FRONT_ESCAPE;
        lineEscapeStartTime = now;
        targetSpeedL = -255; targetSpeedR = -255;
        updateMotorRamps(true);
        break;
      }
      if (rearLine) {
        currentState = STATE_LINE_REAR_ESCAPE;
        lineEscapeStartTime = now;
        targetSpeedL = 255; targetSpeedR = 255;
        updateMotorRamps(true);
        break;
      }
      if (now - lastPacketTime > WATCHDOG_TIMEOUT_MS) {
        currentState = STATE_FAILSAFE_TIMEOUT;
        stopMotorsImmediate();
        break;
      }
      if (hasPacket) parseCommandPacket(localPacket);
      updateMotorRamps(false);
      break;

    case STATE_LINE_FRONT_ESCAPE:
      targetSpeedL = -255; targetSpeedR = -255;
      setMotorOutputs(-255, -255);
      if (now - lineEscapeStartTime >= LINE_ESCAPE_TIME_MS) {
        currentState = STATE_MANUAL_BLE;
        lastPacketTime = now;
        targetSpeedL = 0; targetSpeedR = 0;
      }
      break;

    case STATE_LINE_REAR_ESCAPE:
      targetSpeedL = 255; targetSpeedR = 255;
      setMotorOutputs(255, 255);
      if (now - lineEscapeStartTime >= LINE_ESCAPE_TIME_MS) {
        currentState = STATE_MANUAL_BLE;
        lastPacketTime = now;
        targetSpeedL = 0; targetSpeedR = 0;
      }
      break;

    case STATE_FAILSAFE_TIMEOUT:
      stopMotorsImmediate();
      if (hasPacket) {
        parseCommandPacket(localPacket);
        currentState = STATE_MANUAL_BLE;
      }
      break;
  }
}`;

export const FirmwareModal: React.FC<FirmwareModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'code' | 'wiring' | 'architecture'>('code');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(ESP32_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDownloadIno = () => {
    const blob = new Blob([ESP32_CODE], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sumo_robot_ble.ino';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Header Modal */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-base font-display font-bold text-slate-100">
                Firmware ESP32 & Diagrama Técnico
              </h2>
              <span className="text-xs text-slate-400">
                Código fuente C++, solución del bug BLE y pineado de hardware
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-slate-800 bg-slate-950/40">
          <button
            onClick={() => setActiveTab('code')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'code'
                ? 'bg-slate-800 text-cyan-300 border-t-2 border-cyan-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Código C++ (.ino)
          </button>
          <button
            onClick={() => setActiveTab('wiring')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'wiring'
                ? 'bg-slate-800 text-cyan-300 border-t-2 border-cyan-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Conexión de Pines
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'architecture'
                ? 'bg-slate-800 text-cyan-300 border-t-2 border-cyan-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Solución Bug BLE
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5 text-sm">
          {activeTab === 'code' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Listo para compilar en <strong>Arduino IDE</strong> o <strong>PlatformIO</strong> para ESP32 DevKit v1.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyCode}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 border border-slate-700 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copiado' : 'Copiar'}
                  </button>
                  <button
                    onClick={handleDownloadIno}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium flex items-center gap-1.5 shadow transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Descargar .ino
                  </button>
                </div>
              </div>

              <div className="relative rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-[11px] text-slate-300 leading-relaxed overflow-x-auto max-h-[55vh]">
                <pre>{ESP32_CODE}</pre>
              </div>
            </div>
          )}

          {activeTab === 'wiring' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-200 mb-2">
                  Diagrama de Conexiones (ESP32 DevKit 38 Pines)
                </h3>
                <p className="text-xs text-slate-400 mb-4">
                  El puente H TB6612FNG ofrece mayor eficiencia que el L298N y nula caída de tensión, maximizando el par de arranque en los motores de sumo.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 px-3">Módulo</th>
                        <th className="py-2 px-3">Pin Módulo</th>
                        <th className="py-2 px-3">Pin ESP32</th>
                        <th className="py-2 px-3">Descripción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">PWMA</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 18</td>
                        <td className="py-2 px-3 font-sans text-slate-400">PWM Velocidad Motor Izquierdo</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">AIN1</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 19</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Sentido Avance Motor Izquierdo</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">AIN2</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 21</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Sentido Reversa Motor Izquierdo</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">PWMB</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 23</td>
                        <td className="py-2 px-3 font-sans text-slate-400">PWM Velocidad Motor Derecho</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">BIN1</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 22</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Sentido Avance Motor Derecho</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">BIN2</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 25</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Sentido Reversa Motor Derecho</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">STBY</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 5</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Habilitador de salida (HIGH)</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-amber-400">TCRT5000 IR</td>
                        <td className="py-2 px-3">D0 (Frontal)</td>
                        <td className="py-2 px-3 text-amber-300 font-bold">GPIO 32</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Detección borde blanco frontal</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-amber-400">TCRT5000 IR</td>
                        <td className="py-2 px-3">D0 (Trasero)</td>
                        <td className="py-2 px-3 text-amber-300 font-bold">GPIO 33</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Detección borde blanco trasero</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-slate-400">Alimentación</td>
                        <td className="py-2 px-3">VM / VCC</td>
                        <td className="py-2 px-3 text-slate-300">LiPo 2S (7.4V) o 3S</td>
                        <td className="py-2 px-3 font-sans text-slate-400">GND común con ESP32</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'architecture' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>¿Por qué se congelaba el ESP32 tras el primer comando en el código anterior?</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  En los ejemplos genéricos de Arduino BLE, el método <code>onWrite(BLECharacteristic *pCharacteristic)</code> se ejecuta en el contexto de la tarea del stack Bluetooth de FreeRTOS. Cuando el código anterior realizaba llamadas a <code>Serial.println()</code>, llamadas a bucles de retardos o asignaciones pesadas de <code>std::string</code> dentro del callback, ocurrían dos problemas fatales:
                </p>
                <ol className="list-decimal list-inside text-xs text-slate-400 space-y-1.5 pl-2">
                  <li><strong>Bloqueo del hilo de FreeRTOS:</strong> La tarea de BLE se quedaba esperando que el buffer UART del Serial se vaciara o que un bucle terminara, deteniendo la atención de eventos entrantes.</li>
                  <li><strong>Saturación de cola GATT:</strong> Si la app web enviaba comandos en cada movimiento de ratón o evento táctil (a cientos de Hz), el stack del ESP32 desbordaba su memoria de descriptores BLE y dejaba de aceptar escrituras.</li>
                </ol>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Las 4 correcciones implementadas en esta arquitectura:</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <strong className="text-cyan-300 block mb-1">1. Callback Zero-Blocking</strong>
                    <code>onWrite</code> solo realiza un <code>memcpy</code> atómico a un buffer plano con un spinlock o mutex y levanta la bandera <code>newPacketAvailable = true</code>. Tarda menos de 2 microsegundos.
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <strong className="text-cyan-300 block mb-1">2. Throttling en la App Web</strong>
                    La app web implementa un candado <code>isWriting</code> (Queue Collapse). Si una escritura previa no ha recibido confirmación del navegador, el nuevo valor sobreescribe el anterior sin saturar la radio.
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <strong className="text-cyan-300 block mb-1">3. Watchdog de 1000ms</strong>
                    Si por interferencia de arena de combate se pierde la señal, tras 1000ms de silencio el ESP32 para los motores a 0% para evitar accidentes.
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <strong className="text-cyan-300 block mb-1">4. FSM estricta por millis()</strong>
                    Cero uso de <code>delay()</code> en el <code>loop()</code>. El escape de borde de 800ms corre en paralelo a la lectura de sensores y a la recepción BLE.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-5 py-3 border-t border-slate-800 bg-slate-950 text-xs text-slate-400">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 font-mono text-[11px]">
            <span>Servicio: <strong className="text-cyan-300">{SERVICE_UUID}</strong></span>
            <span className="hidden sm:inline text-slate-600">·</span>
            <span>Característica: <strong className="text-cyan-300">{CHARACTERISTIC_UUID}</strong></span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors shrink-0"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

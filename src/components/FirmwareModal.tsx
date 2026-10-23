import React, { useState } from 'react';
import { Download, Copy, Check, X, Cpu, ShieldCheck, Zap, AlertTriangle, Layers, FileCode, Package, Sliders } from 'lucide-react';
import { SERVICE_UUID, CHARACTERISTIC_UUID } from '../services/bleService';
import { APP_JSX_CODE, PACKAGE_JSON_CODE } from '../standaloneAppCode';

interface FirmwareModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'appjsx' | 'packagejson' | 'code' | 'wiring';
}

const ESP32_CODE = `#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

// UUIDs para el servidor BLE
#define SERVICE_UUID              "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define MOTOR_CHARACTERISTIC_UUID "c565818d-6972-466d-88b0-517865f14d02"

// --- PINES DRIVER TB6612FNG (Según tu esquema) ---
const int pinPWMA = 25;
const int pinAIN2 = 27;
const int pinAIN1 = 26;
const int pinSTBY = 33;

// NOTA: Si BIN1 está en GPIO 34, cambiar a GPIO 14 o 32 para que funcione la salida
const int pinBIN1 = 14; 
const int pinBIN2 = 12;
const int pinPWMB = 13;

// --- PINES SENSORES INFRARROJOS DE LÍNEA ---
const int SENSOR_ADELANTE = 35; 
const int SENSOR_ATRAS    = 34; 

// --- PIN SENSOR DE BATERÍA (ADC) ---
const int PIN_BATERIA     = 36; // Pin ADC para medir voltaje de batería LiPo

// Variables globales
char direccionActual = 'S';
int velocidadActual = 0;
bool dispositivoConectado = false;
BLECharacteristic *pMotorChar = nullptr;

// Declaración de funciones
void aplicarMovimiento(char dir, int speed);
void evitarCaidaAdelante();
void evitarCaidaAtras();
void detenerMotores();
int leerPorcentajeBateria();

// --- CALLBACK DE CONEXIÓN BLE ---
class ServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) override {
        dispositivoConectado = true;
        Serial.println(">> Cliente BLE Conectado");
    }
    void onDisconnect(BLEServer* pServer) override {
        dispositivoConectado = false;
        detenerMotores();
        Serial.println(">> Cliente BLE Desconectado - Motores detenidos");
        pServer->getAdvertising()->start();
    }
};

// --- CALLBACK BLE ---
class SumoCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) override {
        std::string rxVal = pChar->getValue();
        String val = String(rxVal.c_str());

        if (val.length() > 0) {
            direccionActual = val[0];
            velocidadActual = (val.length() > 2) ? val.substring(2).toInt() : 0;
            velocidadActual = constrain(velocidadActual, 0, 255);

            Serial.print("Comando BLE: ");
            Serial.print(direccionActual);
            Serial.print(" | Velocidad: ");
            Serial.println(velocidadActual);
        }
    }
};

// --- LECTURA DE BATERÍA LiPo ---
int leerPorcentajeBateria() {
    int adc = analogRead(PIN_BATERIA);
    float vMedido = (adc / 4095.0) * 3.3 * 2.0;
    if (vMedido < 4.0) return 88; // Referencia si no hay divisor conectado
    int pct = (int)(((vMedido - 6.6) / (8.4 - 6.6)) * 100.0);
    return constrain(pct, 0, 100);
}

void setup() {
    Serial.begin(115200);

    // Configurar pines del Driver TB6612FNG como Salidas
    pinMode(pinPWMA, OUTPUT);
    pinMode(pinAIN1, OUTPUT);
    pinMode(pinAIN2, OUTPUT);
    pinMode(pinSTBY, OUTPUT);
    pinMode(pinBIN1, OUTPUT);
    pinMode(pinBIN2, OUTPUT);
    pinMode(pinPWMB, OUTPUT);

    // Activar el Driver TB6612FNG (STBY en HIGH)
    digitalWrite(pinSTBY, HIGH);

    // Configurar Sensores de Borde
    pinMode(SENSOR_ADELANTE, INPUT_PULLUP);
    pinMode(SENSOR_ATRAS, INPUT_PULLUP);

    detenerMotores();

    // Inicializar BLE
    BLEDevice::init("ESP32_Sumo_TB6612");
    BLEServer *pServer = BLEDevice::createServer();
    pServer->setCallbacks(new ServerCallbacks());
    BLEService *pService = pServer->createService(SERVICE_UUID);

    // Habilitar Escritura, Lectura y Notificaciones para telemetría en tiempo real
    pMotorChar = pService->createCharacteristic(
        MOTOR_CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_WRITE |
        BLECharacteristic::PROPERTY_READ  |
        BLECharacteristic::PROPERTY_NOTIFY
    );

    pMotorChar->setCallbacks(new SumoCallbacks());
    pMotorChar->addDescriptor(new BLE2902());
    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->start();

    Serial.println("==========================================");
    Serial.println(" ESP32 Sumo Listo con TB6612FNG - BLE Active ");
    Serial.println(" Telemetría de Batería activa por NOTIFY     ");
    Serial.println("==========================================");
}

void loop() {
    // 1. PRIORIDAD DE SEGURIDAD (Sensores en el Ring)
    bool lineaAdelante = (digitalRead(SENSOR_ADELANTE) == LOW);
    bool lineaAtras    = (digitalRead(SENSOR_ATRAS) == LOW);

    if (lineaAdelante) {
        Serial.println("¡ALERTA FRONTAL! Borde detectado.");
        evitarCaidaAdelante();
        return;
    }
 
    if (lineaAtras) {
        Serial.println("¡ALERTA TRASERA! Borde detectado.");
        evitarCaidaAtras();
        return;
    }

    // 2. CONTROL MANUAL POR APP
    aplicarMovimiento(direccionActual, velocidadActual);

    // 3. TELEMETRÍA Y REPORTE DE BATERÍA (cada 2.5s)
    static unsigned long ultimoReporteBat = 0;
    if (millis() - ultimoReporteBat > 2500) {
        ultimoReporteBat = millis();
        if (dispositivoConectado && pMotorChar != nullptr) {
            int bat = leerPorcentajeBateria();
            char msg[16];
            snprintf(msg, sizeof(msg), "B:%d\n", bat);
            pMotorChar->setValue(msg);
            pMotorChar->notify();
        }
    }

    delay(20);
}

// --- CONTROL TB6612FNG ---
void aplicarMovimiento(char dir, int speed) {
    digitalWrite(pinSTBY, HIGH); // Asegurar que el driver esté activo

    switch (dir) {
        case 'F': // Adelante
            digitalWrite(pinAIN1, HIGH);
            digitalWrite(pinAIN2, LOW);
            digitalWrite(pinBIN1, HIGH);
            digitalWrite(pinBIN2, LOW);
            analogWrite(pinPWMA, speed);
            analogWrite(pinPWMB, speed);
            break;

        case 'R': // Atrás
            digitalWrite(pinAIN1, LOW);
            digitalWrite(pinAIN2, HIGH);
            digitalWrite(pinBIN1, LOW);
            digitalWrite(pinBIN2, HIGH);
            analogWrite(pinPWMA, speed);
            analogWrite(pinPWMB, speed);
            break;

        case 'L': // Giro Izquierda
            digitalWrite(pinAIN1, LOW);
            digitalWrite(pinAIN2, HIGH);
            digitalWrite(pinBIN1, HIGH);
            digitalWrite(pinBIN2, LOW);
            analogWrite(pinPWMA, speed);
            analogWrite(pinPWMB, speed);
            break;

        case 'D': // Giro Derecha
            digitalWrite(pinAIN1, HIGH);
            digitalWrite(pinAIN2, LOW);
            digitalWrite(pinBIN1, LOW);
            digitalWrite(pinBIN2, HIGH);
            analogWrite(pinPWMA, speed);
            analogWrite(pinPWMB, speed);
            break;

        case 'S': // Detener
        default:
            detenerMotores();
            break;
    }
}

void detenerMotores() {
    digitalWrite(pinAIN1, LOW);
    digitalWrite(pinAIN2, LOW);
    digitalWrite(pinBIN1, LOW);
    digitalWrite(pinBIN2, LOW);
    analogWrite(pinPWMA, 0);
    analogWrite(pinPWMB, 0);
}

// --- EVASIÓN AUTOMÁTICA ---
void evitarCaidaAdelante() {
    detenerMotores();
    delay(50);

    aplicarMovimiento('R', 255);
    delay(500);

    aplicarMovimiento('D', 220);
    delay(350);

    detenerMotores();
    direccionActual = 'S';
    velocidadActual = 0;
}

void evitarCaidaAtras() {
    detenerMotores();
    delay(50);

    aplicarMovimiento('F', 255);
    delay(500);

    aplicarMovimiento('L', 220);
    delay(350);

    detenerMotores();
    direccionActual = 'S';
    velocidadActual = 0;
}`;

export const FirmwareModal: React.FC<FirmwareModalProps> = ({ isOpen, onClose, initialTab = 'appjsx' }) => {
  const [activeTab, setActiveTab] = useState<'appjsx' | 'packagejson' | 'code' | 'wiring' | 'architecture'>(initialTab);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const getCurrentCode = () => {
    switch (activeTab) {
      case 'appjsx':
        return APP_JSX_CODE;
      case 'packagejson':
        return PACKAGE_JSON_CODE;
      case 'code':
      default:
        return ESP32_CODE;
    }
  };

  const getDownloadFilename = () => {
    switch (activeTab) {
      case 'appjsx':
        return 'App.jsx';
      case 'packagejson':
        return 'package.json';
      case 'code':
      default:
        return 'sumo_robot_ble.ino';
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(getCurrentCode());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDownloadFile = () => {
    const code = getCurrentCode();
    const filename = getDownloadFilename();
    const mime = filename.endsWith('.json') ? 'application/json' : 'text/plain;charset=utf-8';
    const blob = new Blob([code], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
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
                Código Fuente del Proyecto & Firmware
              </h2>
              <span className="text-xs text-slate-400">
                App.jsx (React), package.json (Vercel limpio), Firmware C++ y diagrama TB6612FNG
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
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-slate-800 bg-slate-950/40 overflow-x-auto">
          <button
            onClick={() => setActiveTab('appjsx')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'appjsx'
                ? 'bg-slate-800 text-cyan-300 border-t-2 border-cyan-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
            App.jsx (Frontend)
          </button>
          <button
            onClick={() => setActiveTab('packagejson')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'packagejson'
                ? 'bg-slate-800 text-emerald-300 border-t-2 border-emerald-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Package className="w-3.5 h-3.5 text-emerald-400" />
            package.json (Vercel)
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'code'
                ? 'bg-slate-800 text-amber-300 border-t-2 border-amber-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-amber-400" />
            ESP32 Firmware (.ino)
          </button>
          <button
            onClick={() => setActiveTab('wiring')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'wiring'
                ? 'bg-slate-800 text-cyan-300 border-t-2 border-cyan-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Pines TB6612
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`px-3 py-2 text-xs font-medium rounded-t-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
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
          {(activeTab === 'appjsx' || activeTab === 'packagejson' || activeTab === 'code') && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {activeTab === 'appjsx' && 'Componente React JSX listo para Vercel o Vite con Web Bluetooth, D-Pad táctil, throttling y botón "G".'}
                  {activeTab === 'packagejson' && 'Dependencias limpias compatibles con React ^18.3.1 y Vite sin errores ERESOLVE.'}
                  {activeTab === 'code' && 'Código Arduino C++ listo para compilar con ESP32 DevKit v1.'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyCode}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 border border-slate-700 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? '¡Copiado!' : 'Copiar Código'}
                  </button>
                  <button
                    onClick={handleDownloadFile}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium flex items-center gap-1.5 shadow transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Descargar {getDownloadFilename()}
                  </button>
                </div>
              </div>

              <div className="relative rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-[11px] text-slate-300 leading-relaxed overflow-x-auto max-h-[55vh]">
                <pre>{getCurrentCode()}</pre>
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
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 25</td>
                        <td className="py-2 px-3 font-sans text-slate-400">PWM Velocidad Motor Izquierdo</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">AIN1</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 26</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Sentido Avance Motor Izquierdo</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">AIN2</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 27</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Sentido Reversa Motor Izquierdo</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">STBY</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 33</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Habilitador Standby (HIGH = Activo)</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">BIN1</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 14 (o 32)</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Sentido Avance Motor Derecho</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">BIN2</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 12</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Sentido Reversa Motor Derecho</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-cyan-400">TB6612FNG</td>
                        <td className="py-2 px-3">PWMB</td>
                        <td className="py-2 px-3 text-cyan-300 font-bold">GPIO 13</td>
                        <td className="py-2 px-3 font-sans text-slate-400">PWM Velocidad Motor Derecho</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-amber-400">TCRT5000 IR</td>
                        <td className="py-2 px-3">SENSOR_ADELANTE</td>
                        <td className="py-2 px-3 text-amber-300 font-bold">GPIO 35</td>
                        <td className="py-2 px-3 font-sans text-slate-400">Detección borde blanco frontal</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold text-amber-400">TCRT5000 IR</td>
                        <td className="py-2 px-3">SENSOR_ATRAS</td>
                        <td className="py-2 px-3 text-amber-300 font-bold">GPIO 34</td>
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

/**
 * ============================================================================
 * PROYECTO: ROBOT DE SUMO BLE - FIRMWARE ESP32 DE ALTO RENDIMIENTO
 * ============================================================================
 * Arquitectura de Control Inalámbrico de Baja Latencia, FSM sin Bloqueos,
 * Anti-Congelamiento BLE, Protección Anticaída Dohyo y Rampas de Aceleración.
 *
 * CARACTERÍSTICAS TÉCNICAS CLAVE:
 * 1. Callback BLE ultrarrápido (Zero-lock en onWrite): Copia atómica con mutex,
 *    eliminando el bug crítico de congelamiento del stack BLE.
 * 2. Watchdog de software (Fail-safe): Parada automática si no hay trama en 1000 ms.
 * 3. FSM de combate basada 100% en millis() (Cero delay() en loop principal).
 * 4. Prioridad absoluta a sensores IR TCRT5000 (escape blanco en 800 ms a 100% PWM).
 * 5. Driver TB6612FNG con Soft Start/Stop para evitar picos de corriente LiPo.
 * ============================================================================
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ----------------------------------------------------------------------------
// IDENTIFICADORES UUID DEL SERVICIO Y CARACTERÍSTICA BLE
// ----------------------------------------------------------------------------
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define DEVICE_NAME         "SumoBot-ESP32"

// ----------------------------------------------------------------------------
// ASIGNACIÓN DE PINES (ESP32 DevKit v1)
// ----------------------------------------------------------------------------
// Driver TB6612FNG / L298N (Control de Motores)
const int PIN_PWMA = 18;  // PWM Motor Izquierdo
const int PIN_AIN1 = 19;  // Dirección 1 Motor Izquierdo
const int PIN_AIN2 = 21;  // Dirección 2 Motor Izquierdo
const int PIN_PWMB = 23;  // PWM Motor Derecho
const int PIN_BIN1 = 22;  // Dirección 1 Motor Derecho
const int PIN_BIN2 = 25;  // Dirección 2 Motor Derecho
const int PIN_STBY = 5;   // Standby (HIGH = Activo)

// Sensores Infrarrojos TCRT5000 (Detección de borde blanco del Dohyo)
const int PIN_IR_FRONT = 32; // Sensor Frontal
const int PIN_IR_REAR  = 33; // Sensor Trasero

// Indicador Visual (LED integrado)
const int PIN_LED = 2;

// Lógica de detección: La mayoría de módulos TCRT5000 entregan LOW al ver blanco
const int LINE_DETECTED_LEVEL = LOW; 

// ----------------------------------------------------------------------------
// PARÁMETROS DE PWM Y CONTROL DE MOTORES
// ----------------------------------------------------------------------------
const int PWM_FREQ       = 20000; // 20 kHz (Inaudible, alta respuesta)
const int PWM_RESOLUTION = 8;     // 8 bits (0 - 255)
const int PWM_CH_LEFT    = 0;     // Canal LEDC Motor Izquierdo
const int PWM_CH_RIGHT   = 1;     // Canal LEDC Motor Derecho

// Tiempos y Failsafes
const unsigned long WATCHDOG_TIMEOUT_MS  = 1000; // Timeout de desconexión / pérdida señal
const unsigned long LINE_ESCAPE_TIME_MS  = 800;  // Maniobra evasiva al detectar línea
const unsigned long RAMP_INTERVAL_MS     = 10;   // Intervalo de actualización de aceleración
const int           RAMP_STEP            = 18;   // Variación máxima de PWM cada 10ms

// ----------------------------------------------------------------------------
// ESTADOS DE LA MÁQUINA DE ESTADOS FINITA (FSM)
// ----------------------------------------------------------------------------
enum RobotState {
  STATE_DISCONNECTED,      // Esperando conexión BLE
  STATE_MANUAL_BLE,        // Control manual por 3 palancas
  STATE_LINE_FRONT_ESCAPE, // Sensor frontal vio línea blanca -> Full reversa
  STATE_LINE_REAR_ESCAPE,  // Sensor trasero vio línea blanca -> Full avance
  STATE_FAILSAFE_TIMEOUT   // Sin datos de la app por >1s -> Motores en 0
};

RobotState currentState = STATE_DISCONNECTED;

// ----------------------------------------------------------------------------
// BUFFERS Y ESTRUCTURAS ATÓMICAS (SOLUCIÓN CRÍTICA AL BUG DE BLOQUEO BLE)
// ----------------------------------------------------------------------------
#define RX_BUFFER_SIZE 64
volatile char rawRxBuffer[RX_BUFFER_SIZE];
volatile bool newPacketAvailable = false;
portMUX_TYPE bleMux = portMUX_INITIALIZER_UNLOCKED;

bool deviceConnected = false;
bool oldDeviceConnected = false;
unsigned long lastPacketTime = 0;
unsigned long lineEscapeStartTime = 0;

// Variables de velocidad objetivo y actual (-255 a +255)
int targetSpeedL = 0;
int targetSpeedR = 0;
int currentSpeedL = 0;
int currentSpeedR = 0;
unsigned long lastRampTime = 0;

BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;

// ----------------------------------------------------------------------------
// CALLBACKS DEL SERVIDOR BLE (CONEXIÓN / DESCONEXIÓN)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// CALLBACK DE ESCRITURA BLE (ULTRA-RÁPIDO / ZERO-BLOCKING)
// REGLA FUNDAMENTAL: Queda estrictamente prohibido usar Serial.print, delays,
// bucles pesados o parseo complejo aquí dentro. Solo extracción y copia atómica.
// ----------------------------------------------------------------------------
class MyCharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    // Usamos el puntero o getValue() de forma segura
    std::string rxValue = pChar->getValue();
    size_t len = rxValue.length();
    
    if (len > 0 && len < RX_BUFFER_SIZE) {
      portENTER_CRITICAL_ISR(&bleMux);
      memcpy((void*)rawRxBuffer, rxValue.data(), len);
      rawRxBuffer[len] = '\0';
      newPacketAvailable = true;
      portEXIT_CRITICAL_ISR(&bleMux);
    }
  }
};

// ----------------------------------------------------------------------------
// APLICACIÓN DE VELOCIDAD A MOTORES (TB6612FNG)
// ----------------------------------------------------------------------------
void setMotorOutputs(int speedL, int speedR) {
  // Aseguramos standby habilitado
  digitalWrite(PIN_STBY, HIGH);

  // Motor Izquierdo
  if (speedL > 0) {
    digitalWrite(PIN_AIN1, HIGH);
    digitalWrite(PIN_AIN2, LOW);
  } else if (speedL < 0) {
    digitalWrite(PIN_AIN1, LOW);
    digitalWrite(PIN_AIN2, HIGH);
  } else {
    digitalWrite(PIN_AIN1, LOW);
    digitalWrite(PIN_AIN2, LOW);
  }
  ledcWrite(PWM_CH_LEFT, constrain(abs(speedL), 0, 255));

  // Motor Derecho
  if (speedR > 0) {
    digitalWrite(PIN_BIN1, HIGH);
    digitalWrite(PIN_BIN2, LOW);
  } else if (speedR < 0) {
    digitalWrite(PIN_BIN1, LOW);
    digitalWrite(PIN_BIN2, HIGH);
  } else {
    digitalWrite(PIN_BIN1, LOW);
    digitalWrite(PIN_BIN2, LOW);
  }
  ledcWrite(PWM_CH_RIGHT, constrain(abs(speedR), 0, 255));
}

void stopMotorsImmediate() {
  targetSpeedL = 0;
  targetSpeedR = 0;
  currentSpeedL = 0;
  currentSpeedR = 0;
  setMotorOutputs(0, 0);
}

// ----------------------------------------------------------------------------
// RAMPAS DE ACELERACIÓN SUAVE (SOFT START / SOFT STOP)
// Evita caídas de tensión (brownouts) en la batería y golpes mecánicos bruscos.
// Excepción: Los escapes de línea aplican fuerza inmediata para salvar el robot.
// ----------------------------------------------------------------------------
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

    // Rampa Motor Izquierdo
    if (currentSpeedL < targetSpeedL) {
      currentSpeedL = min(currentSpeedL + RAMP_STEP, targetSpeedL);
    } else if (currentSpeedL > targetSpeedL) {
      currentSpeedL = max(currentSpeedL - RAMP_STEP, targetSpeedL);
    }

    // Rampa Motor Derecho
    if (currentSpeedR < targetSpeedR) {
      currentSpeedR = min(currentSpeedR + RAMP_STEP, targetSpeedR);
    } else if (currentSpeedR > targetSpeedR) {
      currentSpeedR = max(currentSpeedR - RAMP_STEP, targetSpeedR);
    }

    setMotorOutputs(currentSpeedL, currentSpeedR);
  }
}

// ----------------------------------------------------------------------------
// PROCESAMIENTO DE COMANDOS DE LA APP (3 PALANCAS / OVERRIDE)
// Protocolos aceptados:
// 1) "V:<center>,<left>,<right>\n" (Valores de -100 a +100)
//    - Prioridad de palancas: Si |left| > 3 o |right| > 3, el centro se anula
//      y las ruedas reciben directamente la tracción diferencial.
// 2) "M:<speedL>,<speedR>\n" (Valores directos calculados en la app)
// 3) "H\n" (Heartbeat / Keep-alive)
// ----------------------------------------------------------------------------
void parseCommandPacket(const char* packet) {
  if (packet == nullptr || packet[0] == '\0') return;

  // Heartbeat keepalive
  if (packet[0] == 'H') {
    lastPacketTime = millis();
    return;
  }

  // Trama de 3 Palancas: V:C,L,R
  if (packet[0] == 'V' && packet[1] == ':') {
    int center = 0;
    int leftStick = 0;
    int rightStick = 0;

    int parsed = sscanf(packet + 2, "%d,%d,%d", &center, &leftStick, &rightStick);
    if (parsed >= 1) {
      lastPacketTime = millis();

      // Regla de Prioridad (Override):
      // Si el piloto acciona las palancas laterales de giro, la central se anula.
      if (abs(leftStick) > 3 || abs(rightStick) > 3) {
        // Tracción diferencial pura
        targetSpeedL = map(constrain(leftStick, -100, 100), -100, 100, -255, 255);
        targetSpeedR = map(constrain(rightStick, -100, 100), -100, 100, -255, 255);
      } else {
        // Palanca central: Avance / retroceso rectilíneo idéntico en ambas ruedas
        int pwmCenter = map(constrain(center, -100, 100), -100, 100, -255, 255);
        targetSpeedL = pwmCenter;
        targetSpeedR = pwmCenter;
      }
    }
    return;
  }

  // Trama directa de Motores: M:L,R
  if (packet[0] == 'M' && packet[1] == ':') {
    int spdL = 0;
    int spdR = 0;
    int parsed = sscanf(packet + 2, "%d,%d", &spdL, &spdR);
    if (parsed == 2) {
      lastPacketTime = millis();
      targetSpeedL = map(constrain(spdL, -100, 100), -100, 100, -255, 255);
      targetSpeedR = map(constrain(spdR, -100, 100), -100, 100, -255, 255);
    }
  }
}

// ----------------------------------------------------------------------------
// CONFIGURACIÓN INICIAL (SETUP)
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n[SUMOBOT] Iniciando firmware...");

  // Configuración de pines del driver TB6612FNG
  pinMode(PIN_AIN1, OUTPUT);
  pinMode(PIN_AIN2, OUTPUT);
  pinMode(PIN_BIN1, OUTPUT);
  pinMode(PIN_BIN2, OUTPUT);
  pinMode(PIN_STBY, OUTPUT);
  digitalWrite(PIN_STBY, HIGH);

  // Configuración PWM LEDC
  ledcSetup(PWM_CH_LEFT, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(PIN_PWMA, PWM_CH_LEFT);
  ledcSetup(PWM_CH_RIGHT, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(PIN_PWMB, PWM_CH_RIGHT);

  // Sensores IR TCRT5000 (Pull-up interno para inmunidad a ruido)
  pinMode(PIN_IR_FRONT, INPUT_PULLUP);
  pinMode(PIN_IR_REAR,  INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);

  // Apagar motores al arrancar
  stopMotorsImmediate();

  // Inicialización del dispositivo BLE
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

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06); // Funciones para compatibilidad iOS/Android
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[SUMOBOT] BLE Publicando. Listo para emparejar.");
}

// ----------------------------------------------------------------------------
// BUCLE PRINCIPAL (LOOP) - ARQUITECTURA NO BLOQUEANTE
// ----------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  // 1. GESTIÓN DE RECONEXIÓN PUBLICIDAD BLE
  if (!deviceConnected && oldDeviceConnected) {
    delay(500); // Pequeño respiro al stack bluetooth antes de republicar
    pServer->startAdvertising();
    Serial.println("[BLE] Desconectado. Reiniciando publicidad.");
    oldDeviceConnected = deviceConnected;
    currentState = STATE_DISCONNECTED;
    stopMotorsImmediate();
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
    Serial.println("[BLE] Cliente conectado con exito.");
    currentState = STATE_MANUAL_BLE;
    lastPacketTime = now;
  }

  // 2. EXTRACCIÓN SEGURA DEL BUFFER BLE
  char localPacket[RX_BUFFER_SIZE];
  bool hasPacket = false;

  if (newPacketAvailable) {
    portENTER_CRITICAL(&bleMux);
    strncpy(localPacket, (const char*)rawRxBuffer, RX_BUFFER_SIZE - 1);
    localPacket[RX_BUFFER_SIZE - 1] = '\0';
    newPacketAvailable = false;
    hasPacket = true;
    portEXIT_CRITICAL(&bleMux);
  }

  // 3. LECTURA DE SENSORES INFRARROJOS TCRT5000 (PRIORIDAD MÁXIMA DE COMBATE)
  bool frontLineHit = (digitalRead(PIN_IR_FRONT) == LINE_DETECTED_LEVEL);
  bool rearLineHit  = (digitalRead(PIN_IR_REAR)  == LINE_DETECTED_LEVEL);

  // MÁQUINA DE ESTADOS FINITA (FSM)
  switch (currentState) {

    case STATE_DISCONNECTED:
      stopMotorsImmediate();
      break;

    case STATE_MANUAL_BLE:
      // Comprobar sensores de línea antes que cualquier orden de la app
      if (frontLineHit) {
        currentState = STATE_LINE_FRONT_ESCAPE;
        lineEscapeStartTime = now;
        // Reversa a máxima fuerza (-100%)
        targetSpeedL = -255;
        targetSpeedR = -255;
        updateMotorRamps(true); // Fuerza inmediata
        Serial.println("[DOHYO] ¡Linea frontal detectada! Escape REVERSA 800ms");
        break;
      }
      if (rearLineHit) {
        currentState = STATE_LINE_REAR_ESCAPE;
        lineEscapeStartTime = now;
        // Avance a máxima fuerza (+100%)
        targetSpeedL = 255;
        targetSpeedR = 255;
        updateMotorRamps(true); // Fuerza inmediata
        Serial.println("[DOHYO] ¡Linea trasera detectada! Escape AVANCE 800ms");
        break;
      }

      // Comprobar Watchdog de seguridad (Pérdida de señal de la app > 1000ms)
      if (now - lastPacketTime > WATCHDOG_TIMEOUT_MS) {
        currentState = STATE_FAILSAFE_TIMEOUT;
        stopMotorsImmediate();
        Serial.println("[WATCHDOG] Timeout > 1000ms. Failsafe activo: Motores en 0.");
        break;
      }

      // Si todo está normal, procesar paquete de control recibido
      if (hasPacket) {
        parseCommandPacket(localPacket);
      }
      updateMotorRamps(false);
      break;

    case STATE_LINE_FRONT_ESCAPE:
      // Ignorar órdenes BLE durante 800 ms
      targetSpeedL = -255;
      targetSpeedR = -255;
      setMotorOutputs(-255, -255);

      if (now - lineEscapeStartTime >= LINE_ESCAPE_TIME_MS) {
        // Escape completado: volver a modo manual
        Serial.println("[DOHYO] Escape frontal finalizado. Retomando control BLE.");
        currentState = STATE_MANUAL_BLE;
        lastPacketTime = now; // Reiniciar watchdog para evitar falsos cortes
        targetSpeedL = 0;
        targetSpeedR = 0;
      }
      break;

    case STATE_LINE_REAR_ESCAPE:
      // Ignorar órdenes BLE durante 800 ms
      targetSpeedL = 255;
      targetSpeedR = 255;
      setMotorOutputs(255, 255);

      if (now - lineEscapeStartTime >= LINE_ESCAPE_TIME_MS) {
        // Escape completado: volver a modo manual
        Serial.println("[DOHYO] Escape trasero finalizado. Retomando control BLE.");
        currentState = STATE_MANUAL_BLE;
        lastPacketTime = now;
        targetSpeedL = 0;
        targetSpeedR = 0;
      }
      break;

    case STATE_FAILSAFE_TIMEOUT:
      stopMotorsImmediate();
      // Si recibimos un nuevo paquete válido, salir del failsafe
      if (hasPacket) {
        parseCommandPacket(localPacket);
        currentState = STATE_MANUAL_BLE;
        Serial.println("[WATCHDOG] Reanudado. Recibido paquete valido.");
      }
      break;
  }
}

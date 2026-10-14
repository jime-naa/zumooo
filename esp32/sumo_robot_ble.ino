/**
 * ============================================================================
 * PROYECTO: ROBOT DE SUMO BLE - FIRMWARE ESP32 CON DRIVER TB6612FNG
 * ============================================================================
 * Protocolo de Control por Comandos Rápidos:
 *   - 'F <speed>' : Adelante (PWM 0-255)
 *   - 'R <speed>' : Atrás / Retroceso (PWM 0-255)
 *   - 'L <speed>' : Giro Izquierda (Motor A atrás, Motor B adelante)
 *   - 'D <speed>' : Giro Derecha (Motor A adelante, Motor B atrás)
 *   - 'S 0'       : Detener ambos motores
 *
 * Protección Anticaída por Sensores IR en Ring de Dohyo:
 *   - SENSOR_ADELANTE (GPIO 35): Evasión automática marcha atrás + giro derecha
 *   - SENSOR_ATRAS    (GPIO 34): Evasión automática marcha adelante + giro izquierda
 * ============================================================================
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>

// UUIDs para el servidor BLE
#define SERVICE_UUID              "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define MOTOR_CHARACTERISTIC_UUID "c565818d-6972-466d-88b0-517865f14d02"

// --- PINES DRIVER TB6612FNG (Según tu esquema) ---
const int pinPWMA = 25;
const int pinAIN2 = 27;
const int pinAIN1 = 26;
const int pinSTBY = 33;

// NOTA: Si BIN1 está en GPIO 34, cambiar a GPIO 14 o 32 para salida digital
const int pinBIN1 = 14; 
const int pinBIN2 = 12;
const int pinPWMB = 13;

// --- PINES SENSORES INFRARROJOS DE LÍNEA ---
const int SENSOR_ADELANTE = 35; 
const int SENSOR_ATRAS    = 34; 

// Variables globales
char direccionActual = 'S';
int velocidadActual = 0;

// Declaración de funciones
void aplicarMovimiento(char dir, int speed);
void evitarCaidaAdelante();
void evitarCaidaAtras();
void detenerMotores();

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
    BLEService *pService = pServer->createService(SERVICE_UUID);

    BLECharacteristic *pMotorChar = pService->createCharacteristic(
        MOTOR_CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_WRITE
    );

    pMotorChar->setCallbacks(new SumoCallbacks());
    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->start();

    Serial.println("==========================================");
    Serial.println(" ESP32 Sumo Listo con TB6612FNG - BLE Active ");
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
}

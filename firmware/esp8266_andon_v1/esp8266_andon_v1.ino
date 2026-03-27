#include <ESP8266WiFi.h>
#include <time.h>
#include <LittleFS.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

static const uint8_t QC_START_PIN = D5;
static const uint8_t QC_END_PIN = D6;
static const uint8_t COLOR_GOOD_PIN = D1;
static const uint8_t COLOR_REJECT_PIN = D2;
static const uint8_t CONFIG_TRIGGER_PIN = D7; 
static const uint8_t POWER = D8; 
static const unsigned long DEBOUNCE_MS = 1000;
static const unsigned long WIFI_BLINK_MS = 1;
static const unsigned long BROKER_BLINK_MS = 500;
static const uint16_t MQTT_BUFFER_SIZE = 512;
static const uint8_t MQTT_PUBLISH_RETRY_COUNT = 3;
static const char *CONFIG_FILE = "/config.json";
static const char *FW_VERSION = "1.1.0";

enum SystemState {
  STATE_WAIT_WIFI,
  STATE_WAIT_BROKER,
  STATE_RUNNING
};

WiFiClient espClient;
PubSubClient mqttClient(espClient);
WiFiManager wm;
WiFiManagerParameter *paramMqttServer;
WiFiManagerParameter *paramMqttPort;
WiFiManagerParameter *paramMqttUser;
WiFiManagerParameter *paramMqttPassword;
WiFiManagerParameter *paramMachineCode;
WiFiManagerParameter *paramStationName;
WiFiManagerParameter *paramSimulationMode;
WiFiManagerParameter *paramSimulationMin;
WiFiManagerParameter *paramSimulationMax;
WiFiManagerParameter *paramSimulationGoodRate;

SystemState systemState = STATE_WAIT_WIFI;
bool wifiReady = false;
bool configWasSubmitted = false;
bool mqttWasConnected = false;
bool lastGoodState = HIGH;
bool lastRejectState = HIGH;
bool simulationMode = false;
unsigned long lastGoodEdgeMs = 0;
unsigned long lastRejectEdgeMs = 0;
unsigned long lastReconnectAttemptMs = 0;
unsigned long lastLedToggleMs = 0;
unsigned long nextSimulationActionMs = 0;
bool ledState = HIGH;

char mqttServer[64] = "broker.emqx.io";
char mqttPort[8] = "1883";
char mqttUser[32] = "";
char mqttPassword[32] = "";
char machineCode[24] = "STATION-01";
char stationName[32] = "Print Station 01";
char simulationModeText[8] = "OFF";
char simulationMinSeconds[8] = "5";
char simulationMaxSeconds[8] = "15";
char simulationGoodRate[8] = "30";

void saveConfigCallback() {
  configWasSubmitted = true;
  Serial.println("[CFG] Configuration submitted from WiFiManager portal");
}

void setup() {
  Serial.begin(115200);
  pinMode(QC_START_PIN, INPUT_PULLUP);
  pinMode(QC_END_PIN, INPUT_PULLUP);
  pinMode(COLOR_GOOD_PIN, INPUT_PULLUP);
  pinMode(COLOR_REJECT_PIN, INPUT_PULLUP);
  pinMode(CONFIG_TRIGGER_PIN, INPUT_PULLUP);
  pinMode(POWER, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
  digitalWrite(POWER, HIGH);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.setAutoReconnect(true);
  espClient.setNoDelay(true);

  randomSeed(ESP.getChipId());

  if (!LittleFS.begin()) {
    Serial.println("LittleFS mount failed");
  }

  loadConfig();
  logActiveConfig("Loaded config from flash");
  setupWifiManager();
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);
  Serial.print("[MQTT] Buffer size set to ");
  Serial.println(MQTT_BUFFER_SIZE);
}

void loop() {

  wm.process();
  updateConnectivityState();
  updateStatusLed();

  if (wifiReady) {
    mqttClient.loop();
  }

  if (!mqttClient.connected()) {
    return;
  }

  if (simulationMode) {
    handleSimulation();
  } else {
    handleResultSensorEdges();
  }
}

void setupWifiManager() {
  wm.setSaveConfigCallback(saveConfigCallback);
  wm.setConfigPortalTimeout(180);
  wm.setConfigPortalBlocking(false);
  initWiFiManagerParameters();
  wm.addParameter(paramMqttServer);
  wm.addParameter(paramMqttPort);
  wm.addParameter(paramMqttUser);
  wm.addParameter(paramMqttPassword);
  wm.addParameter(paramMachineCode);
  wm.addParameter(paramStationName);
  wm.addParameter(paramSimulationMode);
  wm.addParameter(paramSimulationMin);
  wm.addParameter(paramSimulationMax);
  wm.addParameter(paramSimulationGoodRate);

  bool forceConfig = digitalRead(CONFIG_TRIGGER_PIN) == LOW;
  configWasSubmitted = false;
  String APName =  String(machineCode) + "-SETUP";
  if (forceConfig) {
    Serial.println("[WIFI] Starting config portal by hardware trigger");
    wm.startConfigPortal(APName.c_str());
  } else {
    Serial.println("[WIFI] Trying saved WiFi credentials / autoConnect");
    wm.autoConnect(APName.c_str());
  }
}

void updateConnectivityState() {
  if (WiFi.status() != WL_CONNECTED) {
    wifiReady = false;
    mqttWasConnected = false;
    systemState = STATE_WAIT_WIFI;
    return;
  }

  if (!wifiReady) {
    onWifiConnected();
  }

  if (!mqttClient.connected()) {
    if (mqttWasConnected) {
      Serial.println("[MQTT] Connection lost, retrying broker");
      mqttWasConnected = false;
    }
    systemState = STATE_WAIT_BROKER;
    reconnectMqtt();
    return;
  }

  if (!mqttWasConnected) {
    mqttWasConnected = true;
    Serial.println("[MQTT] Broker connected, system running");
  }

  systemState = STATE_RUNNING;
}

void onWifiConnected() {
  wifiReady = true;
  if (configWasSubmitted) {
    applyPortalConfigToRuntime();
    normalizeConfig();
    saveConfig();
    configWasSubmitted = false;
    logActiveConfig("Applied config from WiFiManager portal");
  }

  mqttClient.setServer(mqttServer, atoi(mqttPort));
  mqttClient.setKeepAlive(60);
  mqttClient.setSocketTimeout(10);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  Serial.print("[WIFI] Connected. SSID: ");;
  Serial.print(WiFi.SSID());
  Serial.print(" IP: ");;
  Serial.println(WiFi.localIP());
  logActiveConfig("Runtime config");
}

void reconnectMqtt() {
  if (millis() - lastReconnectAttemptMs < 3000) {
    return;
  }

  lastReconnectAttemptMs = millis();
  String clientId = "ESP8266-" + String(machineCode) + "-" + String(ESP.getChipId(), HEX);
  bool connected = false;
  Serial.print("[MQTT] Connecting to ");
  Serial.print(mqttServer);
  Serial.print(":");
  Serial.print(mqttPort);
  Serial.print(" with clientId ");
  Serial.println(clientId);

  if (strlen(mqttUser) > 0) {
    connected = mqttClient.connect(clientId.c_str(), mqttUser, mqttPassword);
  } else {
    connected = mqttClient.connect(clientId.c_str());
  }

  if (connected) {
    publishHeartbeat();
  } else {
    Serial.print("[MQTT] Connect failed, state=");
    Serial.println(mqttClient.state());
  }
}

void updateStatusLed() {
  unsigned long interval = 0;

  if (systemState == STATE_WAIT_WIFI) {
    interval = WIFI_BLINK_MS;
  } else if (systemState == STATE_WAIT_BROKER) {
    interval = BROKER_BLINK_MS;
  } else {
    // ESP8266 builtin LED is active-low, so HIGH means off.
    digitalWrite(LED_BUILTIN, HIGH);
    ledState = HIGH;
    return;
  }

  if (millis() - lastLedToggleMs >= interval) {
    lastLedToggleMs = millis();
    ledState = !ledState;
    digitalWrite(LED_BUILTIN, ledState);
  }
}

void handleResultSensorEdges() {
  bool goodState = digitalRead(COLOR_GOOD_PIN);
  bool rejectState = digitalRead(COLOR_REJECT_PIN);

  if (goodState == LOW && rejectState == LOW) {
    if (lastGoodState == HIGH || lastRejectState == HIGH) {
      Serial.println("[SENSOR] GOOD and REJECT active together, event ignored");
    }
    lastGoodState = goodState;
    lastRejectState = rejectState;
    return;
  }
  // Serial.print("lastGoodState : ");
  // Serial.println(lastGoodState);
  // Serial.print("goodState : ");
  // Serial.println(goodState);
  // Serial.print("lastGoodEdgeMs : ");
  // Serial.println(lastGoodEdgeMs);
  // Serial.print("DEBOUNCE_MS : ");
  // Serial.println(DEBOUNCE_MS);
  // Serial.print("lastRejectState : ");
  // Serial.println(lastRejectState);
  // Serial.print("rejectState : ");
  // Serial.println(rejectState);
  // Serial.print("lastRejectEdgeMs : ");
  // Serial.println(lastRejectEdgeMs);

  if (lastGoodState == HIGH && goodState == LOW && millis() - lastGoodEdgeMs > DEBOUNCE_MS) {
    lastGoodEdgeMs = millis();
    Serial.println("[SENSOR] GOOD triggered");
    publishQcResult("GOOD", false);
  }

  if (lastRejectState == HIGH && rejectState == LOW && millis() - lastRejectEdgeMs > DEBOUNCE_MS) {
    lastRejectEdgeMs = millis();
    Serial.println("[SENSOR] REJECT triggered");
    publishQcResult("REJECT", false);
  }

  lastGoodState = goodState;
  lastRejectState = rejectState;
}

void handleSimulation() {
  if (nextSimulationActionMs == 0) {
    nextSimulationActionMs = millis() + 1500;
    Serial.println("[SIM] Simulation armed, waiting first cycle");
    return;
  }

  if (millis() < nextSimulationActionMs) {
    return;
  }

  String result = randomResult();
  unsigned long waitSeconds = random(getSimulationMinSeconds(), getSimulationMaxSeconds() + 1);
  Serial.print("[SIM] Publish simulated result in cycle window ");
  Serial.print(waitSeconds);
  Serial.print(" second(s), result=");
  Serial.println(result);
  publishQcResult(result, true);
  nextSimulationActionMs = millis() + (waitSeconds * 1000UL);
}

String randomResult() {
  int threshold = constrain(atoi(simulationGoodRate), 0, 100);
  return random(100) < threshold ? "GOOD" : "REJECT";
}

long getSimulationMinSeconds() {
  long minValue = max(1, atoi(simulationMinSeconds));
  long maxValue = max(1, atoi(simulationMaxSeconds));
  return min(minValue, maxValue);
}

long getSimulationMaxSeconds() {
  long minValue = max(1, atoi(simulationMinSeconds));
  long maxValue = max(1, atoi(simulationMaxSeconds));
  return max(minValue, maxValue);
}

void publishQcResult(const String &result, bool simulated) {
  if (!ensureMqttReady()) {
    Serial.println("[MQTT] Skip publish qc_end because broker is not ready");
    return;
  }

  String qcRunId = String(machineCode) + "-" + String(millis());
  Serial.print("[QC] RESULT runId=");
  Serial.print(qcRunId);
  Serial.print(" result=");
  Serial.print(result);
  Serial.print(" simulated=");
  Serial.println(simulated ? "true" : "false");

  StaticJsonDocument<448> doc;
  doc["machineCode"] = machineCode;
  doc["stationName"] = stationName;
  doc["eventType"] = "qc_end";
  doc["result"] = result;
  doc["timestamp"] = isoTimestamp();
  doc["firmwareVersion"] = FW_VERSION;
  doc["wifiSsid"] = WiFi.SSID();
  doc["ipAddress"] = WiFi.localIP().toString();
  doc["qcRunId"] = qcRunId;
  doc["simulationMode"] = simulationMode;
  doc["simulatedEvent"] = simulated;

  char payload[448];
  size_t len = serializeJson(doc, payload);

  String topic = "factory/qc/" + String(machineCode) + "/event";
  Serial.print("[MQTT] Event payload length=");
  Serial.println(len);
  bool published = publishWithRetry(topic.c_str(), payload, len, false);
  Serial.print("[MQTT] Publish qc_end to ");
  Serial.print(topic);
  Serial.print(" -> ");
  Serial.println(published ? "OK" : "FAILED");
  Serial.println(payload);
}

void publishHeartbeat() {
  if (!ensureMqttReady()) {
    Serial.println("[MQTT] Skip heartbeat because broker is not ready");
    return;
  }

  StaticJsonDocument<256> doc;
  doc["machineCode"] = machineCode;
  doc["stationName"] = stationName;
  doc["ipAddress"] = WiFi.localIP().toString();
  doc["wifiSsid"] = WiFi.SSID();
  doc["firmwareVersion"] = FW_VERSION;
  doc["simulationMode"] = simulationMode;

  char payload[256];
  size_t len = serializeJson(doc, payload);
  String topic = "factory/qc/" + String(machineCode) + "/status";
  bool published = publishWithRetry(topic.c_str(), payload, len, true);
  Serial.print("[MQTT] Publish heartbeat -> ");
  Serial.println(published ? "OK" : "FAILED");
}

String isoTimestamp() {
  time_t now = time(nullptr);
  if (now < 100000) {
    return "";
  }

  struct tm *timeInfo = gmtime(&now);
  char buffer[25];
  snprintf(
    buffer,
    sizeof(buffer),
    "%04d-%02d-%02dT%02d:%02d:%02dZ",
    timeInfo->tm_year + 1900,
    timeInfo->tm_mon + 1,
    timeInfo->tm_mday,
    timeInfo->tm_hour,
    timeInfo->tm_min,
    timeInfo->tm_sec
  );
  return String(buffer);
}

void loadConfig() {
  if (!LittleFS.exists(CONFIG_FILE)) {
    return;
  }

  File file = LittleFS.open(CONFIG_FILE, "r");
  if (!file) {
    return;
  }

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    return;
  }

  copyJsonValue(doc["mqttServer"], mqttServer, sizeof(mqttServer));
  copyJsonValue(doc["mqttPort"], mqttPort, sizeof(mqttPort));
  copyJsonValue(doc["mqttUser"], mqttUser, sizeof(mqttUser));
  copyJsonValue(doc["mqttPassword"], mqttPassword, sizeof(mqttPassword));
  copyJsonValue(doc["machineCode"], machineCode, sizeof(machineCode));
  copyJsonValue(doc["stationName"], stationName, sizeof(stationName));
  copyJsonValue(doc["simulationMode"], simulationModeText, sizeof(simulationModeText));
  copyJsonValue(doc["simulationMinSeconds"], simulationMinSeconds, sizeof(simulationMinSeconds));
  copyJsonValue(doc["simulationMaxSeconds"], simulationMaxSeconds, sizeof(simulationMaxSeconds));
  copyJsonValue(doc["simulationGoodRate"], simulationGoodRate, sizeof(simulationGoodRate));
  normalizeConfig();
}

void saveConfig() {
  StaticJsonDocument<512> doc;
  doc["mqttServer"] = mqttServer;
  doc["mqttPort"] = mqttPort;
  doc["mqttUser"] = mqttUser;
  doc["mqttPassword"] = mqttPassword;
  doc["machineCode"] = machineCode;
  doc["stationName"] = stationName;
  doc["simulationMode"] = simulationModeText;
  doc["simulationMinSeconds"] = simulationMinSeconds;
  doc["simulationMaxSeconds"] = simulationMaxSeconds;
  doc["simulationGoodRate"] = simulationGoodRate;

  File file = LittleFS.open(CONFIG_FILE, "w");
  if (!file) {
    return;
  }

  serializeJson(doc, file);
  file.close();
  Serial.println("[CFG] Configuration saved to flash");
}

void normalizeConfig() {
  toUppercase(simulationModeText);
  simulationMode = strcmp(simulationModeText, "ON") == 0;

  long minSeconds = max(1, atoi(simulationMinSeconds));
  long maxSeconds = max(1, atoi(simulationMaxSeconds));
  int goodRate = constrain(atoi(simulationGoodRate), 0, 100);

  copyNumberToCharArray(minSeconds, simulationMinSeconds, sizeof(simulationMinSeconds));
  copyNumberToCharArray(maxSeconds, simulationMaxSeconds, sizeof(simulationMaxSeconds));
  copyNumberToCharArray(goodRate, simulationGoodRate, sizeof(simulationGoodRate));
}

void toUppercase(char *value) {
  for (size_t i = 0; value[i] != '\0'; i++) {
    value[i] = toupper(value[i]);
  }
}

void copyNumberToCharArray(long value, char *target, size_t targetSize) {
  char buffer[16];
  snprintf(buffer, sizeof(buffer), "%ld", value);
  copyCharArray(buffer, target, targetSize);
}

void copyJsonValue(const JsonVariantConst &value, char *target, size_t targetSize) {
  if (value.is<const char *>()) {
    copyCharArray(value.as<const char *>(), target, targetSize);
  }
}

void copyCharArray(const char *source, char *target, size_t targetSize) {
  if (targetSize == 0) {
    return;
  }

  strncpy(target, source ? source : "", targetSize - 1);
  target[targetSize - 1] = '\0';
}

void initWiFiManagerParameters() {
  paramMqttServer = new WiFiManagerParameter("mqtt_server", "MQTT Server", mqttServer, sizeof(mqttServer));
  paramMqttPort = new WiFiManagerParameter("mqtt_port", "MQTT Port", mqttPort, sizeof(mqttPort));
  paramMqttUser = new WiFiManagerParameter("mqtt_user", "MQTT Username", mqttUser, sizeof(mqttUser));
  paramMqttPassword = new WiFiManagerParameter("mqtt_password", "MQTT Password", mqttPassword, sizeof(mqttPassword));
  paramMachineCode = new WiFiManagerParameter("machine_code", "Machine Code", machineCode, sizeof(machineCode));
  paramStationName = new WiFiManagerParameter("station_name", "Station Name", stationName, sizeof(stationName));
  paramSimulationMode = new WiFiManagerParameter("simulation_mode", "Simulation Mode ON/OFF", simulationModeText, sizeof(simulationModeText));
  paramSimulationMin = new WiFiManagerParameter("simulation_min_s", "Simulation Min (s)", simulationMinSeconds, sizeof(simulationMinSeconds));
  paramSimulationMax = new WiFiManagerParameter("simulation_max_s", "Simulation Max (s)", simulationMaxSeconds, sizeof(simulationMaxSeconds));
  paramSimulationGoodRate = new WiFiManagerParameter("simulation_good_pct", "Simulation GOOD Rate %", simulationGoodRate, sizeof(simulationGoodRate));
}

void applyPortalConfigToRuntime() {
  copyCharArray(paramMqttServer->getValue(), mqttServer, sizeof(mqttServer));
  copyCharArray(paramMqttPort->getValue(), mqttPort, sizeof(mqttPort));
  copyCharArray(paramMqttUser->getValue(), mqttUser, sizeof(mqttUser));
  copyCharArray(paramMqttPassword->getValue(), mqttPassword, sizeof(mqttPassword));
  copyCharArray(paramMachineCode->getValue(), machineCode, sizeof(machineCode));
  copyCharArray(paramStationName->getValue(), stationName, sizeof(stationName));
  copyCharArray(paramSimulationMode->getValue(), simulationModeText, sizeof(simulationModeText));
  copyCharArray(paramSimulationMin->getValue(), simulationMinSeconds, sizeof(simulationMinSeconds));
  copyCharArray(paramSimulationMax->getValue(), simulationMaxSeconds, sizeof(simulationMaxSeconds));
  copyCharArray(paramSimulationGoodRate->getValue(), simulationGoodRate, sizeof(simulationGoodRate));
}

void logActiveConfig(const char *label) {
  Serial.print("[CFG] ");
  Serial.println(label);
  Serial.print("  machineCode=");
  Serial.println(machineCode);
  Serial.print("  stationName=");
  Serial.println(stationName);
  Serial.print("  broker=");
  Serial.print(mqttServer);
  Serial.print(":");
  Serial.println(mqttPort);
  Serial.print("  simulationMode=");
  Serial.println(simulationMode ? "ON" : "OFF");
  Serial.print("  simulationMinSeconds=");
  Serial.println(simulationMinSeconds);
  Serial.print("  simulationMaxSeconds=");
  Serial.println(simulationMaxSeconds);
  Serial.print("  simulationGoodRate=");
  Serial.println(simulationGoodRate);
}

bool ensureMqttReady() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[MQTT] WiFi not connected");
    return false;
  }

  if (mqttClient.connected()) {
    return true;
  }

  reconnectMqtt();
  mqttClient.loop();
  delay(100);
  mqttClient.loop();
  return mqttClient.connected();
}

bool publishWithRetry(const char *topic, const char *payload, size_t len, bool retained) {
  for (uint8_t attempt = 1; attempt <= MQTT_PUBLISH_RETRY_COUNT; attempt++) {
    if (!ensureMqttReady()) {
      Serial.print("[MQTT] Publish attempt ");
      Serial.print(attempt);
      Serial.println(" aborted because MQTT is not connected");
      delay(150);
      continue;
    }

    bool published = mqttClient.publish(topic, (const uint8_t *)payload, len, retained);
    mqttClient.loop();
    delay(50);
    mqttClient.loop();

    if (published) {
      if (attempt > 1) {
        Serial.print("[MQTT] Publish succeeded on retry ");
        Serial.println(attempt);
      }
      return true;
    }

    Serial.print("[MQTT] Publish attempt ");
    Serial.print(attempt);
    Serial.print(" failed, state=");
    Serial.println(mqttClient.state());
    delay(150);
  }

  return false;
}

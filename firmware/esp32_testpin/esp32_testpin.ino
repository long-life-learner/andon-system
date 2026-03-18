#define LED_BUILTIN 15  // LED onboard LOLIN S2 Mini

// Daftar pin input yang mau dites
int inputPins[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
int totalPins = sizeof(inputPins) / sizeof(inputPins[0]);

void setup() {
  Serial.begin(115200);
  Serial.println("Test GPIO LOLIN S2 Mini");

  // Setup LED
  pinMode(LED_BUILTIN, OUTPUT);

  // Setup input dengan pull-up
  for (int i = 0; i < totalPins; i++) {
    pinMode(inputPins[i], INPUT_PULLUP);
  }
}

void loop() {
  Serial.println("------ STATUS PIN ------");

  bool trigger = false;

  for (int i = 0; i < totalPins; i++) {
    int pin = inputPins[i];
    int state = digitalRead(pin);

    Serial.print("GPIO ");
    Serial.print(pin);
    Serial.print(" = ");

    if (state == HIGH) {
      Serial.println("HIGH");
    } else {
      Serial.println("LOW");
      trigger = true;
    }
  }

  // LED nyala jika ada pin LOW
  digitalWrite(LED_BUILTIN, trigger ? HIGH : LOW);

  delay(300); // refresh cepat
}
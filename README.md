# QC Monitoring 3D Printing

Sistem ini mencatat proses QC real-time untuk banyak stasiun produksi menggunakan:

- ESP8266 + sensor digital + sensor warna
- MQTT untuk komunikasi real-time
- Node.js untuk backend dan API
- SQLite untuk database
- Dashboard web real-time dengan Socket.IO

## Fitur

- Multi-station dengan `machineCode` unik
- `WiFiManager` pada ESP8266 agar Wi-Fi bisa diatur tanpa edit kode
- Pencatatan `qc_start` dan `qc_end`
- Hasil QC `GOOD` dan `REJECT`
- Hitung jumlah produksi, good, reject, durasi QC, dan OEE
- Dashboard real-time

## Struktur Folder

- `firmware/esp8266_qc_monitor.ino` : firmware ESP8266 untuk Arduino IDE
- `server.js` : server backend
- `src/` : MQTT, database, kalkulasi metrik
- `public/` : dashboard web

## Instalasi Backend

1. Install Node.js 18+.
2. Copy `.env.example` menjadi `.env`.
3. Sesuaikan `MQTT_URL` dan parameter lain.
4. Jalankan:

```bash
npm install
npm start
```

5. Buka `http://localhost:3000`.

## Topic MQTT

- Publish event dari ESP8266:

```text
factory/qc/{machineCode}/event
```

- Status mesin:

```text
factory/qc/{machineCode}/status
```

## Format Payload MQTT

### QC Start

```json
{
  "machineCode": "STATION-01",
  "stationName": "QC Station 01",
  "eventType": "qc_start",
  "timestamp": "2026-03-15T08:10:00Z",
  "firmwareVersion": "1.0.0"
}
```

### QC End

```json
{
  "machineCode": "STATION-01",
  "stationName": "QC Station 01",
  "eventType": "qc_end",
  "result": "GOOD",
  "timestamp": "2026-03-15T08:10:25Z",
  "firmwareVersion": "1.0.0"
}
```

## Perhitungan

- `Production Count` = jumlah event `qc_end`
- `Good Count` = jumlah `qc_end` dengan `result = GOOD`
- `Reject Count` = jumlah `qc_end` dengan `result = REJECT`
- `QC Duration` = selisih `qc_end` dengan `qc_start` terakhir pada mesin yang sama
- `Availability` = total waktu QC / planned runtime
- `Performance` = (ideal cycle time x total produksi) / total waktu QC
- `Quality` = good / total produksi
- `OEE` = Availability x Performance x Quality

## Konfigurasi ESP8266

Saat pertama kali menyala, atau saat pin `D3` ditahan ke GND saat boot, modul membuka portal `QC-MONITOR-SETUP`.

Isi parameter:

- Wi-Fi SSID dan password
- MQTT server
- MQTT port
- MQTT username/password jika ada
- `Machine Code`
- `Station Name`
- `Simulation Mode ON/OFF`
- `Simulation Min QC (s)`
- `Simulation Max QC (s)`
- `Simulation GOOD Rate %`

Jika `Simulation Mode` diatur ke `ON`, ESP8266 akan mengirim event `qc_start` dan `qc_end` otomatis walaupun tombol dan sensor belum terhubung.
Nilai simulasi akan tetap tersimpan setelah restart.

## Monitoring Serial

Buka Serial Monitor `115200 baud` untuk melihat:

- status koneksi Wi-Fi
- status koneksi MQTT broker
- konfigurasi aktif yang dimuat dari flash
- event `qc_start` dan `qc_end` yang dipublish
- hasil simulasi GOOD atau REJECT

Catatan: firmware sudah menaikkan buffer `PubSubClient` agar payload MQTT yang berisi metadata seperti SSID, IP address, dan `qcRunId` tetap bisa terkirim.

## Mapping Pin ESP8266

- `D5` : sensor digital mulai QC
- `D6` : sensor digital selesai QC
- `D1` : sensor warna GOOD
- `D2` : sensor warna REJECT
- `D3` : trigger mode konfigurasi

## Catatan

- Broker MQTT tidak dibundel dalam proyek ini. Anda bisa gunakan Mosquitto lokal atau broker cloud.
- Database default memakai SQLite agar mudah dicoba. Jika nanti perlu skala lebih besar, backend ini bisa dipindah ke MySQL/PostgreSQL.

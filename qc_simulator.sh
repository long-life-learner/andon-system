#!/bin/bash

BROKER="broker.emqx.io"
PORT=1883

STATIONS=("STATION-05" "STATION-06" "STATION-07")

while true
do
  for ST in "${STATIONS[@]}"
  do
    TOPIC="factory/qc/$ST/event"
    ST_NAME="QC Station ${ST##*-}"

    START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    echo "QC START $ST -> $TOPIC"

    mqtt pub -h $BROKER -p $PORT -t $TOPIC -m "{
      \"machineCode\": \"$ST\",
      \"stationName\": \"$ST_NAME\",
      \"eventType\": \"qc_start\",
      \"timestamp\": \"$START_TIME\",
      \"firmwareVersion\": \"1.0.0\"
    }"

    sleep $((RANDOM % 5 + 5))

    RESULT="GOOD"
    if [ $((RANDOM % 5)) -eq 0 ]; then
      RESULT="REJECT"
    fi

    END_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    echo "QC END $ST RESULT=$RESULT -> $TOPIC"

    mqtt pub -h $BROKER -p $PORT -t $TOPIC -m "{
      \"machineCode\": \"$ST\",
      \"stationName\": \"$ST_NAME\",
      \"eventType\": \"qc_end\",
      \"result\": \"$RESULT\",
      \"timestamp\": \"$END_TIME\",
      \"firmwareVersion\": \"1.0.0\"
    }"

    sleep 2
  done
done
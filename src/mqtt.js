const mqtt = require("mqtt");

require("dotenv").config();

function connectMqtt(onMessage) {
  const client = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined
  });

  client.on("connect", () => {
    const topic = process.env.MQTT_TOPIC_SUBSCRIBE || "factory/qc/+/event";
    client.subscribe(topic, (error) => {
      if (error) {
        console.error("MQTT subscribe error:", error.message);
        return;
      }
      console.log(`Subscribed MQTT topic: ${topic}`);
    });
  });

  client.on("message", (topic, messageBuffer) => {
    try {
      const payload = JSON.parse(messageBuffer.toString());
      onMessage(payload, topic);
    } catch (error) {
      console.error("Failed to parse MQTT payload:", error.message);
    }
  });

  client.on("error", (error) => {
    console.error("MQTT connection error:", error.message);
  });

  return client;
}

module.exports = {
  connectMqtt
};

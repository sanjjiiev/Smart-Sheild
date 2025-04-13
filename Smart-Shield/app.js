const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const express = require("express");
const cors = require("cors");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Change "COM9" to match your Arduino's port
const serialPort = new SerialPort({ path: "COM9", baudRate: 9600 });
const parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

let receivedData = "";

// Read serial data from Arduino
parser.on("data", (data) => {
  console.log("Received from Arduino:", data.trim());
  receivedData = data.trim();
});

// API endpoint for frontend
app.get("/data", (req, res) => {
  res.json({ message: receivedData });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

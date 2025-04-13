const express = require("express");
const nodemailer = require("nodemailer");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const { createConnection } = require("./sqlconnect");
const mysql = require("mysql2/promise");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("front_end"));
app.use(cors());
app.use(bodyParser.json());

const con = createConnection();

// **🔍 Calculate Distance Using Haversine Formula**
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

// **🚑 Get Nearest Ambulance**
async function getNearestAmbulance(acc_lat, acc_lng) {
  try {
    const [ambulanceRows] = await con.promise().query(
      "SELECT Vehicle_No, email, amb_lat, amb_lng FROM ambulance"
    );

    let nearestAmbulance = null;
    let minDistance = Infinity;

    ambulanceRows.forEach((ambulance) => {
      const distance = calculateDistance(acc_lat, acc_lng, ambulance.amb_lat, ambulance.amb_lng);
      if (distance < minDistance) {
        minDistance = distance;
        nearestAmbulance = ambulance;
      }
    });

    return nearestAmbulance;
  } catch (error) {
    console.error("❌ Error fetching ambulances:", error);
    return null;
  }
}

// **🏥 Get Nearest Hospital**
async function getNearestHospital(acc_lat, acc_lng) {
  try {
    const hospitalData = fs.readFileSync("./hospitals.json", "utf8");
    const hospitals = JSON.parse(hospitalData);

    let nearestHospital = null;
    let minDistance = Infinity;

    hospitals.forEach((hospital) => {
      if (!hospital.location || !hospital.location.latitude || !hospital.location.longitude) {
        console.error(`⚠️ Missing latitude/longitude for hospital: ${hospital.name}`);
        return;
      }

      const distance = calculateDistance(acc_lat, acc_lng, hospital.location.latitude, hospital.location.longitude);
      if (distance < minDistance) {
        minDistance = distance;
        nearestHospital = hospital;
      }
    });

    return nearestHospital;
  } catch (error) {
    console.error("❌ Error fetching hospitals:", error);
    return null;
  }
}

// **📡 Setup Serial Communication**
const serialPort = new SerialPort({ path: "COM9", baudRate: 9600 }, (err) => {
  if (err) {
    console.error("⚠️ Error opening serial port:", err.message);
  } else {
    console.log("✅ Serial port opened successfully.");
  }
});
const parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

// **📥 Read Data from Arduino**
parser.on("data", async (data) => {
  data = data.trim().replace("Received: ", "").trim();

  const parts = data.split(",");
  if (parts.length !== 3) return console.error("⚠️ Invalid data format from Arduino:", data);

  const [acc_lat, acc_lng, acc_vehicle_num] = parts.map((x) => x.trim());

  try {
    const nearestAmbulance = await getNearestAmbulance(acc_lat, acc_lng);
    if (!nearestAmbulance) return console.error("❌ No ambulances found.");

    const nearestHospital = await getNearestHospital(acc_lat, acc_lng);
    if (!nearestHospital) return console.error("❌ No hospitals found.");

    const googleMapsRouteLink = `https://www.google.com/maps/dir/?api=1&origin=${nearestAmbulance.amb_lat},${nearestAmbulance.amb_lng}&destination=${nearestHospital.location.latitude},${nearestHospital.location.longitude}&waypoints=${acc_lat},${acc_lng}&travelmode=driving`;

    console.log("📌 Generated Route:", googleMapsRouteLink);

    // **🚨 Save Accident Details**
    try {
      await axios.post("http://localhost:3000/submit-accident", {
        acc_vehicle_num,
        amb_vehicle_num: nearestAmbulance.Vehicle_No,
        acc_loc: `${acc_lat},${acc_lng}`,
        hospital_loc: `${nearestHospital.location.latitude},${nearestHospital.location.longitude}`
      });

      console.log("✅ Accident data successfully sent to database.");
    } catch (error) {
      console.error("❌ Error sending accident data:", error.response ? error.response.data : error.message);
    }

    sendAccidentEmail(acc_vehicle_num, nearestAmbulance.Vehicle_No, googleMapsRouteLink);
  } catch (error) {
    console.error("❌ Error processing accident:", error.message);
  }
});

// **📨 Send Email Function**
async function sendAccidentEmail(acc_vehicle_num, amb_vehicle_num, googleMapsRouteLink) {
  try {
    const [ownerInfo] = await con.promise().query(
      "SELECT owner_mail_id, emergency_email1, emergency_email2 FROM RC WHERE Vehicle_NO = ?",
      [acc_vehicle_num]
    );

    if (!ownerInfo.length) {
      console.warn("⚠️ No owner information found for vehicle:", acc_vehicle_num);
      return;
    }

    const emails = [ownerInfo[0].owner_mail_id, ownerInfo[0].emergency_email1, ownerInfo[0].emergency_email2].filter(Boolean);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: emails,
      subject: "🚑 Emergency Accident Alert",
      html: `<p>🚨 An accident has been detected.</p>
             <p><strong>Accident Vehicle:</strong> ${acc_vehicle_num}</p>
             <p><strong>Ambulance Assigned:</strong> ${amb_vehicle_num}</p>
             <p>📌 Click below to view the route:</p>
             <a href="${googleMapsRouteLink}">${googleMapsRouteLink}</a>`
    };

    await transporter.sendMail(mailOptions);
    console.log("✅ Accident email sent successfully!");
  } catch (error) {
    console.error("❌ Error sending email:", error);
  }
}

// **📝 API Route to Save Accident Data**
app.post("/submit-accident", async (req, res) => {
  try {
    const { acc_vehicle_num, amb_vehicle_num, acc_loc, hospital_loc } = req.body;

    const sql = `
      INSERT INTO accident (acc_vehicle_num, amb_vehicle_num, acc_loc, hospital_loc, acc_date, acc_time)
      VALUES (?, ?, ?, ?, CURDATE(), CURTIME())
    `;
    await con.promise().query(sql, [acc_vehicle_num, amb_vehicle_num, acc_loc, hospital_loc]);

    res.status(200).json({ message: "Accident report saved successfully!" });
  } catch (error) {
    console.error("❌ Error saving accident report:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// **🌍 Start Server**
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

// **🔍 Fetch Pending Accident Zones for Map**
async function getAccidentZones() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: process.env.DB_PASS,
    database: "uyir",
  });
  try {
    const [rows] = await connection.execute(`
      SELECT accident_id, acc_loc FROM accident WHERE status = 'pending'
    `);

    return rows.map(row => {
      const [latitude, longitude] = row.acc_loc.split(",");
      return {
        accident_id: row.accident_id,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      };
    });
  } catch (err) {
    console.error("❌ Error retrieving accident zones:", err);
    throw err;
  } finally {
    await connection.end();
  }
}

// **API Endpoint to Show Pending Accident Zones on the Map**
app.get("/accidents", async (req, res) => {
  try {
    const accidents = await getAccidentZones();
    res.json(accidents);
  } catch (err) {
    res.status(500).json({ error: "Error fetching accident zones" });
  }
});

// **API Endpoint for Dashboard to Fetch Pending Accidents**
app.get("/api/accidents", async (req, res) => {
  try {
    const connection = await mysql.createConnection({
      host: "localhost",
      user: "root",
      password: process.env.DB_PASS,
      database: "uyir"
    });

    const [rows] = await connection.execute(`
      SELECT accident_id, acc_vehicle_num, amb_vehicle_num, status, acc_loc, hospital_loc, acc_date, acc_time
      FROM accident
      WHERE status = 'pending'
    `);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching accident data:", err);
    res.status(500).json({ error: "Error fetching accident data" });
  }
});
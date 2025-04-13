const mysql = require("mysql2/promise");
require("dotenv").config();

async function initializeDatabase() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: process.env.DB_PASS,
  });

  try {
    console.log("Connected to MySQL. Initializing database...");

    // Create Database if not exists
    await connection.query("CREATE DATABASE IF NOT EXISTS uyir");
    await connection.query("USE uyir");

    // Create Registered Vehicles Table
    await connection.query(`CREATE TABLE IF NOT EXISTS RC (
      Vehicle_NO VARCHAR(255) PRIMARY KEY,
      Owner_Name VARCHAR(100),
      owner_mail_id VARCHAR(100),
      emergency_email1 VARCHAR(100),
      emergency_email2 VARCHAR(100),
      emergency_Contact3 VARCHAR(100)
    );`);

    // Create Ambulance Details Table
    await connection.query(`CREATE TABLE IF NOT EXISTS ambulance (
      Vehicle_No VARCHAR(100) PRIMARY KEY,
      email VARCHAR(100),
      amb_lat  decimal(10,6),
      amb_lng decimal(10,6)
    );`);

    // Create Accident Table with Foreign Keys
    await connection.query(`CREATE TABLE IF NOT EXISTS accident (
    accident_id INT PRIMARY KEY AUTO_INCREMENT,
    acc_vehicle_num VARCHAR(255),
    amb_vehicle_num VARCHAR(100),
    acc_loc VARCHAR(100),
    hospital_loc VARCHAR(100),
    status VARCHAR(100) DEFAULT 'pending',
    acc_date date,
    acc_time time,
    FOREIGN KEY (acc_vehicle_num) REFERENCES RC(Vehicle_NO) ON DELETE SET NULL,
    FOREIGN KEY (amb_vehicle_num) REFERENCES ambulance(Vehicle_No) ON DELETE SET NULL
);`);

    console.log("Database initialized successfully!");
  } catch (err) {
    console.error("Error initializing database:", err);
  } finally {
    await connection.end();
  }
}

initializeDatabase();

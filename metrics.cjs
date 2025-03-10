const express = require("express");
const client = require("prom-client");
const cors = require("cors");

const app = express();
const register = new client.Registry();

app.use(cors()); // Allow cross-origin requests

// Create a Counter metric for website visits
const visitCounter = new client.Counter({
  name: "website_visits_total",
  help: "Total number of visits to the website",
});
register.registerMetric(visitCounter);

// Expose metrics at /metrics
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Track visits when hitting this API
app.get("/track-visit", (req, res) => {
  visitCounter.inc(); // Increment counter
  res.send("Visit tracked");
});

// Start the server on port 9000
const PORT = 9000;
app.listen(PORT, () => {
  console.log(`Metrics server running on http://localhost:${PORT}/metrics`);
});

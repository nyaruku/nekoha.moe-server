const express = require('express');
const client = require('prom-client');

const app = express();
const port = 7270;

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add default metrics to the registry
client.collectDefaultMetrics({ register });

// Custom metric - Counter
const requestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'endpoint']
});

// Increment the counter on each request
app.use((req, res, next) => {
  requestCounter.inc({ method: req.method, endpoint: req.url });
  next();
});

// Expose /metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(port, () => {
  console.log(`Node.js app listening on http://localhost:${port}`);
});
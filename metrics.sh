#!/bin/bash

echo "Checking for existing metrics instances..."
pkill -f "node metrics.cjs"

while true; do
    echo "Starting Metrics..."
    node metrics.cjs
    echo "Metrics crashed. Restarting..."
    sleep 1
done

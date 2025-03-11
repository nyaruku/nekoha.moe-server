#!/bin/bash

echo "Checking for existing logger instances..."
pkill -f "node logger.cjs"

while true; do
    echo "Starting Logger...."
    node logger.cjs
    echo "Logger crashed. Restarting..."
    sleep 1
done
#StandardOutput=append:/var/log/logger.log
#StandardError=append:/var/log/logger.log

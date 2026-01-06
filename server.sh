#!/bin/bash

# Kill any existing instance of server.js
echo "Checking for existing server instances..."
pkill -f "node server.js"

while true; do
    echo "Starting Server...."
    node server.js
    echo "Server crashed. Restarting..."
    sleep 1
done
#StandardOutput=append:/var/log/server.log
#StandardError=append:/var/log/server.log

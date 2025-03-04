#!/bin/bash

# Kill any existing instance of server.cjs
echo "Checking for existing server instances..."
pkill -f "node server.cjs"

while true; do
    echo "Starting Server...."
    node server.cjs
    echo "Server crashed. Restarting..."
    sleep 1
done

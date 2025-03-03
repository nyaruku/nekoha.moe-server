#!/bin/bash
while true; do
    echo "Starting Server...."
    node server.cjs
    echo "Script crashed. Restarting in 5 seconds..."
    sleep 5
done

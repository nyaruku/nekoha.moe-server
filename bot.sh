#!/bin/bash

echo "Checking for existing bot instances..."
pkill -f "node bot.cjs"

while true; do
    echo "Starting Bot..."
    node  bot.cjs
    echo "Bot crashed. Restarting..."
    sleep 1
done
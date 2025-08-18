#!/bin/bash

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load the .env file from the same directory
set -a
source "$SCRIPT_DIR/secret.env"
set +a
mysql -u root -p"$DB_PW" "$DB_NAME_LOGGER" < "$SCRIPT_DIR/purge-cache.sql"

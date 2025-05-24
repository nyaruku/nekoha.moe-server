#!/bin/bash

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load environment variables
set -a
source "$SCRIPT_DIR/.env"
set +a

# Run the SQL
mysql -u root -p"$DB_PW" "$DB_NAME_LOGGER" < "$SCRIPT_DIR/import.sql"

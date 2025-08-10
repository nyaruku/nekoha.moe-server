#!/bin/bash

echo "Updating word cache..."
node /home/admin/nekoha.moe/server/sql/update_word_cache.js
echo "Done clearing cache"
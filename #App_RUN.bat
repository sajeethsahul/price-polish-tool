#!/bin/bash

echo "Starting PostgreSQL..."
/c/pgsql/bin/pg_ctl -D "C:\pgsql\data" start

echo "Navigating to project directory..."
cd /e/Shopify/price-polish-tool

# Spawns an interactive bash shell in the current window
exec bash -i
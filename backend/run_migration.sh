#!/bin/bash
# Migration script to add currency field to transactions table

echo "Running migration: Add currency field to transactions table"

# Extract database connection details from .env
source .env

# Run the migration SQL
psql "$DATABASE_URL" -f migrations/add_currency_to_transactions.sql

if [ $? -eq 0 ]; then
    echo "Migration completed successfully!"
else
    echo "Migration failed!"
    exit 1
fi

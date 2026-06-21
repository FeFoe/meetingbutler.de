#!/bin/sh
set -e
echo "Running database migrations..."
node /app/node_modules/.bin/prisma migrate deploy
echo "Starting Meetingbutler..."
exec "$@"

#!/bin/bash
# Local macOS development startup script for Meetingbutler
set -e

echo "=== Meetingbutler Local Dev Startup ==="

# Check prerequisites
command -v node >/dev/null || { echo "ERROR: Node.js not found"; exit 1; }
command -v psql >/dev/null || { echo "ERROR: PostgreSQL not found"; exit 1; }
redis-cli ping >/dev/null 2>&1 || { echo "ERROR: Redis not running (brew services start redis)"; exit 1; }

# Check .env
[ -f .env ] || { echo "ERROR: .env file not found"; exit 1; }

# Install deps if needed
[ -d node_modules ] || npm install

# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Kill existing app if running
pkill -f "node dist/main" 2>/dev/null || true
sleep 1

# Build and start
npm run build
node dist/main.js &
APP_PID=$!
echo "App started (PID: $APP_PID)"

# Wait for health
echo -n "Waiting for health check..."
for i in $(seq 1 15); do
  sleep 1
  if curl -s http://localhost:3000/api/admin/health >/dev/null 2>&1; then
    echo " OK"
    echo ""
    echo "=== Running ==="
    curl -s http://localhost:3000/api/admin/health | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d));"
    echo ""
    echo "API endpoints:"
    echo "  GET http://localhost:3000/api/admin/health"
    echo "  GET http://localhost:3000/api/events"
    echo "  GET http://localhost:3000/api/events/:id"
    echo "  GET http://localhost:3000/api/admin/raw-emails"
    echo "  GET http://localhost:3000/api/admin/queues"
    echo ""
    echo "Run tests: node scripts/test-pipeline-mock.js"
    echo "Logs: tail -f /tmp/meetingbutler.log"
    exit 0
  fi
  echo -n "."
done
echo " TIMEOUT"
exit 1

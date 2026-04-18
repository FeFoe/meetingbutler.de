#!/bin/bash
set -e

SERVER="root@188.245.90.16"
APP_DIR="/opt/meetingbutler.de"
REPO="https://github.com/FeFoe/meetingbutler.de.git"

echo "==> Pushing to GitHub..."
git push origin main

echo "==> Deploying to server..."
ssh -o StrictHostKeyChecking=no "$SERVER" "
  set -e
  cd $APP_DIR
  echo '  -> Pulling latest code...'
  git pull origin main
  echo '  -> Building Docker image...'
  docker build -t meetingbutler:latest .
  echo '  -> Starting services...'
  docker compose up -d --remove-orphans --force-recreate
  echo '  -> Waiting for app to be healthy...'
  sleep 5
  docker compose ps
"

echo ""
echo "Deployed! https://meetingbutler.de"

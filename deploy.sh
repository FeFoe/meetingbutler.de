#!/bin/bash
set -e

echo "==> Pushing to GitHub..."
git push origin main
echo ""
echo "Deploy läuft via GitHub Actions. Status: https://github.com/FeFoe/meetingbutler.de/actions"

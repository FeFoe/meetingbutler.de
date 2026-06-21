#!/bin/bash
set -e

TAG=${1:?Usage: ./deploy.sh v1.2.3}

echo "==> Tagging release ${TAG}..."
git tag "${TAG}"
git push origin "${TAG}"
echo ""
echo "Release ${TAG} läuft via GitHub Actions. Status: https://github.com/FeFoe/meetingbutler.de/actions"
echo "Watchtower zieht das neue Image automatisch innerhalb von 5 Minuten."

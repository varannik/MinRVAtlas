#!/bin/bash
echo ""
echo "╔══════════════════════════════════════╗"
echo "║   DataSentinel v3.2 — Starting up   ║"
echo "╚══════════════════════════════════════╝"
echo ""

cd "$(dirname "$0")"

# Quality service only (no UI container).
SERVICES="postgres redis backend worker beat"

echo "Building with cached images (no internet required)..."
if docker compose build --pull=false $SERVICES 2>/dev/null; then
    echo "Build complete."
else
    echo "Attempting standard build..."
    docker compose build $SERVICES
fi

echo ""
echo "Starting API + worker + beat..."
docker compose up -d $SERVICES

echo ""
echo "Waiting for backend..."
echo "(This takes about 15-20 seconds)"
echo ""

for i in $(seq 1 30); do
    sleep 2
    if docker logs ds_backend 2>&1 | grep -q "Application startup complete"; then
        echo ""
        echo "╔══════════════════════════════════════╗"
        echo "║   Data Sentinel API is ready         ║"
        echo "╠══════════════════════════════════════╣"
        echo "║                                      ║"
        echo "║   API:      http://localhost:8000    ║"
        echo "║   Quality:  3DMinRV /quality         ║"
        echo "║             (npm run dev in repo)    ║"
        echo "║                                      ║"
        echo "║   Stop: docker compose down          ║"
        echo "╚══════════════════════════════════════╝"
        echo ""
        exit 0
    fi
    printf "."
done

echo ""
echo "Still starting... check: docker compose logs backend"

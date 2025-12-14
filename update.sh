#!/bin/bash
cd /opt/nexus
echo "Pulling latest images..."
docker compose pull
echo "Rebuilding API..."
docker compose build api
echo "Restarting..."
docker compose up -d
docker image prune -f
echo "Update complete!"

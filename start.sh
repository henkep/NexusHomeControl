#!/bin/bash
cd /opt/nexus
docker compose up -d
echo "NEXUS started at http://$(hostname -I | awk '{print $1}')"
docker compose ps

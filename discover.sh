#!/bin/bash
cd /opt/nexus
docker compose exec api node discovery.js --all --json

#!/bin/bash
cd /opt/nexus
docker compose logs -f "${1:-}"

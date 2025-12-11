#!/bin/bash

#===============================================================================
# NEXUS First-Boot Setup Script
# 
# This script runs automatically on first boot when configured in Pi Imager.
# It installs Docker, downloads NEXUS, and starts all services.
#
# After boot, access: http://nexus.local/setup
#===============================================================================

set -e

# Log everything to a file for debugging
exec > >(tee -a /var/log/nexus-firstboot.log) 2>&1
echo "=== NEXUS First-Boot Setup Started: $(date) ==="

# Wait for network
echo "Waiting for network..."
for i in {1..30}; do
    if ping -c 1 google.com &> /dev/null; then
        echo "Network is up!"
        break
    fi
    sleep 2
done

#-------------------------------------------------------------------------------
# Update system
#-------------------------------------------------------------------------------
echo "Updating system packages..."
apt-get update
apt-get upgrade -y

#-------------------------------------------------------------------------------
# Install Docker
#-------------------------------------------------------------------------------
echo "Installing Docker..."
curl -fsSL https://get.docker.com | sh
usermod -aG docker pi
systemctl enable docker
systemctl start docker

# Wait for Docker to be ready
sleep 5

#-------------------------------------------------------------------------------
# Create NEXUS directory
#-------------------------------------------------------------------------------
echo "Creating NEXUS directory..."
NEXUS_DIR="/opt/nexus"
mkdir -p ${NEXUS_DIR}

#-------------------------------------------------------------------------------
# Download NEXUS files from GitHub
#-------------------------------------------------------------------------------
echo "Downloading NEXUS files..."
REPO_URL="https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5"

# Create directories
mkdir -p ${NEXUS_DIR}/{api,nginx,setup-wizard,dashboard,data,ssl,cloudflared}

# Download all files
curl -fsSL "${REPO_URL}/docker-compose.yml" -o ${NEXUS_DIR}/docker-compose.yml
curl -fsSL "${REPO_URL}/install.sh" -o ${NEXUS_DIR}/install.sh
curl -fsSL "${REPO_URL}/setup-tunnel.sh" -o ${NEXUS_DIR}/setup-tunnel.sh

# API files
curl -fsSL "${REPO_URL}/api/server.js" -o ${NEXUS_DIR}/api/server.js
curl -fsSL "${REPO_URL}/api/discovery.js" -o ${NEXUS_DIR}/api/discovery.js
curl -fsSL "${REPO_URL}/api/package.json" -o ${NEXUS_DIR}/api/package.json
curl -fsSL "${REPO_URL}/api/Dockerfile" -o ${NEXUS_DIR}/api/Dockerfile

# Nginx config
curl -fsSL "${REPO_URL}/nginx/nexus.conf" -o ${NEXUS_DIR}/nginx/nexus.conf

# Setup wizard
curl -fsSL "${REPO_URL}/setup-wizard/index.html" -o ${NEXUS_DIR}/setup-wizard/index.html

# Dashboard
curl -fsSL "${REPO_URL}/dashboard/index.html" -o ${NEXUS_DIR}/dashboard/index.html
curl -fsSL "${REPO_URL}/dashboard/favicon.svg" -o ${NEXUS_DIR}/dashboard/favicon.svg 2>/dev/null || true

echo "Files downloaded successfully!"

#-------------------------------------------------------------------------------
# Create environment file
#-------------------------------------------------------------------------------
echo "Creating environment file..."
cat > ${NEXUS_DIR}/.env << 'EOF'
# NEXUS Configuration
# Visit http://nexus.local/setup to configure
TCC_USERNAME=
TCC_PASSWORD=
RING_REFRESH_TOKEN=
SHELLY_AUTH_KEY=
EOF
chmod 600 ${NEXUS_DIR}/.env

#-------------------------------------------------------------------------------
# Create management scripts
#-------------------------------------------------------------------------------
echo "Creating management scripts..."

cat > ${NEXUS_DIR}/start.sh << 'SCRIPT'
#!/bin/bash
cd /opt/nexus
docker compose up -d
echo "NEXUS started at http://$(hostname -I | awk '{print $1}')"
SCRIPT

cat > ${NEXUS_DIR}/stop.sh << 'SCRIPT'
#!/bin/bash
cd /opt/nexus
docker compose down
SCRIPT

cat > ${NEXUS_DIR}/restart.sh << 'SCRIPT'
#!/bin/bash
cd /opt/nexus
docker compose restart
SCRIPT

cat > ${NEXUS_DIR}/logs.sh << 'SCRIPT'
#!/bin/bash
cd /opt/nexus
docker compose logs -f
SCRIPT

cat > ${NEXUS_DIR}/update.sh << 'SCRIPT'
#!/bin/bash
cd /opt/nexus
docker compose pull
docker compose build api
docker compose up -d
docker image prune -f
SCRIPT

chmod +x ${NEXUS_DIR}/*.sh

#-------------------------------------------------------------------------------
# Create systemd service
#-------------------------------------------------------------------------------
echo "Creating systemd service..."
cat > /etc/systemd/system/nexus.service << EOF
[Unit]
Description=NEXUS Smart Home Dashboard
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${NEXUS_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nexus.service

#-------------------------------------------------------------------------------
# Build and start NEXUS
#-------------------------------------------------------------------------------
echo "Building NEXUS containers (this may take 5-10 minutes)..."
cd ${NEXUS_DIR}
docker compose build

echo "Starting NEXUS..."
docker compose up -d

#-------------------------------------------------------------------------------
# Create welcome message
#-------------------------------------------------------------------------------
cat > /etc/motd << 'EOF'

 _   _  _______  ___   _  _____
| \ | ||  ___\ \/ / | | |/  ___|
|  \| || |__  \  /| | | |\ `--.
| . ` ||  __| /  \| | | | `--. \
| |\  || |___/ /\ \ |_| |/\__/ /
\_| \_/\____/\_| \/\___/\____/

Smart Home Dashboard - Ready!

Dashboard:     http://nexus.local
Setup Wizard:  http://nexus.local/setup

Commands:
  /opt/nexus/start.sh    - Start services
  /opt/nexus/stop.sh     - Stop services
  /opt/nexus/logs.sh     - View logs
  /opt/nexus/update.sh   - Update NEXUS

EOF

#-------------------------------------------------------------------------------
# Cleanup and finish
#-------------------------------------------------------------------------------
echo ""
echo "=== NEXUS First-Boot Setup Complete: $(date) ==="
echo ""
echo "Access your dashboard at: http://nexus.local/setup"
echo ""

# Remove this script from running again
rm -f /boot/firstrun.sh 2>/dev/null || true
rm -f /boot/firmware/firstrun.sh 2>/dev/null || true

exit 0

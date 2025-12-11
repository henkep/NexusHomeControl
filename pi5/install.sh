#!/bin/bash

#===============================================================================
# NEXUS Quick Start - Raspberry Pi 5 Installation
# 
# One command to install everything:
#   curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/install.sh | sudo bash
#
# Or run locally:
#   sudo ./install.sh
#===============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

NEXUS_DIR="/opt/nexus"

echo -e "${CYAN}"
cat << "EOF"
    _   _________  ____  _______
   / | / / ____/ |/ / / / / ___/
  /  |/ / __/  |   / / / /\__ \ 
 / /|  / /___ /   / /_/ /___/ / 
/_/ |_/_____//_/|_\____//____/  
                                
Smart Home Dashboard - Pi 5 Installer
EOF
echo -e "${NC}"

#-------------------------------------------------------------------------------
# Check requirements
#-------------------------------------------------------------------------------
echo -e "${YELLOW}Checking requirements...${NC}"

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root: sudo ./install.sh${NC}"
    exit 1
fi

# Check architecture
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" && "$ARCH" != "armv7l" ]]; then
    echo -e "${YELLOW}Warning: This script is optimized for Raspberry Pi (ARM). Detected: $ARCH${NC}"
fi

echo -e "${GREEN}✓ Requirements OK${NC}"

#-------------------------------------------------------------------------------
# Update system
#-------------------------------------------------------------------------------
echo -e "\n${YELLOW}Updating system packages...${NC}"
apt-get update -qq
apt-get upgrade -y -qq

#-------------------------------------------------------------------------------
# Install Docker
#-------------------------------------------------------------------------------
echo -e "\n${YELLOW}Installing Docker...${NC}"

if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker pi 2>/dev/null || true
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}✓ Docker installed${NC}"
else
    echo -e "${GREEN}✓ Docker already installed${NC}"
fi

# Install Docker Compose plugin
if ! docker compose version &> /dev/null; then
    apt-get install -y docker-compose-plugin
    echo -e "${GREEN}✓ Docker Compose installed${NC}"
else
    echo -e "${GREEN}✓ Docker Compose already installed${NC}"
fi

#-------------------------------------------------------------------------------
# Create directory structure
#-------------------------------------------------------------------------------
echo -e "\n${YELLOW}Creating NEXUS directories...${NC}"

mkdir -p ${NEXUS_DIR}/{api,nginx,dashboard,setup-wizard,data,ssl,cloudflared}

#-------------------------------------------------------------------------------
# Download NEXUS files
#-------------------------------------------------------------------------------
echo -e "\n${YELLOW}Downloading NEXUS files...${NC}"

REPO_URL="https://raw.githubusercontent.com/henkep/NexusHomeControl/main"

# Download docker-compose
curl -fsSL "${REPO_URL}/pi5/docker-compose.yml" -o ${NEXUS_DIR}/docker-compose.yml

# Download API files
curl -fsSL "${REPO_URL}/pi5/api/server.js" -o ${NEXUS_DIR}/api/server.js
curl -fsSL "${REPO_URL}/pi5/api/discovery.js" -o ${NEXUS_DIR}/api/discovery.js
curl -fsSL "${REPO_URL}/pi5/api/package.json" -o ${NEXUS_DIR}/api/package.json
curl -fsSL "${REPO_URL}/pi5/api/Dockerfile" -o ${NEXUS_DIR}/api/Dockerfile

# Download nginx config
curl -fsSL "${REPO_URL}/pi5/nginx/nexus.conf" -o ${NEXUS_DIR}/nginx/nexus.conf

# Download setup wizard
curl -fsSL "${REPO_URL}/pi5/setup-wizard/index.html" -o ${NEXUS_DIR}/setup-wizard/index.html

# Download dashboard (if available)
curl -fsSL "${REPO_URL}/frontend/index.html" -o ${NEXUS_DIR}/dashboard/index.html 2>/dev/null || echo "Dashboard will be configured via setup wizard"
curl -fsSL "${REPO_URL}/frontend/favicon.svg" -o ${NEXUS_DIR}/dashboard/favicon.svg 2>/dev/null || true

echo -e "${GREEN}✓ Files downloaded${NC}"

#-------------------------------------------------------------------------------
# Update dashboard for local API
#-------------------------------------------------------------------------------
echo -e "\n${YELLOW}Configuring dashboard for local API...${NC}"

if [ -f "${NEXUS_DIR}/dashboard/index.html" ]; then
    sed -i 's|https://nexus-alexa-bridge-45799.azurewebsites.net/api/honeywell-tcc|/api/thermostat|g' ${NEXUS_DIR}/dashboard/index.html
    sed -i 's|https://nexus-alexa-bridge-45799.azurewebsites.net/api/shelly-control|/api/shelly|g' ${NEXUS_DIR}/dashboard/index.html
    sed -i 's|https://nexus-alexa-bridge-45799.azurewebsites.net/api/ring-camera|/api/ring|g' ${NEXUS_DIR}/dashboard/index.html
    sed -i 's|http://192.168.1.116:8080/skyaware/data/aircraft.json|/api/aircraft|g' ${NEXUS_DIR}/dashboard/index.html
    echo -e "${GREEN}✓ Dashboard configured${NC}"
fi

#-------------------------------------------------------------------------------
# Create environment file
#-------------------------------------------------------------------------------
echo -e "\n${YELLOW}Creating environment file...${NC}"

if [ ! -f "${NEXUS_DIR}/.env" ]; then
    cat > ${NEXUS_DIR}/.env << 'EOF'
# NEXUS Configuration
# Fill in your credentials or use the setup wizard at http://nexus.local/setup

TCC_USERNAME=
TCC_PASSWORD=
RING_REFRESH_TOKEN=
SHELLY_AUTH_KEY=
EOF
    chmod 600 ${NEXUS_DIR}/.env
    echo -e "${GREEN}✓ Environment file created${NC}"
else
    echo -e "${GREEN}✓ Environment file already exists${NC}"
fi

#-------------------------------------------------------------------------------
# Create management scripts
#-------------------------------------------------------------------------------
echo -e "\n${YELLOW}Creating management scripts...${NC}"

# Start script
cat > ${NEXUS_DIR}/start.sh << 'EOF'
#!/bin/bash
cd /opt/nexus
docker compose up -d
echo "NEXUS started at http://$(hostname -I | awk '{print $1}')"
docker compose ps
EOF

# Stop script
cat > ${NEXUS_DIR}/stop.sh << 'EOF'
#!/bin/bash
cd /opt/nexus
docker compose down
echo "NEXUS stopped"
EOF

# Restart script
cat > ${NEXUS_DIR}/restart.sh << 'EOF'
#!/bin/bash
cd /opt/nexus
docker compose restart
docker compose ps
EOF

# Logs script
cat > ${NEXUS_DIR}/logs.sh << 'EOF'
#!/bin/bash
cd /opt/nexus
docker compose logs -f "${1:-}"
EOF

# Update script
cat > ${NEXUS_DIR}/update.sh << 'EOF'
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
EOF

# Discover script
cat > ${NEXUS_DIR}/discover.sh << 'EOF'
#!/bin/bash
cd /opt/nexus
docker compose exec api node discovery.js --all --json
EOF

chmod +x ${NEXUS_DIR}/*.sh

echo -e "${GREEN}✓ Management scripts created${NC}"

#-------------------------------------------------------------------------------
# Create systemd service
#-------------------------------------------------------------------------------
echo -e "\n${YELLOW}Creating systemd service...${NC}"

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

echo -e "${GREEN}✓ Systemd service created${NC}"

#-------------------------------------------------------------------------------
# Build and start
#-------------------------------------------------------------------------------
echo -e "\n${YELLOW}Building and starting NEXUS...${NC}"

cd ${NEXUS_DIR}

# Build API container
docker compose build

# Start services
docker compose up -d

# Wait for startup
sleep 5

#-------------------------------------------------------------------------------
# Get IP address
#-------------------------------------------------------------------------------
PI_IP=$(hostname -I | awk '{print $1}')

#-------------------------------------------------------------------------------
# Done!
#-------------------------------------------------------------------------------
echo -e "\n${GREEN}"
cat << EOF
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║            ✅ NEXUS Installation Complete!                    ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Dashboard:     http://${PI_IP}
║  Setup Wizard:  http://${PI_IP}/setup
║                                                               ║
║  Management:                                                  ║
║    Start:     /opt/nexus/start.sh                            ║
║    Stop:      /opt/nexus/stop.sh                             ║
║    Logs:      /opt/nexus/logs.sh                             ║
║    Update:    /opt/nexus/update.sh                           ║
║    Discover:  /opt/nexus/discover.sh                         ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

echo -e "${CYAN}Next steps:${NC}"
echo -e "  1. Open http://${PI_IP}/setup in your browser"
echo -e "  2. Enter your credentials"
echo -e "  3. The wizard will scan for devices automatically"
echo -e "  4. Name your devices and save"
echo -e ""
echo -e "${YELLOW}For external access, run:${NC}"
echo -e "  curl -fsSL ${REPO_URL}/pi5/setup-tunnel.sh | sudo bash"
echo -e ""

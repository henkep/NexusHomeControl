#!/bin/bash

#===============================================================================
# NEXUS - Cloudflare Tunnel Setup Script
# 
# Run after deploy-nexus.sh to enable secure external access
# Run as: sudo ./setup-cloudflare-tunnel.sh
#===============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Cloudflare Tunnel Setup for NEXUS                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo -e "${CYAN}Installing cloudflared...${NC}"
    
    # Detect architecture
    ARCH=$(uname -m)
    if [ "$ARCH" = "aarch64" ]; then
        CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    elif [ "$ARCH" = "armv7l" ]; then
        CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm"
    else
        CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    fi
    
    curl -L $CLOUDFLARED_URL -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
    
    echo -e "${GREEN}cloudflared installed!${NC}"
fi

cloudflared --version

echo ""
echo -e "${YELLOW}Step 1: Login to Cloudflare${NC}"
echo "This will open a URL - copy it to your browser and authorize."
echo ""

cloudflared tunnel login

echo ""
echo -e "${GREEN}Login successful!${NC}"
echo ""

# Get tunnel name
read -p "Enter a name for your tunnel (e.g., nexus): " TUNNEL_NAME

echo ""
echo -e "${YELLOW}Step 2: Creating tunnel '${TUNNEL_NAME}'${NC}"
cloudflared tunnel create $TUNNEL_NAME

# Get tunnel ID
TUNNEL_ID=$(cloudflared tunnel list | grep $TUNNEL_NAME | awk '{print $1}')
echo -e "${GREEN}Tunnel created with ID: ${TUNNEL_ID}${NC}"

echo ""
read -p "Enter your domain (e.g., nexus.yourdomain.com): " DOMAIN

echo ""
echo -e "${YELLOW}Step 3: Routing DNS${NC}"
cloudflared tunnel route dns $TUNNEL_NAME $DOMAIN

echo -e "${GREEN}DNS route created: ${DOMAIN} -> ${TUNNEL_NAME}${NC}"

echo ""
echo -e "${YELLOW}Step 4: Creating configuration${NC}"

mkdir -p /etc/cloudflared

cat > /etc/cloudflared/config.yml << EOF
tunnel: ${TUNNEL_ID}
credentials-file: /root/.cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: ${DOMAIN}
    service: http://localhost:80
    originRequest:
      noTLSVerify: true
  - service: http_status:404
EOF

echo -e "${GREEN}Configuration created at /etc/cloudflared/config.yml${NC}"

echo ""
echo -e "${YELLOW}Step 5: Installing as system service${NC}"
cloudflared service install

echo ""
echo -e "${YELLOW}Step 6: Starting tunnel service${NC}"
systemctl start cloudflared
systemctl enable cloudflared

echo ""
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Cloudflare Tunnel Setup Complete! 🎉                  ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${CYAN}Your NEXUS dashboard is now accessible at:${NC}"
echo -e "  https://${DOMAIN}"
echo ""
echo -e "${CYAN}Tunnel status:${NC}"
systemctl status cloudflared --no-pager
echo ""
echo -e "${CYAN}Useful commands:${NC}"
echo "  Check status:  systemctl status cloudflared"
echo "  View logs:     journalctl -u cloudflared -f"
echo "  Restart:       systemctl restart cloudflared"
echo ""

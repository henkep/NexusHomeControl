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

echo -e "${YELLOW}This will set up secure external access to your NEXUS dashboard.${NC}"
echo ""
echo "Prerequisites:"
echo "  • A Cloudflare account (free): https://cloudflare.com"
echo "  • A domain added to Cloudflare (can be any domain you own)"
echo ""

read -p "Press Enter to continue or Ctrl+C to cancel..."
echo ""

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
    
    curl -fsSL $CLOUDFLARED_URL -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
    
    echo -e "${GREEN}cloudflared installed!${NC}"
fi

echo ""
cloudflared --version
echo ""

echo -e "${YELLOW}Step 1: Login to Cloudflare${NC}"
echo ""
echo "A URL will appear below. Copy it and open in your browser to authorize."
echo ""

cloudflared tunnel login

echo ""
echo -e "${GREEN}✓ Login successful!${NC}"
echo ""

# Get tunnel name
echo -e "${YELLOW}Step 2: Create Tunnel${NC}"
echo ""
read -p "Enter a name for your tunnel (default: nexus): " TUNNEL_NAME
TUNNEL_NAME=${TUNNEL_NAME:-nexus}

# Check if tunnel already exists
if cloudflared tunnel list | grep -q "$TUNNEL_NAME"; then
    echo -e "${YELLOW}Tunnel '$TUNNEL_NAME' already exists. Using existing tunnel.${NC}"
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
else
    echo -e "${CYAN}Creating tunnel '${TUNNEL_NAME}'...${NC}"
    cloudflared tunnel create $TUNNEL_NAME
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
fi

echo -e "${GREEN}✓ Tunnel ID: ${TUNNEL_ID}${NC}"
echo ""

# Get domain
echo -e "${YELLOW}Step 3: Configure Domain${NC}"
echo ""
echo "You have two options:"
echo ""
echo "  ${CYAN}A) Cloudflare DNS${NC} - Domain must be added to Cloudflare"
echo "     We'll create the DNS record automatically."
echo ""
echo "  ${CYAN}B) Keep existing DNS${NC} - Add CNAME at your current registrar"
echo "     Point your subdomain to: ${TUNNEL_ID}.cfargotunnel.com"
echo ""
read -p "Use Cloudflare DNS? (y/n, default: n): " USE_CF_DNS
USE_CF_DNS=${USE_CF_DNS:-n}

echo ""
echo "Enter the full hostname where you want to access NEXUS."
echo "Examples:"
echo "  • home.yourdomain.com"
echo "  • nexus.yourdomain.com"
echo "  • dashboard.mysite.net"
echo ""
read -p "Enter hostname: " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Error: Hostname is required${NC}"
    exit 1
fi

if [ "$USE_CF_DNS" = "y" ] || [ "$USE_CF_DNS" = "Y" ]; then
    echo ""
    echo -e "${CYAN}Setting up Cloudflare DNS for ${DOMAIN}...${NC}"
    cloudflared tunnel route dns $TUNNEL_NAME $DOMAIN
    echo -e "${GREEN}✓ DNS route created: ${DOMAIN} → ${TUNNEL_NAME}${NC}"
else
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}Add this CNAME record at your DNS provider:${NC}"
    echo ""
    echo -e "  Type:  ${GREEN}CNAME${NC}"
    echo -e "  Name:  ${GREEN}$(echo $DOMAIN | cut -d. -f1)${NC}  (just the subdomain part)"
    echo -e "  Value: ${GREEN}${TUNNEL_ID}.cfargotunnel.com${NC}"
    echo ""
    echo "Example for ${DOMAIN}:"
    echo "  ${DOMAIN} CNAME ${TUNNEL_ID}.cfargotunnel.com"
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    read -p "Press Enter after adding the DNS record (or Ctrl+C to add it later)..."
fi
echo ""

# Create configuration
echo -e "${YELLOW}Step 4: Creating configuration${NC}"

mkdir -p /etc/cloudflared

# Find credentials file
CREDS_FILE=$(ls /root/.cloudflared/*.json 2>/dev/null | head -1)
if [ -z "$CREDS_FILE" ]; then
    CREDS_FILE="/root/.cloudflared/${TUNNEL_ID}.json"
fi

cat > /etc/cloudflared/config.yml << EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS_FILE}

ingress:
  # NEXUS Dashboard
  - hostname: ${DOMAIN}
    service: http://localhost:80
    originRequest:
      noTLSVerify: true
  
  # Catch-all (required)
  - service: http_status:404
EOF

echo -e "${GREEN}✓ Configuration saved to /etc/cloudflared/config.yml${NC}"
echo ""

# Ask about additional subdomains
echo -e "${YELLOW}Step 5: Additional Subdomains (Optional)${NC}"
echo ""
echo "Would you like to expose additional services?"
echo "  • PiAware/SkyAware (flight tracking map)"
echo ""
read -p "Add PiAware subdomain? (y/n): " ADD_PIAWARE

if [ "$ADD_PIAWARE" = "y" ] || [ "$ADD_PIAWARE" = "Y" ]; then
    # Extract base domain
    BASE_DOMAIN=$(echo $DOMAIN | sed 's/^[^.]*\.//')
    PIAWARE_DOMAIN="piaware.${BASE_DOMAIN}"
    
    read -p "PiAware hostname (default: ${PIAWARE_DOMAIN}): " PIAWARE_INPUT
    PIAWARE_DOMAIN=${PIAWARE_INPUT:-$PIAWARE_DOMAIN}
    
    cloudflared tunnel route dns $TUNNEL_NAME $PIAWARE_DOMAIN
    
    # Update config
    cat > /etc/cloudflared/config.yml << EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS_FILE}

ingress:
  # NEXUS Dashboard
  - hostname: ${DOMAIN}
    service: http://localhost:80
    originRequest:
      noTLSVerify: true
  
  # PiAware SkyAware
  - hostname: ${PIAWARE_DOMAIN}
    service: http://localhost:8080
  
  # Catch-all (required)
  - service: http_status:404
EOF

    echo -e "${GREEN}✓ PiAware will be at: https://${PIAWARE_DOMAIN}${NC}"
fi

echo ""

# Install service
echo -e "${YELLOW}Step 6: Installing System Service${NC}"

# Remove old service if exists
systemctl stop cloudflared 2>/dev/null || true
systemctl disable cloudflared 2>/dev/null || true

cloudflared service install

echo ""
echo -e "${YELLOW}Step 7: Starting Tunnel${NC}"
systemctl start cloudflared
systemctl enable cloudflared

# Wait and verify
sleep 3

echo ""
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Cloudflare Tunnel Setup Complete! 🎉                  ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${CYAN}Your NEXUS dashboard is now available at:${NC}"
echo -e "  ${GREEN}https://${DOMAIN}${NC}"

if [ "$ADD_PIAWARE" = "y" ] || [ "$ADD_PIAWARE" = "Y" ]; then
    echo -e "  ${GREEN}https://${PIAWARE_DOMAIN}${NC} (PiAware)"
fi

echo ""
echo -e "${CYAN}Tunnel status:${NC}"
systemctl status cloudflared --no-pager -l | head -10
echo ""
echo -e "${CYAN}Useful commands:${NC}"
echo "  Check status:  systemctl status cloudflared"
echo "  View logs:     journalctl -u cloudflared -f"
echo "  Restart:       systemctl restart cloudflared"
echo "  Edit config:   nano /etc/cloudflared/config.yml"
echo ""
echo -e "${YELLOW}Note: DNS may take a few minutes to propagate.${NC}"
echo ""

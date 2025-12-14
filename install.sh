#!/bin/bash
#
# NEXUS Home Control Center - Raspberry Pi Installation Script
# 
# This script installs everything needed to run NEXUS on a Raspberry Pi:
# - Docker and Docker Compose
# - PiAware (optional, for flight tracking)
# - NEXUS Smart Home Dashboard
# - Cloudflare Tunnel (optional, for external access)
#
# Tested on: Raspberry Pi 5, Debian Bookworm & Trixie
# 
# Usage: curl -sSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/install.sh | bash
#    or: ./install.sh
#
# Version: 1.0.0
# Date: 2025-12-14
#

set -e

# ============================================
# CONFIGURATION
# ============================================
NEXUS_VERSION="2.6.3"
NEXUS_DIR="/opt/nexus"
NEXUS_REPO="https://github.com/henkep/NexusHomeControl.git"
PIAWARE_INSTALL=true
CLOUDFLARE_INSTALL=false
AUTO_YES=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================
# HELPER FUNCTIONS
# ============================================
print_banner() {
    clear
    echo -e "${CYAN}"
    echo "    ╔═══════════════════════════════════════════════════════════╗"
    echo "    ║                                                           ║"
    echo "    ║     ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗          ║"
    echo "    ║     ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝          ║"
    echo "    ║     ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗          ║"
    echo "    ║     ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║          ║"
    echo "    ║     ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║          ║"
    echo "    ║     ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝          ║"
    echo "    ║                                                           ║"
    echo "    ║           HOME CONTROL CENTER INSTALLER                   ║"
    echo "    ║                    v${NEXUS_VERSION}                                  ║"
    echo "    ║                                                           ║"
    echo "    ╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
}

log_step() {
    echo -e "\n${CYAN}▶ $1${NC}"
}

log_success() {
    echo -e "${GREEN}  ✓ $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}  ⚠ $1${NC}"
}

log_error() {
    echo -e "${RED}  ✗ $1${NC}"
}

log_info() {
    echo -e "  $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

get_pi_user() {
    # Get the actual user (not root)
    if [ -n "$SUDO_USER" ]; then
        echo "$SUDO_USER"
    else
        echo "pi"
    fi
}

# ============================================
# SYSTEM DETECTION
# ============================================
detect_system() {
    log_step "Detecting system..."
    
    # Check if Raspberry Pi
    if [ -f /proc/device-tree/model ]; then
        PI_MODEL=$(cat /proc/device-tree/model | tr -d '\0')
        log_success "Detected: $PI_MODEL"
    else
        log_warn "Not a Raspberry Pi - some features may not work"
        PI_MODEL="Unknown"
    fi
    
    # Detect Debian version
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
        DISTRO_VERSION=$VERSION_CODENAME
        log_success "OS: $PRETTY_NAME"
    else
        DISTRO="unknown"
        DISTRO_VERSION="unknown"
    fi
    
    # Check for Trixie (testing) - important for bug #1
    IS_TRIXIE=false
    if [ "$DISTRO_VERSION" = "trixie" ] || grep -q "trixie" /etc/apt/sources.list 2>/dev/null; then
        IS_TRIXIE=true
        log_warn "Debian Trixie detected - will apply compatibility fixes"
    fi
    
    # Get architecture
    ARCH=$(dpkg --print-architecture)
    log_success "Architecture: $ARCH"
    
    # Get IP address
    IP_ADDRESS=$(hostname -I | awk '{print $1}')
    log_success "IP Address: $IP_ADDRESS"
}

# ============================================
# PREREQUISITES
# ============================================
install_prerequisites() {
    log_step "Installing prerequisites..."
    
    # Update package lists
    log_info "Updating package lists..."
    apt-get update -qq
    
    # Install essential packages
    log_info "Installing essential packages..."
    apt-get install -y -qq \
        curl \
        wget \
        git \
        ca-certificates \
        gnupg \
        lsb-release \
        jq \
        unzip \
        apt-transport-https
    
    # software-properties-common not available on Trixie
    if [ "$IS_TRIXIE" != true ]; then
        apt-get install -y -qq software-properties-common 2>/dev/null || true
    fi
    
    log_success "Prerequisites installed"
}

# ============================================
# DOCKER INSTALLATION
# ============================================
install_docker() {
    log_step "Installing Docker..."
    
    # Check if already installed
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
        log_success "Docker already installed ($DOCKER_VERSION)"
        
        # Ensure docker service is running
        systemctl enable docker
        systemctl start docker
        return 0
    fi
    
    # Remove old versions
    log_info "Removing old Docker versions (if any)..."
    apt-get remove -y -qq docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    # Add Docker's official GPG key
    log_info "Adding Docker GPG key..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    
    # Set up repository
    # Use bookworm for Trixie (Trixie packages not always available)
    if [ "$IS_TRIXIE" = true ]; then
        DOCKER_DISTRO="bookworm"
        log_warn "Using bookworm Docker repo for Trixie compatibility"
    else
        DOCKER_DISTRO="$DISTRO_VERSION"
    fi
    
    echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $DOCKER_DISTRO stable" > /etc/apt/sources.list.d/docker.list
    
    # Install Docker
    log_info "Installing Docker packages..."
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Add user to docker group
    PI_USER=$(get_pi_user)
    usermod -aG docker "$PI_USER"
    
    # Enable and start Docker
    systemctl enable docker
    systemctl start docker
    
    log_success "Docker installed successfully"
    log_info "Note: Log out and back in for docker group membership to take effect"
}

# ============================================
# PIAWARE INSTALLATION (with Trixie fix)
# ============================================
install_piaware() {
    log_step "PiAware (Flight Tracking) Setup..."
    
    # Check if user wants PiAware
    if [ "$PIAWARE_INSTALL" != true ]; then
        log_info "Skipping PiAware installation"
        return 0
    fi
    
    log_info "PiAware will run as a Docker container (more reliable)"
    log_info "Requirements: RTL-SDR USB dongle + FlightAware account"
    
    # Blacklist RTL-SDR kernel modules so Docker can access the device
    log_info "Blacklisting RTL-SDR kernel modules..."
    cat > /etc/modprobe.d/blacklist-rtlsdr.conf << 'EOF'
# Blacklist RTL-SDR kernel modules so Docker container can access the device
blacklist rtl2832
blacklist rtl2832_sdr
blacklist dvb_usb_rtl28xxu
EOF
    
    # Unload modules if currently loaded
    rmmod rtl2832_sdr 2>/dev/null || true
    rmmod dvb_usb_rtl28xxu 2>/dev/null || true
    rmmod rtl2832 2>/dev/null || true
    
    log_success "RTL-SDR kernel modules blacklisted"
    
    # Create PiAware env file for configuration
    log_info "Creating PiAware configuration..."
    mkdir -p "$NEXUS_DIR"
    cat > "$NEXUS_DIR/.env.piaware" << 'EOF'
# PiAware Configuration
# Edit these values and then run: cd /opt/nexus && docker compose --profile piaware up -d

# Your FlightAware Feeder ID (get from https://flightaware.com/adsb/piaware/claim)
PIAWARE_FEEDER_ID=

# Your location (decimal degrees)
PIAWARE_LAT=
PIAWARE_LON=

# Feeder name (shows on FlightAware)
PIAWARE_NAME=NEXUS-Home

# Timezone
TZ=America/New_York
EOF
    
    log_success "PiAware Docker configuration created"
    log_info ""
    log_info "To enable PiAware:"
    log_info "  1. Plug in your RTL-SDR USB dongle"
    log_info "  2. Edit /opt/nexus/.env.piaware with your FlightAware details"
    log_info "  3. Run: cd /opt/nexus && docker compose --profile piaware up -d"
    log_info "  4. Access SkyAware at: http://$IP_ADDRESS:8080"
    log_info ""
}

configure_piaware() {
    # No longer needed - Docker handles everything
    log_info "PiAware will be configured via Docker"
}

install_piaware_manual() {
    # No longer needed - using Docker instead
    log_info "Using Docker-based PiAware instead of manual install"
}

# ============================================
# NEXUS INSTALLATION
# ============================================
install_nexus() {
    log_step "Installing NEXUS Home Control Center..."
    
    # Create directory
    if [ -d "$NEXUS_DIR" ]; then
        log_warn "NEXUS directory exists - backing up config"
        cp "$NEXUS_DIR/config.json" /tmp/nexus-config-backup.json 2>/dev/null || true
        cp "$NEXUS_DIR/.credentials.json" /tmp/nexus-credentials-backup.json 2>/dev/null || true
    fi
    
    mkdir -p "$NEXUS_DIR"
    
    # Clone or download
    log_info "Downloading NEXUS..."
    if command -v git &> /dev/null; then
        if [ -d "$NEXUS_DIR/.git" ]; then
            cd "$NEXUS_DIR"
            git pull origin main
        else
            rm -rf "$NEXUS_DIR"
            git clone "$NEXUS_REPO" "$NEXUS_DIR"
        fi
    else
        # Fallback to zip download
        cd /tmp
        wget -q "https://github.com/henkep/NexusHomeControl/archive/refs/heads/main.zip" -O nexus.zip
        unzip -o -q nexus.zip
        cp -r NexusHomeControl-main/pi5/* "$NEXUS_DIR/" 2>/dev/null || cp -r NexusHomeControl-main/* "$NEXUS_DIR/"
        rm -rf nexus.zip NexusHomeControl-main
    fi
    
    # Restore config if backed up
    if [ -f /tmp/nexus-config-backup.json ]; then
        log_info "Restoring previous configuration..."
        cp /tmp/nexus-config-backup.json "$NEXUS_DIR/config.json"
        rm /tmp/nexus-config-backup.json
    fi
    if [ -f /tmp/nexus-credentials-backup.json ]; then
        cp /tmp/nexus-credentials-backup.json "$NEXUS_DIR/.credentials.json"
        rm /tmp/nexus-credentials-backup.json
    fi
    
    # Create data directory
    mkdir -p "$NEXUS_DIR/data"
    
    # Set permissions
    PI_USER=$(get_pi_user)
    chown -R "$PI_USER:$PI_USER" "$NEXUS_DIR"
    
    log_success "NEXUS files installed to $NEXUS_DIR"
}

# ============================================
# START NEXUS
# ============================================
start_nexus() {
    log_step "Starting NEXUS..."
    
    cd "$NEXUS_DIR"
    
    # Build and start containers
    log_info "Building Docker containers (this may take a few minutes)..."
    docker compose build --quiet
    
    log_info "Starting services..."
    docker compose up -d
    
    # Wait for services to be ready
    log_info "Waiting for services to start..."
    sleep 10
    
    # Check if running
    if docker compose ps | grep -q "Up"; then
        log_success "NEXUS is running!"
    else
        log_error "NEXUS failed to start - check logs with: docker compose logs"
        return 1
    fi
    
    # Create systemd service for auto-start
    log_info "Setting up auto-start on boot..."
    cat > /etc/systemd/system/nexus.service << EOF
[Unit]
Description=NEXUS Home Control Center
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$NEXUS_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=root

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable nexus.service
    
    log_success "NEXUS will start automatically on boot"
}

# ============================================
# CLOUDFLARE TUNNEL (Optional)
# ============================================
install_cloudflare_tunnel() {
    log_step "Cloudflare Tunnel Setup"
    
    if [ "$CLOUDFLARE_INSTALL" != true ]; then
        log_info "Skipping Cloudflare Tunnel (run with --cloudflare to install)"
        return 0
    fi
    
    # Check if already installed
    if command -v cloudflared &> /dev/null; then
        log_success "cloudflared already installed"
        return 0
    fi
    
    log_info "Installing cloudflared..."
    
    # Download and install
    if [ "$ARCH" = "arm64" ]; then
        curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cloudflared.deb
    else
        curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm.deb -o /tmp/cloudflared.deb
    fi
    
    dpkg -i /tmp/cloudflared.deb
    rm /tmp/cloudflared.deb
    
    log_success "cloudflared installed"
    log_info ""
    log_info "To set up your tunnel, run:"
    log_info "  1. cloudflared tunnel login"
    log_info "  2. cloudflared tunnel create nexus"
    log_info "  3. cloudflared tunnel route dns nexus your-subdomain"
    log_info "  4. Create /etc/cloudflared/config.yml"
    log_info "  5. sudo cloudflared service install"
    log_info ""
}

# ============================================
# SUMMARY
# ============================================
show_summary() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    INSTALLATION COMPLETE!                          ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}NEXUS Dashboard:${NC}"
    echo -e "  Local:    ${GREEN}http://$IP_ADDRESS${NC}"
    echo -e "  Local:    ${GREEN}http://$(hostname).local${NC}"
    echo ""
    
    if [ "$PIAWARE_INSTALL" = true ]; then
        echo -e "${CYAN}PiAware (Flight Tracking):${NC}"
        echo -e "  Status:   ${YELLOW}Ready to configure${NC}"
        echo -e "  Config:   ${GREEN}/opt/nexus/.env.piaware${NC}"
        echo -e "  Start:    ${YELLOW}cd /opt/nexus && docker compose --profile piaware up -d${NC}"
        echo -e "  Web UI:   ${GREEN}http://$IP_ADDRESS:8080${NC} (after starting)"
        echo ""
    fi
    
    echo -e "${CYAN}Useful Commands:${NC}"
    echo -e "  View logs:     ${YELLOW}cd $NEXUS_DIR && docker compose logs -f${NC}"
    echo -e "  Restart:       ${YELLOW}cd $NEXUS_DIR && docker compose restart${NC}"
    echo -e "  Stop:          ${YELLOW}cd $NEXUS_DIR && docker compose down${NC}"
    echo -e "  Update:        ${YELLOW}cd $NEXUS_DIR && git pull && docker compose build && docker compose up -d${NC}"
    echo ""
    
    echo -e "${CYAN}Next Steps:${NC}"
    echo -e "  1. Open ${GREEN}http://$IP_ADDRESS${NC} in your browser"
    echo -e "  2. Go to Settings (⚙️) to configure your devices"
    echo -e "  3. Add your Shelly, Honeywell, and Ring devices"
    echo ""
    
    if [ "$CLOUDFLARE_INSTALL" != true ]; then
        echo -e "${YELLOW}For external access:${NC}"
        echo -e "  Run this script again with --cloudflare flag"
        echo -e "  Or manually install: ${YELLOW}cloudflared${NC}"
        echo ""
    fi
    
    echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# ============================================
# PARSE ARGUMENTS
# ============================================
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --no-piaware)
                PIAWARE_INSTALL=false
                shift
                ;;
            --cloudflare)
                CLOUDFLARE_INSTALL=true
                shift
                ;;
            -y|--yes)
                AUTO_YES=true
                shift
                ;;
            --help|-h)
                echo "NEXUS Home Control Center Installer"
                echo ""
                echo "Usage: sudo ./install.sh [options]"
                echo ""
                echo "Options:"
                echo "  --no-piaware    Skip PiAware installation"
                echo "  --cloudflare    Install Cloudflare Tunnel"
                echo "  -y, --yes       Skip confirmation prompt (for curl | bash)"
                echo "  --help          Show this help message"
                echo ""
                echo "Examples:"
                echo "  sudo ./install.sh                    # Interactive install"
                echo "  sudo ./install.sh -y                 # Auto-confirm"
                echo "  sudo ./install.sh -y --no-piaware    # Auto-confirm, skip PiAware"
                echo "  curl -sSL <url>/install.sh | sudo bash -s -- -y"
                echo ""
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
}

# ============================================
# MAIN
# ============================================
main() {
    parse_args "$@"
    
    print_banner
    
    echo "This script will install:"
    echo "  • Docker and Docker Compose"
    if [ "$PIAWARE_INSTALL" = true ]; then
        echo "  • PiAware (Flight Tracking)"
    fi
    echo "  • NEXUS Home Control Center"
    if [ "$CLOUDFLARE_INSTALL" = true ]; then
        echo "  • Cloudflare Tunnel"
    fi
    echo ""
    
    if [ "$AUTO_YES" != true ]; then
        read -p "Continue with installation? (y/n) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled."
            exit 0
        fi
    else
        echo "Auto-confirm enabled (-y flag)"
    fi
    
    check_root
    detect_system
    install_prerequisites
    install_docker
    install_piaware
    install_nexus
    start_nexus
    install_cloudflare_tunnel
    show_summary
}

# Run main with all arguments
main "$@"

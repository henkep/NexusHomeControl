#!/bin/bash

# ============================================
# NEXUS Home Control Center - Uninstaller
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "  ${CYAN}$1${NC}"; }
log_success() { echo -e "  ${GREEN}✓ $1${NC}"; }
log_warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
log_error() { echo -e "  ${RED}✗ $1${NC}"; }
log_step() { echo -e "\n${GREEN}▶ $1${NC}"; }

NEXUS_DIR="/opt/nexus"
FULL_UNINSTALL=false
KEEP_DOCKER=false

print_banner() {
    echo -e "${RED}"
    cat << 'EOF'
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║     ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗          ║
    ║     ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝          ║
    ║     ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗          ║
    ║     ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║          ║
    ║     ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║          ║
    ║     ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝          ║
    ║                                                           ║
    ║                    UNINSTALLER                            ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Please run as root: sudo ./uninstall.sh"
        exit 1
    fi
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --full)
                FULL_UNINSTALL=true
                shift
                ;;
            --keep-docker)
                KEEP_DOCKER=true
                shift
                ;;
            -y|--yes)
                AUTO_YES=true
                shift
                ;;
            --help|-h)
                echo "NEXUS Home Control Center Uninstaller"
                echo ""
                echo "Usage: sudo ./uninstall.sh [options]"
                echo ""
                echo "Options:"
                echo "  --full         Remove everything including Docker"
                echo "  --keep-docker  Keep Docker installed (default removes it)"
                echo "  -y, --yes      Skip confirmation prompts"
                echo "  --help         Show this help message"
                echo ""
                echo "Examples:"
                echo "  sudo ./uninstall.sh              # Remove NEXUS only, keep Docker"
                echo "  sudo ./uninstall.sh --full       # Remove everything"
                echo "  sudo ./uninstall.sh --full -y    # Remove everything, no prompts"
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

stop_nexus() {
    log_step "Stopping NEXUS services..."
    
    # Stop Docker containers
    if [ -d "$NEXUS_DIR" ] && [ -f "$NEXUS_DIR/docker-compose.yml" ]; then
        cd "$NEXUS_DIR"
        docker compose down 2>/dev/null || true
        docker compose --profile piaware down 2>/dev/null || true
        log_success "Docker containers stopped"
    fi
    
    # Stop and disable systemd service
    if systemctl is-active --quiet nexus 2>/dev/null; then
        systemctl stop nexus
        log_success "NEXUS service stopped"
    fi
    
    if systemctl is-enabled --quiet nexus 2>/dev/null; then
        systemctl disable nexus
        log_success "NEXUS service disabled"
    fi
    
    # Remove systemd service file
    if [ -f /etc/systemd/system/nexus.service ]; then
        rm -f /etc/systemd/system/nexus.service
        systemctl daemon-reload
        log_success "NEXUS systemd service removed"
    fi
}

remove_nexus() {
    log_step "Removing NEXUS files..."
    
    # Remove Docker images
    if command -v docker &> /dev/null; then
        docker rmi nexus-api 2>/dev/null || true
        docker rmi $(docker images -q --filter "reference=nexus*") 2>/dev/null || true
        log_success "NEXUS Docker images removed"
        
        # Remove volumes
        docker volume rm nexus_piaware-data 2>/dev/null || true
        docker volume rm $(docker volume ls -q --filter "name=nexus*") 2>/dev/null || true
        log_success "Docker volumes removed"
    fi
    
    # Remove NEXUS directory
    if [ -d "$NEXUS_DIR" ]; then
        rm -rf "$NEXUS_DIR"
        log_success "Removed $NEXUS_DIR"
    fi
    
    # Remove any cloned repo in home directories
    for homedir in /home/*; do
        if [ -d "$homedir/NexusHomeControl" ]; then
            rm -rf "$homedir/NexusHomeControl"
            log_success "Removed $homedir/NexusHomeControl"
        fi
    done
}

remove_piaware() {
    log_step "Removing PiAware..."
    
    # Stop services
    systemctl stop piaware 2>/dev/null || true
    systemctl stop dump1090-fa 2>/dev/null || true
    systemctl disable piaware 2>/dev/null || true
    systemctl disable dump1090-fa 2>/dev/null || true
    
    # Remove packages
    apt-get remove -y --purge piaware dump1090-fa 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    
    # Remove FlightAware repo
    rm -f /etc/apt/sources.list.d/flightaware.list
    rm -f /etc/apt/keyrings/flightaware.gpg
    
    # Remove RTL-SDR blacklist (so kernel can use the device again)
    rm -f /etc/modprobe.d/blacklist-rtlsdr.conf
    
    # Remove lighttpd if installed for PiAware
    apt-get remove -y --purge lighttpd 2>/dev/null || true
    
    log_success "PiAware removed"
}

remove_docker() {
    log_step "Removing Docker..."
    
    # Stop all containers
    docker stop $(docker ps -aq) 2>/dev/null || true
    docker rm $(docker ps -aq) 2>/dev/null || true
    
    # Remove all images
    docker rmi $(docker images -aq) 2>/dev/null || true
    
    # Remove Docker packages
    apt-get remove -y --purge docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    
    # Remove Docker data
    rm -rf /var/lib/docker
    rm -rf /var/lib/containerd
    
    # Remove Docker repo
    rm -f /etc/apt/sources.list.d/docker.list
    rm -f /etc/apt/keyrings/docker.gpg
    
    # Remove user from docker group
    for user in $(ls /home); do
        gpasswd -d "$user" docker 2>/dev/null || true
    done
    
    log_success "Docker removed"
}

cleanup() {
    log_step "Cleaning up..."
    
    # Clean apt cache
    apt-get clean
    apt-get autoremove -y
    
    # Remove any orphaned configs
    rm -f /etc/modprobe.d/blacklist-rtl*.conf
    
    log_success "Cleanup complete"
}

main() {
    parse_args "$@"
    
    print_banner
    
    echo -e "${YELLOW}This will remove:${NC}"
    echo "  • NEXUS Home Control Center"
    echo "  • NEXUS Docker containers and images"
    echo "  • PiAware/dump1090 (if installed)"
    if [ "$FULL_UNINSTALL" = true ] && [ "$KEEP_DOCKER" != true ]; then
        echo -e "  ${RED}• Docker (--full mode)${NC}"
    fi
    echo ""
    
    if [ "$AUTO_YES" != true ]; then
        read -p "Continue with uninstall? (y/n) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Uninstall cancelled."
            exit 0
        fi
    fi
    
    check_root
    stop_nexus
    remove_nexus
    remove_piaware
    
    if [ "$FULL_UNINSTALL" = true ] && [ "$KEEP_DOCKER" != true ]; then
        remove_docker
    else
        log_info "Keeping Docker installed (use --full to remove)"
    fi
    
    cleanup
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    UNINSTALL COMPLETE!                            ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "To reinstall NEXUS:"
    echo -e "  ${CYAN}curl -sSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/install.sh | sudo bash -s -- -y${NC}"
    echo ""
}

main "$@"

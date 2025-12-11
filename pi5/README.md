# NEXUS Dashboard - Raspberry Pi 5 Local Deployment

Run your NEXUS smart home dashboard locally on a Raspberry Pi 5 for instant response times.

## 🚀 Quick Install (Recommended)

### 1. Flash SD Card

Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/):
- Device: **Raspberry Pi 5**
- OS: **Raspberry Pi OS Lite (64-bit)**
- Settings: hostname=`nexus`, enable SSH, configure WiFi

### 2. Boot & Install

```bash
ssh pi@nexus.local
curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/install.sh | sudo bash
```

### 3. Configure

Open **http://nexus.local/setup** in your browser.

Done! 🎉

---

## 🔄 Zero-Touch Install (Advanced)

Want it to install automatically on first boot? See [SETUP-GUIDE.md](SETUP-GUIDE.md) for the zero-touch method.

---

## 📦 What's Included

- **Auto-Discovery**: Automatically finds Shelly, Honeywell, Ring, and PiAware devices
- **Setup Wizard**: Web-based configuration at `http://<pi-ip>/setup`
- **Local Control**: Shelly lights respond in ~50ms instead of ~1000ms
- **Docker-based**: Easy updates and management

## Manual Install

1. Flash Raspberry Pi OS Lite (64-bit) to SD card
2. Enable SSH, set hostname to `nexus`
3. Boot and SSH in: `ssh pi@nexus.local`
4. Run installer:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/install.sh | sudo bash
   ```
5. Open `http://<pi-ip>/setup` and follow the wizard

## External Access (Cloudflare Tunnel)

```bash
sudo /opt/nexus/setup-tunnel.sh
```

This sets up secure HTTPS access at your own domain (e.g., `https://home.yourdomain.com`).

**Requirements:**
- Free Cloudflare account
- A domain added to Cloudflare

See [SETUP-GUIDE.md](SETUP-GUIDE.md) for detailed custom domain instructions.

## Management Commands

```bash
/opt/nexus/start.sh      # Start services
/opt/nexus/stop.sh       # Stop services
/opt/nexus/logs.sh       # View logs
/opt/nexus/update.sh     # Update containers
/opt/nexus/discover.sh   # Re-scan for devices
```

## File Structure

```
/opt/nexus/
├── docker-compose.yml
├── config.json          # Auto-generated device config
├── .credentials.json    # Encrypted credentials
├── api/                 # Backend server
├── dashboard/           # Frontend HTML
├── nginx/               # Web server
└── data/                # Persistent storage
```

## Performance

| Action | Cloud (Azure) | Local (Pi 5) |
|--------|---------------|--------------|
| Shelly lights | 800-1200ms | **50-100ms** |
| PiAware | 500-800ms | **10-20ms** |
| Dashboard | 200-400ms | **50-100ms** |

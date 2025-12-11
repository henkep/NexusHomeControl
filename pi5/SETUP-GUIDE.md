# NEXUS Raspberry Pi 5 - Complete Setup Guide

## 🎯 Choose Your Setup Method

| Method | Difficulty | Time | Best For |
|--------|------------|------|----------|
| **A: One-Command** | ⭐ Easy | 15 min | Most users |
| **B: Zero-Touch** | ⭐⭐ Medium | 15 min | Set-and-forget |
| **C: Manual** | ⭐⭐⭐ Advanced | 20 min | Full control |

---

## Method A: One-Command Install (Recommended)

### Step 1: Flash SD Card with Pi Imager

1. Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Select: **Raspberry Pi 5**
3. Select: **Raspberry Pi OS Lite (64-bit)**
4. Click **⚙️ Settings** and configure:

| Setting | Value |
|---------|-------|
| Hostname | `nexus` |
| Username | `pi` |
| Password | (your choice) |
| WiFi | Your network |
| Enable SSH | ✅ Yes |

5. Write to SD card

### Step 2: Boot and Install

1. Insert SD card into Pi 5
2. Power on and wait 2 minutes
3. From your PC, run:

```powershell
ssh pi@nexus.local
```

4. Run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/install.sh | sudo bash
```

5. Wait ~10 minutes for Docker to build

### Step 3: Configure

Open browser: **http://nexus.local/setup**

Done! 🎉

---

## Method B: Zero-Touch Auto-Setup

This method installs NEXUS automatically on first boot - no SSH required.

### Step 1: Flash SD Card (same as Method A)

### Step 2: Add Auto-Setup Script

After flashing, **don't eject yet!**

#### On Windows:

1. Open the SD card's `bootfs` drive in Explorer
2. Create a new file called `firstrun.sh` with this content:

```bash
#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/install.sh | bash
```

3. Open `cmdline.txt` and add to the END of the line (same line, with a space):
```
systemd.run=/boot/firmware/firstrun.sh
```

#### On Mac/Linux:

```bash
# Find your SD card (e.g., /Volumes/bootfs or /media/pi/bootfs)
cd /Volumes/bootfs

# Create firstrun script
echo '#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/install.sh | bash' > firstrun.sh
chmod +x firstrun.sh

# Edit cmdline.txt - add to end of line:
# systemd.run=/boot/firmware/firstrun.sh
```

### Step 3: Boot and Wait

1. Eject SD card
2. Insert into Pi 5
3. Power on
4. **Wait 15 minutes** (watch the green LED)
5. Open browser: **http://nexus.local/setup**

---

## Method C: Manual Install

For full control over every step.

### Step 1: Flash and SSH (same as Method A)

### Step 2: Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker pi
newgrp docker
```

### Step 3: Download NEXUS

```bash
sudo mkdir -p /opt/nexus
cd /opt/nexus

# Download files
sudo curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/docker-compose.yml -o docker-compose.yml
sudo mkdir -p api nginx setup-wizard dashboard

sudo curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/api/server.js -o api/server.js
sudo curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/api/discovery.js -o api/discovery.js
sudo curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/api/package.json -o api/package.json
sudo curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/api/Dockerfile -o api/Dockerfile
sudo curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/nginx/nexus.conf -o nginx/nexus.conf
sudo curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/setup-wizard/index.html -o setup-wizard/index.html
sudo curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/dashboard/index.html -o dashboard/index.html
```

### Step 4: Build and Start

```bash
cd /opt/nexus
sudo docker compose build
sudo docker compose up -d
```

### Step 5: Enable Auto-Start

```bash
sudo tee /etc/systemd/system/nexus.service << 'EOF'
[Unit]
Description=NEXUS Dashboard
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/nexus
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable nexus.service
```

---

## 📍 After Setup

### Access Points

| URL | Purpose |
|-----|---------|
| http://nexus.local | Dashboard |
| http://nexus.local/setup | Setup wizard (first time) |
| http://nexus.local:8080 | PiAware SkyAware |

### Management Commands

```bash
/opt/nexus/start.sh      # Start NEXUS
/opt/nexus/stop.sh       # Stop NEXUS
/opt/nexus/logs.sh       # View logs
/opt/nexus/update.sh     # Update to latest
```

### External Access (Optional)

To access from outside your home:

```bash
sudo /opt/nexus/setup-tunnel.sh
```

---

## 🌐 Custom Domain Setup

Want to access your dashboard at `https://home.yourdomain.com`? Here's how:

### Option A: Keep Your Existing DNS (Recommended)

**No need to transfer your domain to Cloudflare!** Just add one CNAME record.

#### Step 1: Create Cloudflare Account & Tunnel

```bash
# On your Pi
sudo /opt/nexus/setup-tunnel.sh
```

When it asks for a domain, enter anything for now (we'll fix DNS manually).

**Or create tunnel manually:**
```bash
# Install cloudflared
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
sudo mv cloudflared /usr/local/bin/
sudo chmod +x /usr/local/bin/cloudflared

# Login (creates free account if needed)
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create nexus

# Note your tunnel ID (looks like: a]f7b2c3d-1234-5678-abcd-ef1234567890)
cloudflared tunnel list
```

#### Step 2: Add CNAME at Your Current Registrar

At your existing DNS provider (GoDaddy, Namecheap, Route53, etc.), add:

| Type | Name | Value |
|------|------|-------|
| CNAME | `home` | `<tunnel-id>.cfargotunnel.com` |

Example:
```
home.yourdomain.com  CNAME  af7b2c3d-1234-5678-abcd-ef1234567890.cfargotunnel.com
```

#### Step 3: Configure Tunnel

```bash
# Create config
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

Add:
```yaml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: home.yourdomain.com
    service: http://localhost:80
  - service: http_status:404
```

#### Step 4: Start Tunnel

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

Done! Access at `https://home.yourdomain.com`

---

### Option B: Use Cloudflare DNS (Full Transfer)

If you want Cloudflare's CDN, DDoS protection, and automatic DNS management:

#### Prerequisites

1. A domain name
2. Free Cloudflare account (https://cloudflare.com)

#### Step 1: Add Domain to Cloudflare

1. Log into Cloudflare dashboard
2. Click **"Add a Site"**
3. Enter your domain
4. Select **Free** plan
5. Cloudflare will scan existing DNS records
6. Update your domain's nameservers at your registrar to Cloudflare's

#### Step 2: Run Tunnel Setup

```bash
sudo /opt/nexus/setup-tunnel.sh
```

The script will automatically create DNS records in Cloudflare.

---

### Comparison

| Feature | Option A (CNAME) | Option B (Cloudflare DNS) |
|---------|------------------|---------------------------|
| Keep existing DNS | ✅ Yes | ❌ Must transfer |
| Setup complexity | ⭐ Simple | ⭐⭐ Medium |
| Automatic DNS | ❌ Manual | ✅ Automatic |
| Cloudflare CDN | ❌ No | ✅ Yes |
| DDoS protection | ⚠️ Basic | ✅ Full |
| Works with any registrar | ✅ Yes | ✅ Yes |

**Recommendation:** Use Option A if you just want a subdomain. Use Option B if you want full Cloudflare features.

### Multiple Subdomains

You can expose multiple services:

```yaml
# /etc/cloudflared/config.yml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: home.yourdomain.com
    service: http://localhost:80
  - hostname: piaware.yourdomain.com
    service: http://localhost:8080
  - hostname: api.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

Then add DNS routes:
```bash
cloudflared tunnel route dns nexus piaware.yourdomain.com
cloudflared tunnel route dns nexus api.yourdomain.com
```

### Security Notes

- ✅ HTTPS is automatic (Cloudflare handles certificates)
- ✅ No ports opened on your router
- ✅ DDoS protection included
- ⚠️ Consider adding [Cloudflare Access](https://www.cloudflare.com/products/zero-trust/access/) for extra authentication

---

## 🔧 Troubleshooting

### Can't find nexus.local?

Try the IP address directly. Find it with:
```bash
# On Windows
arp -a | findstr "b8-27-eb\|dc-a6-32\|e4-5f-01\|d8-3a-dd"

# Or check your router's admin page for "nexus"
```

### Setup didn't complete?

Check the log:
```bash
ssh pi@nexus.local
cat /var/log/nexus-setup.log
```

### Docker build failed?

Re-run:
```bash
cd /opt/nexus
sudo docker compose build --no-cache
sudo docker compose up -d
```

### Start fresh?

```bash
cd /opt/nexus
sudo docker compose down -v
sudo rm -rf /opt/nexus/*
curl -fsSL https://raw.githubusercontent.com/henkep/NexusHomeControl/main/pi5/install.sh | sudo bash
```

---

## 📝 What Gets Installed

```
/opt/nexus/
├── docker-compose.yml    # Container orchestration
├── config.json           # Your devices (created by wizard)
├── .credentials.json     # Your passwords (encrypted)
├── api/                  # Backend server
├── dashboard/            # Web interface
├── nginx/                # Web server config
├── setup-wizard/         # First-time setup UI
└── data/                 # Persistent storage
```

**Docker Containers:**
- `nexus-nginx` - Web server (port 80)
- `nexus-api` - API server
- `nexus-redis` - Cache

---

## 🎉 You're Done!

After setup, your NEXUS dashboard will:
- ⚡ Control Shelly lights instantly (~50ms)
- 🌡️ Monitor Honeywell thermostats
- 📹 Show Ring doorbell snapshots
- ✈️ Track nearby aircraft
- 🌤️ Display weather forecasts
- 🎬 Run automation scenes

All running locally on your Pi 5!

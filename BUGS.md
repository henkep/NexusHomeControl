# NEXUS Installation Package - Bug Report

**Date:** December 11, 2025  
**Test Environment:** Raspberry Pi 5, Debian Trixie (testing) Lite  
**Tester:** Installation debugging session

---

## Critical Issues (Blocks Installation)

### 1. FlightAware repo breaks apt on Trixie
**Symptom:** `apt update` fails after PiAware installation  
**Cause:** FlightAware repo not compatible with Debian Trixie  
**Fix:** Install script should detect Trixie and skip adding repo, or remove on failure  
**Workaround:** `sudo rm /etc/apt/sources.list.d/flightaware-apt-repository.list`

### 2. Port 80 conflict with lighttpd (PiAware)
**Symptom:** NEXUS nginx fails to start  
**Cause:** PiAware's lighttpd already using port 80  
**Fix:** Install script should stop/disable lighttpd and reconfigure to port 8080  
**Workaround:** 
```bash
sudo systemctl stop lighttpd
sudo systemctl disable lighttpd
sudo sed -i 's/server.port.*= 80/server.port = 8080/' /etc/lighttpd/lighttpd.conf
sudo systemctl enable lighttpd && sudo systemctl start lighttpd
```

---

## Setup Wizard Bugs

### 3. Address geocoding not working
**Symptom:** "Use My Location" fails, manual address doesn't get lat/lon  
**Cause:** Geolocation API requires HTTPS; no geocoding API for manual entry  
**Fix:** Add Nominatim or similar geocoding API for address lookup

### 4. Discovered Shelly devices not saved to config (FIXED)
**Symptom:** Discovery finds 3 devices, config shows empty array  
**Cause:** Discovery results not persisted to config.json  
**Fix:** Save discovered devices in `/api/discover/:type` endpoint
**Status:** Fixed - auto-saves to config on discovery

### 5. Shelly discovery false positives (FIXED)
**Symptom:** Detects HP printers and other devices as Shellys  
**Cause:** Loose check for "type" in response instead of JSON parsing  
**Fix:** Check for specific Shelly API endpoints (`/rpc/Shelly.GetDeviceInfo` for Gen2, `/shelly` for Gen1)
**Status:** Fixed - only real Shelly devices detected

### 6. Shelly discovery misses Gen2/Gen3 devices (FIXED)
**Symptom:** Gen3 Shelly 1PM devices not found  
**Cause:** Code checks for `"type":"SH...` which only exists in Gen1  
**Fix:** Check Gen2/Gen3 RPC API first, then Gen1 API
**Status:** Fixed - Gen2 and Gen3 devices now discovered

### 7. PiAware auto-discovery fails
**Symptom:** PiAware on same Pi not detected  
**Cause:** Docker container can't reach localhost; code reads filesystem path  
**Fix:** Scan host IP (not localhost), or detect host.docker.internal

### 8. PiAware URL path incorrect
**Symptom:** aircraft.json not found  
**Cause:** Uses `/data/aircraft.json` but lighttpd serves `/skyaware/data/aircraft.json`  
**Fix:** Update default path to `/skyaware/data/aircraft.json`

### 9. Discovery hangs/slow
**Symptom:** Scanning 254 IPs takes very long  
**Cause:** Sequential scanning with no progress indicator  
**Fix:** Parallel scanning with timeout, show progress

---

## API Issues

### 10. Gen3 Shelly control fails (FIXED)
**Symptom:** Gen3 devices use wrong API endpoint  
**Cause:** Code checks `gen === 2` instead of `gen >= 2`  
**Fix:** Changed all conditions to `gen >= 2` for RPC API
**Status:** Fixed - Gen2 and Gen3 use same RPC API

### 11. Dashboard/API endpoint mismatch (FIXED)
**Symptom:** Dashboard Shelly status shows "Offline"  
**Cause:** Dashboard called `/api/shelly?action=status`, API serves `/api/shelly/status`  
**Status:** Fixed by updating dashboard JS

### 12. "Local" PiAware source doesn't work in Docker
**Symptom:** `source: "local"` returns "Local PiAware not found"  
**Cause:** API reads filesystem `/run/dump1090-fa/aircraft.json` not mounted in container  
**Fix:** Either mount volume or make "local" use host IP URL

---

## Dashboard UI Bugs

### 13. Hardcoded Kitchen Lights (FIXED)
**Symptom:** Buttons show "Stovetop, Counter, Sink" regardless of config  
**Status:** Fixed - now dynamically renders from `/api/devices`

### 14. Hardcoded rooms (FIXED)
**Symptom:** Room names not from config  
**Status:** Fixed - rooms come from device config

### 15. Settings icon not showing
**Symptom:** Settings button in header has no visible icon  
**Cause:** Missing image or CSS issue  
**Status:** Needs investigation

### 15b. Config overwritten on update (FIXED)
**Symptom:** Device names and settings reset after system update  
**Cause:** Zip included config.json which overwrote user's config  
**Fix:** 
- Removed config.json from zip (now only config.example.json)
- Update extraction excludes config.json and .credentials.json
- loadConfig() creates default on first run only
**Status:** Fixed in v2.4.0

### 16. Multiple browser console 404 errors
**Symptom:** Console shows failed requests  
**Errors observed:**
- `/api/shelly?action=status` - 404 (endpoint mismatch)
- SignalR/Azure connection failures (expected if not configured)

---

## Configuration Issues

### 17. docker-compose.yml version obsolete (FIXED)
**Symptom:** Warning on every docker compose command  
**Cause:** `version: '3.8'` is deprecated  
**Fix:** Remove the `version:` line from docker-compose.yml
**Status:** Fixed - version line removed

### 18. Ring auth CLI package changed
**Symptom:** Documentation shows wrong npm package  
**Fix:** Update docs to use `npx -p ring-client-api ring-auth-cli`

---

## Missing Features

### 19. Cloudflare tunnel not auto-created
**Symptom:** `setup-tunnel.sh` not run during install  
**Fix:** Add tunnel setup to install script or post-install instructions

### 20. Address autocomplete
**Symptom:** No suggestions when typing address  
**Fix:** Implement Nominatim API for address lookup

---

## Files Modified During Testing

- `/etc/lighttpd/lighttpd.conf` - Changed port 80 → 8080
- `/opt/nexus/data/config.json` - Manual PiAware and Shelly configuration
- `/opt/nexus/api/server.js` - Added unified `/api/devices` endpoints
- `/opt/nexus/dashboard/index.html` - Dynamic device rendering
- `/etc/apt/sources.list.d/flightaware-apt-repository.list` - Removed

---

## Recommended Priority for Fixes

**P0 - Critical (install blockers):**
- #1 FlightAware repo issue
- #2 Port 80 conflict

**P1 - High (core functionality):**
- #4 Discovery not saving devices
- #5, #6 Shelly discovery issues
- #10 Gen3 support

**P2 - Medium (usability):**
- #3 Address geocoding
- #15 Settings icon
- #17 docker-compose warning

**P3 - Low (nice to have):**
- #19 Tunnel auto-setup
- #20 Address autocomplete

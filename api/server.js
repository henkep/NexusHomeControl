/**
 * NEXUS Dashboard API Server
 * Dynamic configuration with auto-discovery support
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

const discovery = require('./discovery');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration file path
const CONFIG_PATH = process.env.CONFIG_PATH || '/opt/nexus/config.json';
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || '/opt/nexus/.credentials.json';

// Config schema version - increment when adding new required fields
const CONFIG_VERSION = 2;

// Default config structure - add new fields here when needed
const DEFAULT_CONFIG = {
    _version: CONFIG_VERSION,
    shelly: [],
    honeywell: [],
    ring: [],
    piaware: [],
    flightTracking: { enabled: false },
    location: {},
    // v2 additions
    scenes: [],
    settings: {
        ringSnapshotInterval: 30,
        theme: 'dark',
        temperatureUnit: 'F'
    }
};

// Deep merge: merges source into target, preserving target's existing values
function deepMerge(target, source) {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
        if (source[key] === null || source[key] === undefined) {
            continue;
        }
        
        if (Array.isArray(source[key])) {
            // Arrays: keep target's array if it exists and has items, otherwise use source
            if (!result[key] || !Array.isArray(result[key])) {
                result[key] = source[key];
            }
            // If target has items, keep them (user's devices, scenes, etc.)
        } else if (typeof source[key] === 'object') {
            // Objects: recursively merge
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else {
            // Primitives: only set if target doesn't have this key
            if (result[key] === undefined) {
                result[key] = source[key];
            }
        }
    }
    
    return result;
}

// Migrate config to latest version
function migrateConfig(config) {
    const currentVersion = config._version || 1;
    
    if (currentVersion >= CONFIG_VERSION) {
        return config; // Already up to date
    }
    
    console.log(`Migrating config from v${currentVersion} to v${CONFIG_VERSION}...`);
    
    // Merge new defaults into existing config (preserves user data)
    const migrated = deepMerge(config, DEFAULT_CONFIG);
    migrated._version = CONFIG_VERSION;
    
    // Save migrated config
    saveConfig(migrated);
    console.log('Config migration complete');
    
    return migrated;
}

// Load configuration with automatic migration
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            console.log('Loading config from:', CONFIG_PATH);
            let config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            
            // Check if migration needed
            config = migrateConfig(config);
            
            return config;
        }
        
        // First run - create default config
        console.log('No config found, creating default at:', CONFIG_PATH);
        
        // Ensure directory exists
        const configDir = require('path').dirname(CONFIG_PATH);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
        return { ...DEFAULT_CONFIG };
    } catch (e) {
        console.error('Error loading config:', e);
    }
    return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
    // Ensure version is preserved
    cfg._version = cfg._version || CONFIG_VERSION;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function loadCredentials() {
    try {
        if (fs.existsSync(CREDENTIALS_PATH)) {
            console.log('Loading credentials from:', CREDENTIALS_PATH);
            const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
            console.log('Credentials loaded:', {
                hasHoneywellEmail: !!creds.honeywellEmail,
                hasHoneywellPassword: !!creds.honeywellPassword,
                hasRingToken: !!creds.ringToken
            });
            return creds;
        }
        console.log('No credentials file found at:', CREDENTIALS_PATH);
    } catch (e) {
        console.error('Error loading credentials:', e);
    }
    return {};
}

function saveCredentials(creds) {
    console.log('Saving credentials to:', CREDENTIALS_PATH);
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

let config = loadConfig();
let credentials = loadCredentials();

console.log('Startup complete:', {
    configVersion: config._version,
    shellyCount: config.shelly?.length || 0,
    honeywellCount: config.honeywell?.length || 0,
    ringCount: config.ring?.length || 0
});

// Environment variable fallbacks
const TCC_PASSWORD = credentials.honeywellPassword || process.env.TCC_PASSWORD;
const TCC_USERNAME = credentials.honeywellEmail || process.env.TCC_USERNAME;
const RING_REFRESH_TOKEN = credentials.ringToken || process.env.RING_REFRESH_TOKEN;
const SHELLY_AUTH_KEY = credentials.shellyAuth || process.env.SHELLY_AUTH_KEY;

//=============================================================================
// SETUP WIZARD ENDPOINTS
//=============================================================================

// Serve setup wizard - ONLY if no config exists (security!)
app.get('/setup', (req, res) => {
    const configExists = fs.existsSync(CONFIG_PATH) && 
        (config.shelly?.length > 0 || config.honeywell?.length > 0 || config.ring?.length > 0);
    
    if (configExists) {
        // Config exists - redirect to dashboard settings
        return res.redirect('/?settings=open');
    }
    
    res.sendFile(path.join(__dirname, '../setup-wizard/index.html'));
});

// Check if setup is needed
app.get('/api/setup-status', (req, res) => {
    const needsSetup = !fs.existsSync(CONFIG_PATH) || 
                       (config.shelly.length === 0 && 
                        config.honeywell.length === 0 && 
                        config.ring.length === 0);
    res.json({ needsSetup, configExists: fs.existsSync(CONFIG_PATH) });
});

// Run device discovery
app.post('/api/discover', async (req, res) => {
    const { honeywellEmail, honeywellPassword, ringToken } = req.body;
    
    try {
        const results = await discovery.discoverAll({
            honeywellUsername: honeywellEmail,
            honeywellPassword: honeywellPassword,
            ringRefreshToken: ringToken
        });
        
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Discover specific device type
app.get('/api/discover/:type', async (req, res) => {
    const { type } = req.params;
    const save = req.query.save !== 'false'; // Save by default, unless ?save=false
    
    // Use current credentials (from file or env)
    const currentTccUsername = credentials.honeywellEmail || TCC_USERNAME;
    const currentTccPassword = credentials.honeywellPassword || TCC_PASSWORD;
    const currentRingToken = credentials.ringToken || RING_REFRESH_TOKEN;
    
    try {
        let results;
        switch (type) {
            case 'shelly':
                results = await discovery.discoverShelly();
                break;
            case 'honeywell':
                results = await discovery.discoverHoneywell(currentTccUsername, currentTccPassword);
                break;
            case 'ring':
                results = await discovery.discoverRing(currentRingToken);
                break;
            case 'piaware':
                results = await discovery.discoverPiAware();
                break;
            default:
                return res.status(400).json({ error: 'Unknown device type' });
        }
        
        // Auto-save discovered devices to config
        if (save && results && results.length > 0) {
            if (!config[type]) config[type] = [];
            
            // Merge: add new devices, update existing by ID
            for (const device of results) {
                const existingIndex = config[type].findIndex(d => d.id === device.id || d.id === String(device.id));
                if (existingIndex >= 0) {
                    // Update existing device, preserving user customizations
                    config[type][existingIndex] = { ...device, ...config[type][existingIndex], ...device };
                } else {
                    // Add new device
                    config[type].push(device);
                }
            }
            saveConfig(config);
            console.log(`Saved ${results.length} ${type} device(s) to config`);
        }
        
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save configuration
app.post('/api/config', (req, res) => {
    try {
        const newConfig = req.body;
        
        // Save credentials separately (more secure)
        if (newConfig.credentials) {
            saveCredentials(newConfig.credentials);
            credentials = newConfig.credentials;
            delete newConfig.credentials;
        }
        
        // Save device config
        config = newConfig;
        saveConfig(config);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current configuration
app.get('/api/config', (req, res) => {
    res.json(config);
});

//=============================================================================
// SETTINGS API (for in-dashboard configuration)
//=============================================================================

// Add a device
app.post('/api/settings/device', (req, res) => {
    const { type, device } = req.body;
    
    if (!['shelly', 'honeywell', 'ring', 'piaware'].includes(type)) {
        return res.json({ success: false, error: 'Invalid device type' });
    }
    
    if (!config[type]) config[type] = [];
    config[type].push(device);
    saveConfig(config);
    
    res.json({ success: true, config });
});

// Update a device
app.put('/api/settings/device', (req, res) => {
    const { type, id, updates } = req.body;
    
    if (!config[type]) {
        return res.json({ success: false, error: 'Device type not found' });
    }
    
    const index = config[type].findIndex(d => d.id === id || d.ip === id);
    if (index === -1) {
        return res.json({ success: false, error: 'Device not found' });
    }
    
    config[type][index] = { ...config[type][index], ...updates };
    saveConfig(config);
    
    res.json({ success: true, config });
});

// Remove a device
app.delete('/api/settings/device', (req, res) => {
    const { type, id } = req.body;
    
    if (!config[type]) {
        return res.json({ success: false, error: 'Device type not found' });
    }
    
    config[type] = config[type].filter(d => d.id !== id && d.ip !== id && String(d.id) !== String(id));
    saveConfig(config);
    
    res.json({ success: true, config });
});

// RESTful device delete endpoint
app.delete('/api/devices/:type/:id', (req, res) => {
    const { type, id } = req.params;
    
    if (!config[type]) {
        return res.status(404).json({ success: false, error: 'Device type not found' });
    }
    
    const before = config[type].length;
    config[type] = config[type].filter(d => d.id !== id && d.ip !== id && String(d.id) !== String(id));
    
    if (config[type].length === before) {
        return res.status(404).json({ success: false, error: 'Device not found' });
    }
    
    saveConfig(config);
    res.json({ success: true });
});

// Save credentials (POST for new frontend)
app.post('/api/credentials', (req, res) => {
    const { honeywellEmail, honeywellPassword, ringToken, shellyAuth } = req.body;
    
    const newCreds = { ...credentials };
    if (honeywellEmail !== undefined) newCreds.honeywellEmail = honeywellEmail;
    if (honeywellPassword !== undefined) newCreds.honeywellPassword = honeywellPassword;
    if (ringToken !== undefined) newCreds.ringToken = ringToken;
    if (shellyAuth !== undefined) newCreds.shellyAuth = shellyAuth;
    
    saveCredentials(newCreds);
    credentials = newCreds;
    
    // Clear cached API instances so they reinitialize with new creds
    ringApi = null;
    honeywellCookieJar = {};
    thermostatCache = { data: null, timestamp: 0 };
    
    res.json({ success: true });
});

// Update credentials (legacy PUT)
app.put('/api/settings/credentials', (req, res) => {
    const { honeywellEmail, honeywellPassword, ringToken, shellyAuth } = req.body;
    
    const newCreds = { ...credentials };
    if (honeywellEmail !== undefined) newCreds.honeywellEmail = honeywellEmail;
    if (honeywellPassword !== undefined) newCreds.honeywellPassword = honeywellPassword;
    if (ringToken !== undefined) newCreds.ringToken = ringToken;
    if (shellyAuth !== undefined) newCreds.shellyAuth = shellyAuth;
    
    saveCredentials(newCreds);
    credentials = newCreds;
    
    // Clear cached API instances so they reinitialize with new creds
    ringApi = null;
    honeywellCookieJar = {};
    
    res.json({ success: true, message: 'Credentials updated' });
});

// Re-run discovery for a specific type
app.post('/api/settings/rescan/:type', async (req, res) => {
    const { type } = req.params;
    
    try {
        let results;
        switch (type) {
            case 'shelly':
                results = await discovery.discoverShelly();
                break;
            case 'honeywell':
                results = await discovery.discoverHoneywell(
                    credentials.honeywellEmail || TCC_USERNAME,
                    credentials.honeywellPassword || TCC_PASSWORD
                );
                break;
            case 'ring':
                results = await discovery.discoverRing(credentials.ringToken || RING_REFRESH_TOKEN);
                break;
            case 'piaware':
                results = await discovery.discoverPiAware();
                break;
            case 'all':
                results = await discovery.discoverAll({
                    honeywellUsername: credentials.honeywellEmail || TCC_USERNAME,
                    honeywellPassword: credentials.honeywellPassword || TCC_PASSWORD,
                    ringRefreshToken: credentials.ringToken || RING_REFRESH_TOKEN
                });
                break;
            default:
                return res.json({ success: false, error: 'Unknown device type' });
        }
        
        res.json({ success: true, devices: results });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Get credential status (not the actual values!)
app.get('/api/settings/credentials/status', (req, res) => {
    const honeywellEmail = credentials.honeywellEmail || TCC_USERNAME || '';
    const honeywellConfigured = !!(credentials.honeywellPassword || TCC_PASSWORD);
    
    res.json({
        honeywell: {
            configured: honeywellConfigured,
            email: honeywellEmail
        },
        ring: !!(credentials.ringToken || RING_REFRESH_TOKEN),
        shelly: !!(credentials.shellyAuth || SHELLY_AUTH_KEY)
    });
});

// Reset config (for troubleshooting)
app.post('/api/settings/reset', (req, res) => {
    const { confirm } = req.body;
    
    if (confirm !== 'RESET') {
        return res.json({ success: false, error: 'Confirmation required' });
    }
    
    config = { shelly: [], honeywell: [], ring: [], piaware: [] };
    saveConfig(config);
    
    res.json({ success: true, message: 'Configuration reset. Visit /setup to reconfigure.' });
});

//=============================================================================
// SHELLY LOCAL API
//=============================================================================

app.get('/api/shelly/status', async (req, res) => {
    const devices = config.shelly || [];
    
    if (devices.length === 0) {
        return res.json({ success: true, devices: [] });
    }
    
    try {
        const results = await Promise.all(devices.map(async device => {
            try {
                const url = device.gen === 2 
                    ? `http://${device.ip}/rpc/Switch.GetStatus?id=0`
                    : `http://${device.ip}/relay/0`;
                    
                const resp = await fetch(url, { timeout: 2000 });
                const data = await resp.json();
                
                return {
                    ...device,
                    on: device.gen === 2 ? data.output : data.ison,
                    power: data.apower || data.power || 0,
                    online: true
                };
            } catch (err) {
                return { ...device, on: false, power: 0, online: false };
            }
        }));
        
        res.json({ success: true, devices: results });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/shelly/control', async (req, res) => {
    const { device, state } = req.body;
    const shelly = (config.shelly || []).find(d => d.id === device || d.ip === device);
    
    if (!shelly) {
        return res.json({ success: false, error: 'Device not found' });
    }
    
    try {
        const url = shelly.gen === 2
            ? `http://${shelly.ip}/rpc/Switch.Set?id=0&on=${state}`
            : `http://${shelly.ip}/relay/0?turn=${state ? 'on' : 'off'}`;
            
        await fetch(url);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/shelly/all', async (req, res) => {
    const { state } = req.body;
    const devices = config.shelly || [];
    
    try {
        await Promise.all(devices.map(device => {
            const url = device.gen === 2
                ? `http://${device.ip}/rpc/Switch.Set?id=0&on=${state}`
                : `http://${device.ip}/relay/0?turn=${state ? 'on' : 'off'}`;
            return fetch(url).catch(() => {});
        }));
        
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Control by room
app.post('/api/shelly/room/:room', async (req, res) => {
    const { room } = req.params;
    const { state } = req.body;
    const devices = (config.shelly || []).filter(d => d.room?.toLowerCase() === room.toLowerCase());
    
    if (devices.length === 0) {
        return res.json({ success: false, error: 'No devices in room' });
    }
    
    try {
        await Promise.all(devices.map(device => {
            const url = device.gen === 2
                ? `http://${device.ip}/rpc/Switch.Set?id=0&on=${state}`
                : `http://${device.ip}/relay/0?turn=${state ? 'on' : 'off'}`;
            return fetch(url).catch(() => {});
        }));
        
        res.json({ success: true, devices: devices.length });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});


//=============================================================================
// UNIFIED DEVICES API
//=============================================================================

// Get all devices with status
app.get('/api/devices', async (req, res) => {
    const devices = [];
    
    // Add Shelly devices
    for (const device of (config.shelly || [])) {
        devices.push({
            id: device.id,
            name: device.name || device.id,
            type: 'shelly',
            room: device.room || 'Unassigned',
            icon: device.icon || '💡',
            ip: device.ip,
            gen: device.gen || 1,
            capabilities: ['switch', 'power-meter']
        });
    }
    
    // Add Honeywell devices
    for (const device of (config.honeywell || [])) {
        devices.push({
            id: device.id,
            name: device.name || `Thermostat ${device.id}`,
            type: 'honeywell',
            capabilities: ['thermostat']
        });
    }
    
    // Fetch status for all devices
    const results = await Promise.all(devices.map(async device => {
        if (device.type === 'shelly') {
            try {
                const url = device.gen >= 2
                    ? `http://${device.ip}/rpc/Switch.GetStatus?id=0`
                    : `http://${device.ip}/relay/0`;
                const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
                const data = await resp.json();
                return {
                    ...device,
                    state: device.gen >= 2 ? data.output : data.ison,
                    power: data.apower || data.power || 0,
                    online: true
                };
            } catch (err) {
                return { ...device, state: false, power: 0, online: false };
            }
        }
        // Honeywell status is fetched separately via /api/thermostat
        return { ...device, online: true };
    }));
    
    res.json({ success: true, devices: results });
});

// Update device configuration (names, rooms, etc.)
app.post('/api/devices/config', (req, res) => {
    try {
        const { shelly, honeywell } = req.body;
        
        // Update Shelly devices
        if (shelly && Array.isArray(shelly)) {
            config.shelly = (config.shelly || []).map(existing => {
                const update = shelly.find(s => s.id === existing.id || s.ip === existing.ip);
                if (update) {
                    return {
                        ...existing,
                        name: update.name || existing.name,
                        room: update.room || existing.room,
                        icon: update.icon || existing.icon
                    };
                }
                return existing;
            });
        }
        
        // Update Honeywell devices
        if (honeywell && Array.isArray(honeywell)) {
            config.honeywell = (config.honeywell || []).map(existing => {
                const update = honeywell.find(h => String(h.id) === String(existing.id));
                if (update) {
                    return {
                        ...existing,
                        name: update.name || existing.name
                    };
                }
                return existing;
            });
        }
        
        saveConfig(config);
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to save config:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Control a device by ID
app.post('/api/devices/:id/control', async (req, res) => {
    const { id } = req.params;
    const { state } = req.body;
    
    // Find device in config
    const shelly = (config.shelly || []).find(d => d.id === id);
    
    if (shelly) {
        try {
            const url = shelly.gen >= 2
                ? `http://${shelly.ip}/rpc/Switch.Set?id=0&on=${state}`
                : `http://${shelly.ip}/relay/0?turn=${state ? 'on' : 'off'}`;
            await fetch(url);
            return res.json({ success: true, id, state });
        } catch (err) {
            return res.json({ success: false, error: err.message });
        }
    }
    
    // Add more device types here (kasa, wemo, etc.)
    
    res.json({ success: false, error: 'Device not found' });
});

// Control all devices in a room
app.post('/api/devices/room/:room/control', async (req, res) => {
    const { room } = req.params;
    const { state } = req.body;
    
    const shellies = (config.shelly || []).filter(d => 
        d.room?.toLowerCase() === room.toLowerCase()
    );
    
    const results = [];
    
    for (const device of shellies) {
        try {
            const url = device.gen >= 2
                ? `http://${device.ip}/rpc/Switch.Set?id=0&on=${state}`
                : `http://${device.ip}/relay/0?turn=${state ? 'on' : 'off'}`;
            await fetch(url);
            results.push({ id: device.id, success: true });
        } catch (err) {
            results.push({ id: device.id, success: false, error: err.message });
        }
    }
    
    res.json({ success: true, results });
});

// Get list of rooms
app.get('/api/rooms', (req, res) => {
    const rooms = new Set();
    
    for (const device of (config.shelly || [])) {
        if (device.room) rooms.add(device.room);
    }
    
    res.json({ success: true, rooms: Array.from(rooms) });
});

//=============================================================================
// PIAWARE LOCAL
//=============================================================================

// Test PiAware connection (for setup wizard)
app.get('/api/test-piaware', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.json({ success: false, error: 'No URL provided' });
    }
    
    try {
        const resp = await fetch(url, { timeout: 5000 });
        if (!resp.ok) {
            return res.json({ success: false, error: `HTTP ${resp.status}` });
        }
        const data = await resp.json();
        if (data.aircraft !== undefined) {
            return res.json({ success: true, aircraft: data.aircraft.length });
        }
        return res.json({ success: false, error: 'Invalid response format' });
    } catch (err) {
        return res.json({ success: false, error: err.message });
    }
});

// Get flight tracking config status
app.get('/api/flight-tracking/status', (req, res) => {
    const ft = config.flightTracking || { enabled: false };
    res.json({
        enabled: ft.enabled,
        source: ft.source || 'auto',
        url: ft.url || null,
        piaware: config.piaware || []
    });
});

app.get('/api/aircraft', async (req, res) => {
    // Check if flight tracking is enabled
    const flightConfig = config.flightTracking || { enabled: true }; // default true for backward compat
    if (flightConfig.enabled === false) {
        return res.json({ disabled: true, aircraft: [], messages: 0, now: Date.now() / 1000 });
    }
    
    // If source is 'local', only check local file
    if (flightConfig.source === 'local') {
        try {
            if (fs.existsSync('/run/dump1090-fa/aircraft.json')) {
                const data = fs.readFileSync('/run/dump1090-fa/aircraft.json', 'utf8');
                return res.json(JSON.parse(data));
            }
        } catch (e) {}
        return res.json({ aircraft: [], messages: 0, now: Date.now() / 1000, error: 'Local PiAware not found' });
    }
    
    // If source is 'remote', use the configured URL
    if (flightConfig.source === 'remote' && flightConfig.url) {
        try {
            let url = flightConfig.url;
            if (!url.includes('/data/aircraft.json')) {
                url = url.replace(/\/$/, '') + '/data/aircraft.json';
            }
            const resp = await fetch(url);
            if (resp.ok) {
                return res.json(await resp.json());
            }
        } catch (e) {}
        return res.json({ aircraft: [], messages: 0, now: Date.now() / 1000, error: 'Remote PiAware connection failed' });
    }
    
    // Default: check local file first
    try {
        if (fs.existsSync('/run/dump1090-fa/aircraft.json')) {
            const data = fs.readFileSync('/run/dump1090-fa/aircraft.json', 'utf8');
            return res.json(JSON.parse(data));
        }
    } catch (e) {}
    
    // Try configured PiAware instances
    const piawareConfig = config.piaware || [];
    for (const pi of piawareConfig) {
        try {
            const url = pi.url 
                ? (pi.url.includes('/data/aircraft.json') ? pi.url : pi.url.replace(/\/$/, '') + '/data/aircraft.json')
                : pi.path 
                    ? pi.path 
                    : `http://${pi.ip}:${pi.port || 8080}/data/aircraft.json`;
            const resp = await fetch(url);
            if (resp.ok) {
                return res.json(await resp.json());
            }
        } catch (e) {}
    }
    
    res.json({ aircraft: [], messages: 0, now: Date.now() / 1000 });
});

//=============================================================================
// HONEYWELL TCC
//=============================================================================

let honeywellCookieJar = {};

function honeywellRequest(method, path, postData) {
    return new Promise((resolve) => {
        const cookieStr = Object.keys(honeywellCookieJar)
            .map(k => `${k}=${honeywellCookieJar[k]}`)
            .join('; ');

        const options = {
            hostname: 'mytotalconnectcomfort.com',
            path: path,
            method: method,
            headers: {
                'Cookie': cookieStr,
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/html,application/xhtml+xml',
                'Origin': 'https://mytotalconnectcomfort.com',
                'Referer': 'https://mytotalconnectcomfort.com/portal/'
            }
        };

        if (method === 'POST') {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = https.request(options, (response) => {
            let body = '';
            response.on('data', chunk => body += chunk);
            response.on('end', () => {
                (response.headers['set-cookie'] || []).forEach(c => {
                    const parts = c.split(';')[0].split('=');
                    const name = parts[0];
                    const value = parts.slice(1).join('=');
                    if (value && value.length > 0) {
                        honeywellCookieJar[name] = value;
                    } else {
                        delete honeywellCookieJar[name];
                    }
                });
                resolve({ status: response.statusCode, body, location: response.headers.location });
            });
        });

        req.on('error', () => resolve({ status: 0, body: '' }));
        if (postData) req.write(postData);
        req.end();
    });
}

function parseHoneywellPage(html) {
    const result = {};
    const patterns = {
        dispTemperature: /Property\.dispTemperature,\s*([\d.]+)/,
        indoorHumidity: /Property\.indoorHumidity,\s*([\d.]+)/,
        heatSetpoint: /Property\.heatSetpoint,\s*([\d.]+)/,
        coolSetpoint: /Property\.coolSetpoint,\s*([\d.]+)/,
        outdoorTemp: /Property\.outdoorTemp,\s*([\d.]+)/,
        outdoorHumidity: /Property\.outdoorHumidity,\s*([\d.]+)/,
        systemSwitchPosition: /Property\.systemSwitchPosition,\s*(\d+)/,
        statusHeat: /Property\.statusHeat,\s*(\d+)/,
        statusCool: /Property\.statusCool,\s*(\d+)/
    };

    for (const key in patterns) {
        const match = html.match(patterns[key]);
        if (match) result[key] = parseFloat(match[1]);
    }

    const modes = ['EmHeat', 'Heat', 'Off', 'Cool', 'Auto'];
    result.mode = modes[result.systemSwitchPosition] || 'Unknown';
    
    if (result.statusHeat === 1 || result.statusHeat === 2) {
        result.status = 'Heating';
    } else if (result.statusCool === 1 || result.statusCool === 2) {
        result.status = 'Cooling';
    } else {
        result.status = 'Idle';
    }

    return result;
}

// Thermostat cache
let thermostatCache = { data: null, timestamp: 0 };
const THERMOSTAT_CACHE_MS = 30000; // Cache for 30 seconds

app.get('/api/thermostat', async (req, res) => {
    const devices = config.honeywell || [];
    
    // Use current credentials
    const currentUsername = credentials.honeywellEmail || TCC_USERNAME;
    const currentPassword = credentials.honeywellPassword || TCC_PASSWORD;
    
    if (devices.length === 0) {
        return res.json({ success: true, thermostats: [], message: 'No thermostats configured' });
    }
    
    if (!currentPassword || !currentUsername) {
        console.log('Thermostat API: Missing credentials', { 
            hasUsername: !!currentUsername, 
            hasPassword: !!currentPassword 
        });
        // Return stale cache if available
        if (thermostatCache.data) {
            return res.json({ success: true, thermostats: thermostatCache.data, stale: true });
        }
        return res.json({ success: false, error: 'Honeywell credentials not configured' });
    }
    
    // Return cached data if fresh
    const now = Date.now();
    if (thermostatCache.data && (now - thermostatCache.timestamp) < THERMOSTAT_CACHE_MS) {
        return res.json({ success: true, thermostats: thermostatCache.data, cached: true });
    }
    
    try {
        honeywellCookieJar = {};
        
        await honeywellRequest('GET', '/portal/', '');
        
        const postData = `timeOffset=300&UserName=${encodeURIComponent(currentUsername)}&Password=${encodeURIComponent(currentPassword)}&RememberMe=false`;
        const login = await honeywellRequest('POST', '/portal/', postData);
        
        if (login.location) {
            const redir = await honeywellRequest('GET', login.location, '');
            if (redir.location) await honeywellRequest('GET', redir.location, '');
        }

        const thermostats = [];
        for (const device of devices) {
            try {
                const page = await honeywellRequest('GET', `/portal/Device/Control/${device.id}`, '');
                const data = parseHoneywellPage(page.body);
                thermostats.push({
                    id: device.id,
                    name: device.name,
                    currentTemp: data.dispTemperature,
                    targetTemp: data.heatSetpoint || data.coolSetpoint,
                    humidity: data.indoorHumidity,
                    outdoorTemp: data.outdoorTemp,
                    outdoorHumidity: data.outdoorHumidity,
                    mode: data.mode,
                    status: data.status
                });
            } catch (deviceErr) {
                console.error(`Thermostat ${device.id} error:`, deviceErr.message);
                // Add placeholder for this device
                thermostats.push({
                    id: device.id,
                    name: device.name,
                    currentTemp: null,
                    targetTemp: null,
                    humidity: null,
                    mode: 'Unknown',
                    status: 'Error'
                });
            }
        }
        
        // Only cache if we got valid data
        const hasValidData = thermostats.some(t => t.currentTemp != null);
        if (hasValidData) {
            thermostatCache = { data: thermostats, timestamp: Date.now() };
        }

        res.json({ success: true, thermostats });
    } catch (err) {
        console.error('Thermostat API error:', err.message);
        // Return stale cache if available on error
        if (thermostatCache.data) {
            return res.json({ success: true, thermostats: thermostatCache.data, stale: true });
        }
        res.json({ success: false, error: err.message });
    }
});

//=============================================================================
// RING
//=============================================================================

let ringApi = null;
let snapshotCache = { data: null, timestamp: 0 };
const DEFAULT_SNAPSHOT_INTERVAL = 15000; // 15 seconds

async function getRingApi() {
    const currentToken = credentials.ringToken || RING_REFRESH_TOKEN;
    if (!ringApi && currentToken) {
        const { RingApi } = require('ring-client-api');
        ringApi = new RingApi({ refreshToken: currentToken });
    }
    return ringApi;
}

// Get Ring settings
app.get('/api/ring/settings', (req, res) => {
    const ringConfig = config.ringSettings || {};
    res.json({
        success: true,
        snapshotInterval: ringConfig.snapshotInterval || DEFAULT_SNAPSHOT_INTERVAL / 1000,
        devices: config.ring || []
    });
});

// Update Ring settings
app.post('/api/ring/settings', (req, res) => {
    const { snapshotInterval } = req.body;
    
    if (!config.ringSettings) config.ringSettings = {};
    
    if (snapshotInterval !== undefined) {
        // Clamp between 5 and 300 seconds
        config.ringSettings.snapshotInterval = Math.max(5, Math.min(300, parseInt(snapshotInterval)));
    }
    
    saveConfig(config);
    res.json({ success: true });
});

// Ring authentication - Step 1: Request 2FA code
let pendingRingAuth = null;

app.post('/api/ring/auth/request', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.json({ success: false, error: 'Email and password required' });
    }
    
    try {
        const { RingRestClient } = require('ring-client-api/rest-client');
        
        // Create rest client - this triggers 2FA code to be sent
        const restClient = new RingRestClient({ email, password });
        
        try {
            // This will fail but triggers 2FA
            await restClient.getCurrentAuth();
        } catch (authError) {
            // Expected - 2FA is required
            if (authError.message?.includes('2fa') || authError.response?.status === 412) {
                // Store client for step 2
                pendingRingAuth = { restClient, timestamp: Date.now() };
                return res.json({ success: true, message: '2FA code sent to your phone/email' });
            }
            throw authError;
        }
        
        // If we get here without 2FA, something unexpected happened
        res.json({ success: false, error: 'Unexpected response - 2FA not requested' });
    } catch (err) {
        console.error('Ring auth request error:', err);
        res.json({ success: false, error: err.message || 'Authentication failed' });
    }
});

// Ring authentication - Step 2: Verify 2FA and get token
app.post('/api/ring/auth/verify', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.json({ success: false, error: '2FA code required' });
    }
    
    if (!pendingRingAuth || Date.now() - pendingRingAuth.timestamp > 300000) {
        return res.json({ success: false, error: 'Auth session expired. Please start over.' });
    }
    
    try {
        const { restClient } = pendingRingAuth;
        
        // Get auth with 2FA code
        const auth = await restClient.getAuth(code);
        
        // Clear pending auth
        pendingRingAuth = null;
        
        // Save the refresh token
        credentials.ringToken = auth.refresh_token;
        saveCredentials(credentials);
        
        // Reset Ring API to use new token
        ringApi = null;
        
        res.json({ success: true, message: 'Ring connected successfully!' });
    } catch (err) {
        console.error('Ring auth verify error:', err);
        res.json({ success: false, error: err.message || 'Verification failed' });
    }
});

app.get('/api/ring/snapshot', async (req, res) => {
    const devices = config.ring || [];
    const currentToken = credentials.ringToken || RING_REFRESH_TOKEN;
    
    if (devices.length === 0 || !currentToken) {
        return res.json({ success: false, error: 'Ring not configured' });
    }
    
    // Get snapshot interval from config (default 15 seconds)
    const snapshotInterval = (config.settings?.ringSnapshotInterval || 15) * 1000;
    
    try {
        // Return cached snapshot if within interval
        if (snapshotCache.data && Date.now() - snapshotCache.timestamp < snapshotInterval) {
            return res.json(snapshotCache.data);
        }

        const api = await getRingApi();
        if (!api) {
            return res.json({ success: false, error: 'Ring not configured' });
        }

        // Add timeout to Ring API calls
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Ring API timeout')), 30000)
        );

        const locations = await Promise.race([api.getLocations(), timeoutPromise]);
        if (!locations || locations.length === 0) {
            return res.json({ success: false, error: 'No Ring locations found' });
        }
        
        const cameras = await locations[0].cameras;
        const doorbell = cameras.find(c => c.isDoorbot) || cameras[0];

        if (!doorbell) {
            return res.json({ success: false, error: 'No doorbell found' });
        }

        // Snapshot can be slow - add timeout
        const snapshot = await Promise.race([
            doorbell.getSnapshot(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Snapshot timeout')), 20000))
        ]);
        
        const base64 = snapshot.toString('base64');

        snapshotCache = {
            data: {
                success: true,
                snapshot: base64,
                battery: doorbell.batteryLevel,
                wifi: doorbell.data?.wifi_signal_strength
            },
            timestamp: Date.now()
        };

        res.json(snapshotCache.data);
    } catch (err) {
        console.error('Ring snapshot error:', err.message);
        
        // Return stale cache if available
        if (snapshotCache.data) {
            return res.json({ ...snapshotCache.data, stale: true });
        }
        
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/ring/devices', async (req, res) => {
    try {
        const api = await getRingApi();
        if (!api) {
            return res.json({ success: false, error: 'Ring not configured' });
        }
        
        const locations = await api.getLocations();
        const devices = [];
        
        for (const location of locations) {
            for (const camera of location.cameras) {
                devices.push({
                    id: camera.id,
                    name: camera.name,
                    type: camera.isDoorbot ? 'doorbell' : 'camera',
                    batteryLevel: camera.batteryLevel
                });
            }
        }
        
        res.json({ success: true, devices });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

//=============================================================================
// WEATHER
//=============================================================================

let weatherCache = { data: null, timestamp: 0 };

app.get('/api/weather', async (req, res) => {
    try {
        // Cache for 5 minutes
        if (weatherCache.data && Date.now() - weatherCache.timestamp < 300000) {
            return res.json(weatherCache.data);
        }

        const obsResponse = await fetch(
            'https://api.weather.gov/stations/KRDU/observations/latest',
            { headers: { 'User-Agent': 'NEXUS Dashboard' } }
        );
        const obsData = await obsResponse.json();

        const forecastResponse = await fetch(
            'https://api.weather.gov/gridpoints/RAH/73,57/forecast',
            { headers: { 'User-Agent': 'NEXUS Dashboard' } }
        );
        const forecastData = await forecastResponse.json();

        weatherCache = {
            data: {
                success: true,
                observation: obsData.properties,
                forecast: forecastData.properties?.periods || []
            },
            timestamp: Date.now()
        };

        res.json(weatherCache.data);
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

//=============================================================================
// SCENES
//=============================================================================

app.post('/api/scene/:name', async (req, res) => {
    const { name } = req.params;
    const scenes = {
        morning: { shelly: true },
        bedtime: { shelly: false },
        movie: { shelly: false },
        away: { shelly: false }
    };
    
    const scene = scenes[name.toLowerCase()];
    if (!scene) {
        return res.json({ success: false, error: 'Unknown scene' });
    }
    
    try {
        // Control Shelly devices
        if (scene.shelly !== undefined) {
            const devices = config.shelly || [];
            await Promise.all(devices.map(device => {
                const url = device.gen === 2
                    ? `http://${device.ip}/rpc/Switch.Set?id=0&on=${scene.shelly}`
                    : `http://${device.ip}/relay/0?turn=${scene.shelly ? 'on' : 'off'}`;
                return fetch(url).catch(() => {});
            }));
        }
        
        res.json({ success: true, scene: name });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

//=============================================================================
// HEALTH CHECK
//=============================================================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        config: {
            shelly: (config.shelly || []).length,
            honeywell: (config.honeywell || []).length,
            ring: (config.ring || []).length,
            piaware: (config.piaware || []).length
        }
    });
});

//=============================================================================
// SYSTEM ADMIN
//=============================================================================

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Track if multer is available
let multerAvailable = false;

// Configure multer for zip uploads (with graceful fallback if not installed)
let upload;
try {
    const multer = require('multer');
    upload = multer({ 
        dest: '/tmp/nexus-updates/',
        limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
        fileFilter: (req, file, cb) => {
            if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
                cb(null, true);
            } else {
                cb(new Error('Only .zip files are allowed'));
            }
        }
    });
    multerAvailable = true;
} catch (e) {
    console.log('Multer not installed - bootstrap mode available');
    upload = { single: () => (req, res, next) => next() };
}

// Multer error handling middleware
const handleMulterError = (err, req, res, next) => {
    if (err) {
        return res.json({ success: false, error: err.message });
    }
    next();
};

// Check system update capability
app.get('/api/system/update/status', (req, res) => {
    res.json({
        multerAvailable,
        needsBootstrap: !multerAvailable
    });
});

// Bootstrap endpoint - accepts base64 zip without multer
// This allows first-time setup to work!
app.post('/api/system/bootstrap', express.json({ limit: '50mb' }), async (req, res) => {
    const { zipData, filename } = req.body;
    
    if (!zipData) {
        return res.json({ success: false, error: 'No zip data provided' });
    }
    
    const extractDir = '/opt/nexus-project';
    let log = [];
    
    try {
        log.push(`📦 Bootstrap update: ${filename || 'update.zip'}`);
        
        // Decode base64 and write to temp file
        const zipBuffer = Buffer.from(zipData, 'base64');
        const zipPath = '/tmp/nexus-bootstrap.zip';
        fs.writeFileSync(zipPath, zipBuffer);
        log.push(`📏 Size: ${Math.round(zipBuffer.length / 1024)} KB`);
        
        // Extract zip - exclude config files to preserve user settings
        log.push('📂 Extracting update package...');
        log.push('   (preserving your config and credentials)');
        await execPromise(`unzip -o "${zipPath}" -d "${extractDir}" -x "data/config.json" "data/.credentials.json" ".credentials.json" "config.json"`, { timeout: 60000 });
        log.push('✓ Files extracted successfully');
        
        // Clean up zip
        fs.unlinkSync(zipPath);
        
        // Check for Docker socket
        let canRebuild = false;
        try {
            await execPromise('docker info', { timeout: 5000 });
            canRebuild = true;
            log.push('🐳 Docker socket available');
        } catch (e) {
            log.push('⚠️ Docker socket not available');
        }
        
        if (canRebuild) {
            log.push('🔨 Rebuilding API container...');
            log.push('   This may take a few minutes...');
            
            // Send initial response before rebuild (which will kill this process)
            res.json({ 
                success: true, 
                log: log.join('\n'),
                rebuilding: true,
                message: 'Rebuilding... page will refresh automatically'
            });
            
            // Give time for response to send, then rebuild
            setTimeout(async () => {
                try {
                    await execPromise(
                        `cd "${extractDir}" && docker compose build api && docker compose up -d`,
                        { timeout: 600000 }
                    );
                } catch (e) {
                    console.error('Rebuild error:', e);
                }
            }, 500);
            
        } else {
            log.push('');
            log.push('📋 Manual rebuild required:');
            log.push('   cd /opt/nexus && sudo docker compose build api && sudo docker compose up -d');
            
            res.json({ 
                success: true, 
                log: log.join('\n'),
                needsManualRestart: true
            });
        }
        
    } catch (err) {
        log.push(`❌ Error: ${err.message}`);
        res.json({ success: false, error: err.message, log: log.join('\n') });
    }
});

// System info endpoint
app.get('/api/system/info', async (req, res) => {
    try {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        
        const memUsage = process.memoryUsage();
        const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        
        const deviceCount = (config.shelly?.length || 0) + 
                           (config.honeywell?.length || 0) + 
                           (config.ring?.length || 0);
        
        // Try to get version from package.json or git
        let version = 'Unknown';
        try {
            const pkg = require('./package.json');
            version = pkg.version || 'Unknown';
        } catch (e) {}
        
        res.json({
            success: true,
            version: version,
            configVersion: config._version || 1,
            uptime: `${hours}h ${minutes}m`,
            memory: `${memMB} MB`,
            deviceCount: deviceCount
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// System update endpoint
app.post('/api/system/update', upload.single('update'), handleMulterError, async (req, res) => {
    if (!req.file) {
        return res.json({ success: false, error: 'No file uploaded' });
    }
    
    const zipPath = req.file.path;
    const extractDir = '/opt/nexus-project';  // Project files mounted here
    let log = [];
    let canSelfRebuild = false;
    
    try {
        log.push(`📦 Received: ${req.file.originalname}`);
        log.push(`📏 Size: ${Math.round(req.file.size / 1024)} KB`);
        
        // Check if Docker socket is available
        try {
            await execPromise('docker info', { timeout: 5000 });
            canSelfRebuild = true;
            log.push('🐳 Docker socket available');
        } catch (e) {
            log.push('⚠️ Docker socket not mounted - manual restart required');
        }
        
        // Extract zip - exclude config files to preserve user settings
        log.push('📂 Extracting update package...');
        log.push('   (preserving your config and credentials)');
        await execPromise(`unzip -o "${zipPath}" -d "${extractDir}" -x "data/config.json" "data/.credentials.json" ".credentials.json" "config.json"`, { timeout: 60000 });
        log.push('✓ Files extracted successfully');
        
        // Check if we need to rebuild the API container
        const needsRebuild = fs.existsSync(`${extractDir}/api/Dockerfile`);
        
        if (needsRebuild && canSelfRebuild) {
            log.push('🔨 Rebuilding API container...');
            try {
                // Build the API container
                await execPromise(
                    `cd "${extractDir}" && docker compose build api 2>&1`,
                    { timeout: 300000 } // 5 minute timeout for build
                );
                log.push('✓ Container rebuilt');
                log.push('✓ Restarting with new version...');
                
                // Clean up before restart
                try { fs.unlinkSync(zipPath); } catch (e) {}
                
                // Send success response before restarting
                res.json({ 
                    success: true, 
                    log: log.join('\n'),
                    restarting: true
                });
                
                // Fire off restart and exit - don't wait for it
                // Docker will restart us with the new image
                setTimeout(() => {
                    exec(`cd "${extractDir}" && docker compose up -d`, () => {});
                    // Exit after a moment to ensure restart happens
                    setTimeout(() => process.exit(0), 1000);
                }, 500);
                
                return; // Response already sent
                
            } catch (buildErr) {
                log.push(`⚠️ Build failed: ${buildErr.message.slice(0, 200)}`);
                log.push('');
                log.push('📋 Manual rebuild required:');
                log.push('   cd /opt/nexus && sudo docker compose build api && sudo docker compose up -d');
            }
        } else if (needsRebuild) {
            log.push('');
            log.push('📋 Manual steps required:');
            log.push('   cd /opt/nexus');
            log.push('   sudo docker compose build api');
            log.push('   sudo docker compose up -d');
        }
        
        // Clean up
        try { fs.unlinkSync(zipPath); } catch (e) {}
        log.push('');
        log.push('✅ Update complete!');
        
        res.json({ 
            success: true, 
            log: log.join('\n'),
            needsManualRestart: !canSelfRebuild && needsRebuild,
            needsRefresh: true
        });
        
    } catch (err) {
        log.push(`❌ Error: ${err.message}`);
        // Clean up on error
        try { fs.unlinkSync(zipPath); } catch (e) {}
        res.json({ success: false, error: err.message, log: log.join('\n') });
    }
});

// Restart API endpoint
app.post('/api/system/restart', (req, res) => {
    res.json({ success: true, message: 'Restarting...' });
    
    // Exit after sending response - Docker will restart the container
    setTimeout(() => {
        process.exit(0);
    }, 500);
});

// Clear flight cache
app.delete('/api/flights/cache', (req, res) => {
    // Clear any cached flight data (if we had a cache object)
    res.json({ success: true, message: 'Flight cache cleared' });
});

//=============================================================================
// START SERVER
//=============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    NEXUS API Server                           ║
╠═══════════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                                   ║
║  Config: ${CONFIG_PATH.padEnd(44)}║
║                                                               ║
║  Devices loaded:                                              ║
║    • Shelly:    ${String(config.shelly?.length || 0).padEnd(40)}║
║    • Honeywell: ${String(config.honeywell?.length || 0).padEnd(40)}║
║    • Ring:      ${String(config.ring?.length || 0).padEnd(40)}║
║    • PiAware:   ${String(config.piaware?.length || 0).padEnd(40)}║
╚═══════════════════════════════════════════════════════════════╝
    `);
    
    // Check if setup is needed
    if (!fs.existsSync(CONFIG_PATH) || 
        (config.shelly.length === 0 && config.honeywell.length === 0)) {
        console.log('⚠️  No devices configured. Visit /setup to run the setup wizard.\n');
    }
});

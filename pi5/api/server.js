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

// Load configuration
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading config:', e);
    }
    return { shelly: [], honeywell: [], ring: [], piaware: [] };
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadCredentials() {
    try {
        if (fs.existsSync(CREDENTIALS_PATH)) {
            return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveCredentials(creds) {
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

let config = loadConfig();
let credentials = loadCredentials();

// Environment variable fallbacks
const TCC_PASSWORD = credentials.honeywellPassword || process.env.TCC_PASSWORD;
const TCC_USERNAME = credentials.honeywellEmail || process.env.TCC_USERNAME || 'heped1973@gmail.com';
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
    
    try {
        let results;
        switch (type) {
            case 'shelly':
                results = await discovery.discoverShelly();
                break;
            case 'honeywell':
                results = await discovery.discoverHoneywell(TCC_USERNAME, TCC_PASSWORD);
                break;
            case 'ring':
                results = await discovery.discoverRing(RING_REFRESH_TOKEN);
                break;
            case 'piaware':
                results = await discovery.discoverPiAware();
                break;
            default:
                return res.status(400).json({ error: 'Unknown device type' });
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
    
    config[type] = config[type].filter(d => d.id !== id && d.ip !== id);
    saveConfig(config);
    
    res.json({ success: true, config });
});

// Update credentials
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
    res.json({
        honeywell: !!(credentials.honeywellEmail && credentials.honeywellPassword) || !!(TCC_USERNAME && TCC_PASSWORD),
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

app.get('/api/thermostat', async (req, res) => {
    const devices = config.honeywell || [];
    
    if (devices.length === 0 || !TCC_PASSWORD) {
        return res.json({ success: true, thermostats: [] });
    }
    
    try {
        honeywellCookieJar = {};
        
        await honeywellRequest('GET', '/portal/', '');
        
        const postData = `timeOffset=300&UserName=${encodeURIComponent(TCC_USERNAME)}&Password=${encodeURIComponent(TCC_PASSWORD)}&RememberMe=false`;
        const login = await honeywellRequest('POST', '/portal/', postData);
        
        if (login.location) {
            const redir = await honeywellRequest('GET', login.location, '');
            if (redir.location) await honeywellRequest('GET', redir.location, '');
        }

        const thermostats = [];
        for (const device of devices) {
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
        }

        res.json({ success: true, thermostats });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

//=============================================================================
// RING
//=============================================================================

let ringApi = null;
let snapshotCache = { data: null, timestamp: 0 };

async function getRingApi() {
    if (!ringApi && RING_REFRESH_TOKEN) {
        const { RingApi } = require('ring-client-api');
        ringApi = new RingApi({ refreshToken: RING_REFRESH_TOKEN });
    }
    return ringApi;
}

app.get('/api/ring/snapshot', async (req, res) => {
    const devices = config.ring || [];
    
    if (devices.length === 0 || !RING_REFRESH_TOKEN) {
        return res.json({ success: false, error: 'Ring not configured' });
    }
    
    try {
        // Return cached snapshot if less than 15 seconds old
        if (snapshotCache.data && Date.now() - snapshotCache.timestamp < 15000) {
            return res.json(snapshotCache.data);
        }

        const api = await getRingApi();
        if (!api) {
            return res.json({ success: false, error: 'Ring not configured' });
        }

        const locations = await api.getLocations();
        const cameras = await locations[0].cameras;
        const doorbell = cameras.find(c => c.isDoorbot) || cameras[0];

        if (!doorbell) {
            return res.json({ success: false, error: 'No doorbell found' });
        }

        const snapshot = await doorbell.getSnapshot();
        const base64 = snapshot.toString('base64');

        snapshotCache = {
            data: {
                success: true,
                snapshot: base64,
                battery: doorbell.batteryLevel,
                wifi: doorbell.data.wifi_signal_strength
            },
            timestamp: Date.now()
        };

        res.json(snapshotCache.data);
    } catch (err) {
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

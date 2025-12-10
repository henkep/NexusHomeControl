const { RingApi } = require('ring-client-api');

let ringApi = null;
let lastSnapshot = null;
let lastSnapshotTime = 0;
const SNAPSHOT_CACHE_MS = 15000; // Cache snapshot for 15 seconds

module.exports = async function (context, req) {
    const action = req.query.action || 'snapshot';
    
    try {
        // Initialize Ring API if needed
        if (!ringApi) {
            const refreshToken = process.env.RING_REFRESH_TOKEN;
            
            if (!refreshToken) {
                context.res = {
                    status: 200,
                    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                    body: { success: false, error: 'Ring not configured. Run setup first.' }
                };
                return;
            }
            
            ringApi = new RingApi({
                refreshToken: refreshToken,
                cameraStatusPollingSeconds: 20
            });
        }
        
        if (action === 'snapshot') {
            // Check cache first
            const now = Date.now();
            if (lastSnapshot && (now - lastSnapshotTime) < SNAPSHOT_CACHE_MS) {
                context.res = {
                    status: 200,
                    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                    body: { success: true, snapshot: lastSnapshot.image, battery: lastSnapshot.battery, wifi: lastSnapshot.wifi, cached: true }
                };
                return;
            }
            
            // Get cameras
            const cameras = await ringApi.getCameras();
            
            if (cameras.length === 0) {
                context.res = {
                    status: 200,
                    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                    body: { success: false, error: 'No cameras found' }
                };
                return;
            }
            
            // Get first doorbell camera
            const doorbell = cameras.find(c => c.isDoorbot) || cameras[0];
            
            // Get snapshot
            const snapshot = await doorbell.getSnapshot();
            const base64Image = snapshot.toString('base64');
            
            // Get device health
            let battery = null;
            let wifi = null;
            try {
                const health = await doorbell.getHealth();
                battery = health.battery_percentage;
                wifi = health.latest_signal_strength;
            } catch (e) {
                // Health info not available for all devices
            }
            
            // Cache the result
            lastSnapshot = { image: base64Image, battery, wifi };
            lastSnapshotTime = now;
            
            context.res = {
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                body: { success: true, snapshot: base64Image, battery, wifi }
            };
            
        } else if (action === 'devices') {
            // List devices (for debugging)
            const cameras = await ringApi.getCameras();
            const devices = cameras.map(c => ({
                name: c.name,
                id: c.id,
                type: c.deviceType,
                isDoorbot: c.isDoorbot
            }));
            
            context.res = {
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
                body: { success: true, devices }
            };
        }
        
    } catch (err) {
        context.log.error('Ring error:', err);
        
        // Clear cached API on auth errors
        if (err.message && err.message.includes('refresh token')) {
            ringApi = null;
        }
        
        context.res = {
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: { success: false, error: err.message }
        };
    }
};

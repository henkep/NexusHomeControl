const https = require('https');

module.exports = async function (context, req) {
    const callsign = req.query.callsign;
    
    if (!callsign) {
        context.res = { status: 400, body: { error: 'Missing callsign' } };
        return;
    }

    const apiKey = 'PiHFh0V2KBBgmFY7Y0ARKvmAO0PiGASa';

    return new Promise(function(resolve) {
        const options = {
            hostname: 'aeroapi.flightaware.com',
            path: '/aeroapi/flights/' + encodeURIComponent(callsign),
            method: 'GET',
            headers: { 'x-apikey': apiKey }
        };

        const request = https.request(options, function(res) {
            let body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                if (res.statusCode !== 200) {
                    context.res = {
                        status: 200,
                        headers: { 'Access-Control-Allow-Origin': '*' },
                        body: { callsign: callsign, found: false }
                    };
                    resolve();
                    return;
                }

                try {
                    const data = JSON.parse(body);
                    const flight = data.flights && data.flights[0];
                    const result = { callsign: callsign, found: false };

                    if (flight && flight.origin && flight.destination) {
                        result.found = true;
                        result.origin = { code: flight.origin.code_iata || flight.origin.code_icao };
                        result.destination = { code: flight.destination.code_iata || flight.destination.code_icao };
                        result.aircraftType = flight.aircraft_type;
                    }

                    context.res = {
                        status: 200,
                        headers: { 'Access-Control-Allow-Origin': '*' },
                        body: result
                    };
                } catch (e) {
                    context.res = {
                        status: 200,
                        headers: { 'Access-Control-Allow-Origin': '*' },
                        body: { callsign: callsign, found: false }
                    };
                }
                resolve();
            });
        });

        request.on('error', function(e) {
            context.res = {
                status: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: { callsign: callsign, found: false, error: e.message }
            };
            resolve();
        });

        request.end();
    });
};

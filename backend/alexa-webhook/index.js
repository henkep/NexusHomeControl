module.exports = async function (context, req) {
    context.log('Alexa webhook triggered');
    
    if (req.method === 'OPTIONS') {
        context.res = { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } };
        return;
    }
    
    var body = req.body || {};
    
    // Alexa Skill request
    if (body.request) {
        var alexaRequest = body.request;
        var intent = alexaRequest.intent || {};
        var slots = intent.slots || {};
        
        var command = '';
        var responseText = '';
        var shouldEnd = true;
        
        if (alexaRequest.type === 'LaunchRequest') {
            command = 'Opened Heped Home';
            responseText = 'Heped Home is ready. What would you like to do?';
            shouldEnd = false;
        } else if (alexaRequest.type === 'IntentRequest') {
            if (slots.command && slots.command.value) {
                command = slots.command.value;
                responseText = 'Got it. ' + command;
            } else {
                command = intent.name || 'Unknown intent';
                responseText = 'Command received.';
            }
        } else if (alexaRequest.type === 'SessionEndedRequest') {
            context.res = { status: 200, body: {} };
            return;
        } else {
            responseText = 'Hello from Heped Home.';
            command = alexaRequest.type;
        }
        
        var device = 'Echo Device';
        try {
            if (body.context && body.context.System && body.context.System.device) {
                device = 'Echo (' + body.context.System.device.deviceId.slice(-6) + ')';
            }
        } catch(e) {}
        
        var event = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            device: device,
            utterance: command,
            response: responseText,
            type: 'general'
        };
        
        context.bindings.signalRMessages = [{ target: 'alexaEvent', arguments: [event] }];
        
        var alexaResponse = {
            version: '1.0',
            response: {
                outputSpeech: {
                    type: 'PlainText',
                    text: responseText
                },
                shouldEndSession: shouldEnd
            }
        };
        
        if (!shouldEnd) {
            alexaResponse.response.reprompt = {
                outputSpeech: {
                    type: 'PlainText',
                    text: 'You can say a command like: turn on the lights.'
                }
            };
        }
        
        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: alexaResponse
        };
        return;
    }
    
    // Standard webhook (broadcast)
    var event = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        device: body.device || 'Test Device',
        utterance: body.message || body.utterance || 'Test',
        response: body.response || '',
        type: 'general'
    };
    
    context.bindings.signalRMessages = [{ target: 'alexaEvent', arguments: [event] }];
    context.res = { status: 200, body: { success: true } };
};

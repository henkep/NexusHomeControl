# NEXUS Backend Fix Script
# Run this from C:\Users\Henrik\Documents\NexusHomeControl\backend

Write-Host "NEXUS Backend Fix" -ForegroundColor Cyan
Write-Host "=================" -ForegroundColor Cyan

# Clean up old files
Write-Host "`nCleaning up old files..." -ForegroundColor Yellow
Remove-Item -Recurse -Force node_modules, src, package-lock.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force negotiate, alexa-webhook, broadcast -ErrorAction SilentlyContinue

# Create host.json
Write-Host "Creating host.json..." -ForegroundColor Gray
@'
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      }
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
'@ | Out-File -FilePath "host.json" -Encoding ASCII

# Create package.json (minimal - no npm dependencies needed for v3)
Write-Host "Creating package.json..." -ForegroundColor Gray
@'
{
  "name": "nexus-alexa-bridge",
  "version": "1.0.0",
  "description": "NEXUS Home Control Backend",
  "scripts": {
    "start": "func start"
  },
  "dependencies": {}
}
'@ | Out-File -FilePath "package.json" -Encoding ASCII

# Create negotiate function
Write-Host "Creating negotiate function..." -ForegroundColor Gray
New-Item -ItemType Directory -Path "negotiate" -Force | Out-Null

@'
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get", "post", "options"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    },
    {
      "type": "signalRConnectionInfo",
      "direction": "in",
      "name": "connectionInfo",
      "hubName": "nexus",
      "connectionStringSetting": "AzureSignalRConnectionString"
    }
  ]
}
'@ | Out-File -FilePath "negotiate\function.json" -Encoding ASCII

@'
module.exports = async function (context, req, connectionInfo) {
    context.log('Negotiate function triggered');
    
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        };
        return;
    }
    
    context.res = {
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: connectionInfo
    };
};
'@ | Out-File -FilePath "negotiate\index.js" -Encoding ASCII

# Create broadcast function
Write-Host "Creating broadcast function..." -ForegroundColor Gray
New-Item -ItemType Directory -Path "broadcast" -Force | Out-Null

@'
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get", "post", "options"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    },
    {
      "type": "signalR",
      "direction": "out",
      "name": "signalRMessages",
      "hubName": "nexus",
      "connectionStringSetting": "AzureSignalRConnectionString"
    }
  ]
}
'@ | Out-File -FilePath "broadcast\function.json" -Encoding ASCII

@'
module.exports = async function (context, req) {
    context.log('Broadcast function triggered');
    
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        };
        return;
    }
    
    var body = req.body || {};
    var message = body.message || body.text || 'Test broadcast';
    var device = body.device || 'Test Device';
    
    var event = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        device: device,
        utterance: message,
        response: 'Broadcast received',
        type: 'general'
    };
    
    context.log('Broadcasting event:', event);
    
    context.bindings.signalRMessages = [{
        target: 'alexaEvent',
        arguments: [event]
    }];
    
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: { success: true, message: 'Broadcast sent', event: event }
    };
};
'@ | Out-File -FilePath "broadcast\index.js" -Encoding ASCII

# Create alexa-webhook function
Write-Host "Creating alexa-webhook function..." -ForegroundColor Gray
New-Item -ItemType Directory -Path "alexa-webhook" -Force | Out-Null

@'
{
  "bindings": [
    {
      "authLevel": "function",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post", "options"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    },
    {
      "type": "signalR",
      "direction": "out",
      "name": "signalRMessages",
      "hubName": "nexus",
      "connectionStringSetting": "AzureSignalRConnectionString"
    }
  ]
}
'@ | Out-File -FilePath "alexa-webhook\function.json" -Encoding ASCII

@'
module.exports = async function (context, req) {
    context.log('Alexa webhook triggered');
    
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        };
        return;
    }
    
    var body = req.body || {};
    
    var event = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        device: body.device || body.deviceName || 'Echo Device',
        utterance: body.utterance || body.command || body.text || 'Unknown command',
        response: body.response || body.alexaResponse || '',
        type: detectType(body.utterance || body.command || body.text || ''),
        recipe: body.recipe || null
    };
    
    context.bindings.signalRMessages = [{
        target: 'alexaEvent',
        arguments: [event]
    }];
    
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: { success: true, eventId: event.id }
    };
};

function detectType(text) {
    if (!text) return 'general';
    var t = text.toLowerCase();
    if (t.includes('recipe') || t.includes('cook')) return 'recipe';
    if (t.includes('play') || t.includes('music')) return 'music';
    if (t.includes('light') || t.includes('turn')) return 'smart-home';
    return 'general';
}
'@ | Out-File -FilePath "alexa-webhook\index.js" -Encoding ASCII

Write-Host "`nFiles created!" -ForegroundColor Green
Write-Host "`nDeploying to Azure..." -ForegroundColor Yellow

# Deploy
func azure functionapp publish nexus-alexa-bridge-45799

Write-Host "`nTesting negotiate endpoint..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

try {
    $result = Invoke-RestMethod -Uri "https://nexus-alexa-bridge-45799.azurewebsites.net/api/negotiate" -Method GET
    Write-Host "SUCCESS! Negotiate returned:" -ForegroundColor Green
    $result | ConvertTo-Json
} catch {
    Write-Host "Still failing. Check Azure Portal logs." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

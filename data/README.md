# NEXUS Data Directory

This directory contains user configuration that is **preserved during updates**.

## Protected Files (never overwritten by updates)

- `config.json` - Your device configuration (Shelly names, IPs, thermostats, etc.)
- `.credentials.json` - Your saved credentials (Honeywell password, Ring tokens, etc.)

## Template Files

- `config.example.json` - Example configuration for reference

## First Run

On first run, if no `config.json` exists, the system will create an empty default configuration.
Use the Settings panel in the dashboard to configure your devices.

## Automatic Config Migration

When NEXUS updates add new features, your config is automatically migrated:

1. **Version Check**: On startup, NEXUS checks `_version` in your config
2. **Deep Merge**: New fields are added while preserving all your existing settings
3. **Auto-Save**: Migrated config is saved automatically

Example: If an update adds a new `scenes` feature, your config will get the new 
`scenes: []` field without touching your device names, rooms, or other settings.

You'll see migration logs in the API container output:
```
Migrating config from v1 to v2...
Config migration complete
```

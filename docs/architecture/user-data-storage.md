# User Data Storage Architecture

## Overview

The viewer stores user preferences, credentials, and protected data in platform-specific locations. Sensitive data like passwords and MFA tokens are encrypted.

## Key Files

- `indra/newview/llsechandler_basic.cpp` - Secure data handling
- `indra/newview/llsechandler_basic.h` - Security handler header
- `indra/newview/llmachineid.cpp` - Machine ID generation (encryption key source)
- `indra/llfilesystem/lldir.cpp` - Directory path management
- `indra/llfilesystem/lldir_win32.cpp` - Windows directory implementation

## Data Locations

### User Settings Directory

Constructed in `llappviewer.cpp`:
```cpp
#if ADDRESS_SIZE == 64
    gDirUtilp->initAppDirs(APP_NAME + "_x64");
#else
    gDirUtilp->initAppDirs(APP_NAME);
#endif
```

Where `APP_NAME` is defined in `indra/llcommon/indra_constants.h`:
```cpp
const std::string APP_NAME = "Firestorm";
```

### Platform Paths

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\Firestorm_x64\` |
| macOS | `~/Library/Application Support/Firestorm_x64/` |
| Linux | `~/.firestorm_x64/` |

### Subdirectories

- `user_settings/` - Settings and credentials
- `logs/` - Log files
- `cache/` - Texture and asset cache
- `browser_profile/` - Embedded browser data

## Protected Data File

### Location
`user_settings/bin_conf.dat`

### Contents
- Saved passwords
- MFA token hashes
- Credential data

### Initialization
In `llsechandler_basic.cpp`:
```cpp
mProtectedDataFilename = gDirUtilp->getExpandedFilename(
    LL_PATH_USER_SETTINGS, "bin_conf.dat");
mLegacyPasswordPath = gDirUtilp->getExpandedFilename(
    LL_PATH_USER_SETTINGS, "password.dat");
```

## Encryption

### Key Derivation
The encryption key is derived from `LLMachineID`, which is based on:
- Hardware identifiers
- OS-specific machine IDs
- MAC address (fallback)

### Algorithm
- AES encryption
- Salt stored with data
- Machine-specific (can't transfer between computers)

### Decryption Flow
In `llsechandler_basic.cpp` around line 1341-1375:
```cpp
// Read encrypted data
// Extract salt
// Derive key from machine ID + salt
// Decrypt using AES
```

## Legacy Password File

### Location
`user_settings/password.dat`

### Purpose
Older format for storing passwords, still checked for backward compatibility.

## Settings Files

### Main Settings
- `settings.xml` - General viewer settings
- `settings_per_account.xml` - Per-account settings
- `colors.xml` - UI colors

### Grid-Specific
- `grids.xml` - Custom grid definitions

## Changing APP_NAME

To use a different data directory:

1. Edit `indra/llcommon/indra_constants.h`:
```cpp
const std::string APP_NAME = "MyViewer";
```

2. Result: Data stored in `MyViewer_x64\` instead of `Firestorm_x64\`

**Note**: Changing APP_NAME means:
- Fresh settings (no migration from Firestorm)
- Separate credential storage
- Separate cache

## Directory Utility Methods

Key methods in `LLDir`:
```cpp
getExpandedFilename(LL_PATH_USER_SETTINGS, "file.dat")  // User settings
getExpandedFilename(LL_PATH_CACHE, "file.dat")          // Cache
getExpandedFilename(LL_PATH_LOGS, "file.log")           // Logs
getOSUserAppDir()                                        // Base app directory
```

## Security Considerations

1. **Machine-Bound Encryption**: Credentials can't be copied to another machine
2. **No Plain Text**: Passwords never stored in plain text
3. **Per-Account Separation**: Each account can have separate settings
4. **Legacy Migration**: Old password.dat automatically migrated to bin_conf.dat

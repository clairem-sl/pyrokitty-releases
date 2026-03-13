# Login System Architecture

## Overview

The login system handles authentication with Second Life/OpenSim servers, including version checking, TOS acceptance, and MFA challenges.

## Key Files

- `firestorm/indra/newview/lllogininstance.cpp` - Main login orchestration
- `firestorm/indra/newview/lllogininstance.h` - Login instance header
- `firestorm/indra/newview/llstartup.cpp` - Startup state machine
- `firestorm/indra/viewer_components/login/lllogin.cpp` - Low-level login handling

## Login Request Parameters

Sent to the login server in `lllogininstance.cpp`:

```cpp
request_params["version"] = LLVersionInfo::instance().getVersion();
request_params["channel"] = LLVersionInfo::instance().getChannel();
request_params["platform"] = mPlatform;
request_params["platform_version"] = mPlatformVersion;
request_params["mac"] = hashed_unique_id_string;
request_params["id0"] = mSerialNumber;
// ... credentials added separately
```

## Version Checking

### Server-Side Enforcement

The login server (login.cgi) compares the viewer version against allowed versions. If too old, it returns:
```
reason_response == "update"
```

### Client Handling

In `lllogininstance.cpp` around line 423:
```cpp
else if(reason_response == "update")
{
    std::string login_version = response["message_args"]["VERSION"];
    // Shows RequiredUpdate or PauseForUpdate notification
    LLNotificationsUtil::add("RequiredUpdate", args, ...);
}
```

### Bypassing Version Check

Option 1: Don't send version at all
```cpp
// Comment out in lllogininstance.cpp:
//request_params["version"] = LLVersionInfo::instance().getVersion();
//request_params["channel"] = LLVersionInfo::instance().getChannel();
```

## Login Flow

1. **STATE_LOGIN_SHOW** - Display login UI
2. **STATE_LOGIN_WAIT** - Wait for user input
3. **STATE_LOGIN_AUTHENTICATE** - Send credentials to server
4. **STATE_LOGIN_NO_DATA_YET** - Waiting for response
5. **STATE_LOGIN_DOWNLOADING** - Receiving login data
6. **STATE_LOGIN_PROCESS_RESPONSE** - Handle response
7. **STATE_WORLD_INIT** - Initialize world (on success)

## Login Response Handling

| Reason | Meaning | Handler |
|--------|---------|---------|
| `"login"` | Success | `handleLoginSuccess()` |
| `"disconnect"` | Connection failed | `handleDisconnect()` |
| `"update"` | Version too old | Shows update dialog |
| `"mfa_challenge"` | MFA required | `showMFAChallenge()` |
| `"tos"` | TOS acceptance needed | Shows TOS dialog |
| `"key"` | Critical message | `handleLoginFailure()` |

## Updater Integration

The viewer can coordinate with an external updater:
```cpp
mRequestData["wait_for_updater"] = false;  // Disabled by default
```

When update is required:
```cpp
LLSD updater = response["updater"];
// Updater provides VERSION and URL for release notes
```

## Grid Selection

Login can target different grids:
- Second Life main grid
- Second Life beta grids
- OpenSim grids

Grid detection:
```cpp
LLGridManager::getInstance()->isInSecondLife()
LLGridManager::getInstance()->isInSLBeta()
LLGridManager::getInstance()->isInOpenSim()
```

## Error Messages

Defined in `skins/default/xui/en/strings.xml`:
- `LoginFailedAccountDisabled`
- `LoginFailedTransformError`
- `RequiredUpdate`
- `PauseForUpdate`

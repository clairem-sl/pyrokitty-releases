/**
 * @file   pkloginhandoff.h
 * @brief  Login handoff API for external login via PyroKitty
 *
 * $LicenseInfo:firstyear=2025&license=viewerlgpl$
 * Copyright (C) 2025, Pyrokitty
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation;
 * version 2.1 of the License only.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 * $/LicenseInfo$
 */

#ifndef PK_LOGINHANDOFF_H
#define PK_LOGINHANDOFF_H

#include "lleventapi.h"
#include <atomic>

/**
 * PKLoginHandoff provides an event API for external login session injection.
 *
 * This allows PyroKitty (the Electron UI) to perform login/teleport externally
 * and hand off the session to the viewer, which then connects directly to the
 * simulator without showing its own login UI.
 *
 * Flow:
 * 1. PyroKitty logs in via node_metaverse
 * 2. PyroKitty initiates teleport to destination region
 * 3. PyroKitty captures TeleportFinish data (sim IP, port, seed capability, etc.)
 * 4. PyroKitty launches viewer with --external-login flag
 * 5. Viewer starts WebSocket server and waits for session data
 * 6. PyroKitty sends session_handoff message via WebSocket
 * 7. Viewer populates globals and connects to destination simulator
 *
 * WebSocket Message Format:
 * {
 *   "pump": "PKLoginHandoff",
 *   "data": {
 *     "op": "session_handoff",
 *     "agent_id": "uuid-string",
 *     "session_id": "uuid-string",
 *     "secure_session_id": "uuid-string",
 *     "circuit_code": 12345,
 *     "sim_ip": "1.2.3.4",
 *     "sim_port": 13000,
 *     "region_handle": "12345678901234567890",  // 64-bit as string
 *     "seed_capability": "https://simhost.../cap/uuid",
 *     "first_name": "FirstName",
 *     "last_name": "Resident"
 *   }
 * }
 */
class PKLoginHandoff : public LLEventAPI
{
public:
    PKLoginHandoff();
    ~PKLoginHandoff();

public:
    /**
     * Check if we're in external login mode (--external-login flag was used).
     */
    static bool isExternalLoginMode();

    /**
     * Set external login mode. Called during startup if --external-login is present.
     */
    static void setExternalLoginMode(bool enabled);

    /**
     * Check if a session handoff has been received and is ready to use.
     */
    static bool hasSessionData();

    /**
     * Get the startup state to jump to after session injection.
     * Call this after hasSessionData() returns true.
     */
    static int getTargetStartupState();

private:
    /**
     * Handle session_handoff operation - inject session data from PyroKitty.
     */
    void sessionHandoff(const LLSD& data);

    /**
     * Handle get_status operation - return current handoff state.
     */
    void getStatus(const LLSD& data);

    static bool sExternalLoginMode;
    static std::atomic<bool> sHasSessionData;  // Thread-safe for WebSocket callback
};

#endif // PK_LOGINHANDOFF_H

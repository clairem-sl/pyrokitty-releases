/**
 * @file   pkloginhandoff.cpp
 * @brief  Implementation of login handoff API for external login via PyroKitty
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

#include "llviewerprecompiledheaders.h"
#include "pkloginhandoff.h"

#include "llagent.h"
#include "llagentdata.h"
#include "llappviewer.h"
#include "llhost.h"
#include "llstartup.h"
#include "llworld.h"
#include "llviewerparcelmgr.h"
#include "message.h"

bool PKLoginHandoff::sExternalLoginMode = false;
std::atomic<bool> PKLoginHandoff::sHasSessionData(false);
std::atomic<bool> PKLoginHandoff::sSessionContinuation(false);
std::atomic<U32> PKLoginHandoff::sInitialSequenceNumber(0);

// Session data storage (populated by handoff, consumed by startup)
namespace
{
    LLSD sSessionData;
}

PKLoginHandoff::PKLoginHandoff()
    : LLEventAPI("PKLoginHandoff",
                 "Login session handoff from PyroKitty external login")
{
    add("session_handoff",
        "Inject session data from external login (PyroKitty).\n"
        "[\"agent_id\"] UUID of agent [required]\n"
        "[\"session_id\"] Session UUID [required]\n"
        "[\"secure_session_id\"] Secure session UUID [required]\n"
        "[\"circuit_code\"] Circuit code integer [required]\n"
        "[\"sim_ip\"] Destination sim IP [required]\n"
        "[\"sim_port\"] Destination sim port [required]\n"
        "[\"seed_capability\"] Seed capability URL [required]\n"
        "[\"region_handle\"] Region handle as string [optional]\n"
        "[\"first_name\"] Avatar first name [optional]\n"
        "[\"last_name\"] Avatar last name [optional]",
        &PKLoginHandoff::sessionHandoff);

    add("get_status",
        "Get current handoff status.\n"
        "[\"reply\"] pump name to receive status on [required]",
        &PKLoginHandoff::getStatus);

    LL_INFOS("PKLoginHandoff") << "PKLoginHandoff API initialized" << LL_ENDL;
}

PKLoginHandoff::~PKLoginHandoff()
{
}

bool PKLoginHandoff::isExternalLoginMode()
{
    return sExternalLoginMode;
}

void PKLoginHandoff::setExternalLoginMode(bool enabled)
{
    sExternalLoginMode = enabled;
    LL_INFOS("PKLoginHandoff") << "External login mode: " << (enabled ? "enabled" : "disabled") << LL_ENDL;
}

bool PKLoginHandoff::hasSessionData()
{
    return sHasSessionData;
}

bool PKLoginHandoff::isSessionContinuation()
{
    return sSessionContinuation;
}

U32 PKLoginHandoff::getInitialSequenceNumber()
{
    return sInitialSequenceNumber;
}

int PKLoginHandoff::getTargetStartupState()
{
    // Return STATE_WORLD_INIT since we have all the data needed to skip login
    return static_cast<int>(STATE_WORLD_INIT);
}

void PKLoginHandoff::sessionHandoff(const LLSD& data)
{
    LL_INFOS("PKLoginHandoff") << "Received session handoff data" << LL_ENDL;

    // Validate required fields
    if (!data.has("agent_id") || !data.has("session_id") ||
        !data.has("secure_session_id") || !data.has("circuit_code") ||
        !data.has("sim_ip") || !data.has("sim_port") ||
        !data.has("seed_capability"))
    {
        LL_WARNS("PKLoginHandoff") << "Missing required session data fields" << LL_ENDL;

        // Send error response
        if (data.has("reply"))
        {
            LLSD response;
            response["success"] = false;
            response["error"] = "Missing required fields";
            LLEventPumps::instance().obtain(data["reply"].asString()).post(response);
        }
        return;
    }

    // Store the session data
    sSessionData = data;

    // Set global agent ID
    gAgentID.set(data["agent_id"].asString());
    LL_INFOS("PKLoginHandoff") << "Set agent ID: " << gAgentID << LL_ENDL;

    // Set session IDs
    gAgentSessionID.set(data["session_id"].asString());
    gAgent.mSecureSessionID.set(data["secure_session_id"].asString());
    LL_INFOS("PKLoginHandoff") << "Set session IDs" << LL_ENDL;

    // Note: Don't set gMessageSystem->mOurCircuitCode here - gMessageSystem
    // isn't initialized yet. The circuit code is stored in sSessionData and
    // will be applied during STATE_EXTERNAL_LOGIN_WAIT when the messaging
    // system is ready.
    LL_INFOS("PKLoginHandoff") << "Circuit code stored: " << data["circuit_code"].asInteger() << LL_ENDL;

    // Set name if provided
    if (data.has("first_name"))
    {
        std::string firstName = data["first_name"].asString();
        std::string lastName = data.has("last_name") ? data["last_name"].asString() : "Resident";

        gAgentUsername = firstName;
        if (lastName != "Resident")
        {
            gAgentUsername += " " + lastName;
        }
        // Note: gDisplayName is static in llstartup.cpp and will be set during STATE_WORLD_INIT
        LL_INFOS("PKLoginHandoff") << "Set username: " << gAgentUsername << LL_ENDL;
    }

    // Check for session continuation mode (same-region handoff)
    if (data.has("session_continuation") && data["session_continuation"].asBoolean())
    {
        sSessionContinuation = true;
        LL_INFOS("PKLoginHandoff") << "Session continuation mode enabled" << LL_ENDL;

        // Get the sequence number to continue from
        if (data.has("sequence_number"))
        {
            sInitialSequenceNumber = data["sequence_number"].asInteger();
            LL_INFOS("PKLoginHandoff") << "Initial sequence number: " << sInitialSequenceNumber << LL_ENDL;
        }
        else
        {
            LL_WARNS("PKLoginHandoff") << "Session continuation without sequence_number!" << LL_ENDL;
        }
    }
    else
    {
        sSessionContinuation = false;
        sInitialSequenceNumber = 0;
    }

    // Mark that we have valid session data
    sHasSessionData = true;

    // Send success response
    if (data.has("reply"))
    {
        LLSD response;
        response["success"] = true;
        response["agent_id"] = gAgentID.asString();
        response["status"] = "session_received";
        LLEventPumps::instance().obtain(data["reply"].asString()).post(response);
    }

    LL_INFOS("PKLoginHandoff") << "Session handoff complete, ready for startup" << LL_ENDL;
}

void PKLoginHandoff::getStatus(const LLSD& data)
{
    LLSD response;
    response["external_login_mode"] = sExternalLoginMode;
    response["has_session_data"] = sHasSessionData;
    response["agent_id"] = gAgentID.asString();

    if (data.has("reply"))
    {
        LLEventPumps::instance().obtain(data["reply"].asString()).post(response);
    }
}

// Helper function to get session data for startup
LLSD PKLoginHandoff_GetSessionData()
{
    return sSessionData;
}

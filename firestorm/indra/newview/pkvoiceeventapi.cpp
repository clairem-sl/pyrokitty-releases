/**
 * @file   pkvoiceeventapi.cpp
 * @brief  Implementation of PKVoiceEventAPI for external voice sidecar
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

#include "pkvoiceeventapi.h"

#include "llagent.h"
#include "llevents.h"
#include "llviewerregion.h"
#include "llviewerparcelmgr.h"
#include "llparcel.h"

// Position update interval in seconds
static const F32 POSITION_UPDATE_INTERVAL = 0.1f;

PKVoiceEventAPI::PKVoiceEventAPI()
    : LLEventAPI("VoiceAPI",
                 "API for external voice sidecar.\n"
                 "Provides voice capability URLs and avatar position/rotation data.")
    , mPositionTimer(nullptr)
{
    add("getCaps",
        "Get voice capability URLs for the current region.\n"
        "Returns ProvisionVoiceAccountRequest, VoiceSignalingRequest, ParcelVoiceInfoRequest URLs.\n"
        "Also returns agentId, sessionId, regionName, and parcelLocalId.",
        &PKVoiceEventAPI::getCaps);

    add("subscribePosition",
        "Start receiving periodic position/rotation updates.\n"
        "[\"reply\"] pump name to receive position updates on [required]\n"
        "[\"interval\"] update interval in seconds [default=0.1]",
        &PKVoiceEventAPI::subscribePosition);

    add("unsubscribePosition",
        "Stop receiving position updates.",
        &PKVoiceEventAPI::unsubscribePosition);
}

PKVoiceEventAPI::~PKVoiceEventAPI()
{
    if (mPositionTimer)
    {
        delete mPositionTimer;
        mPositionTimer = nullptr;
    }
}

void PKVoiceEventAPI::getCaps(const LLSD& request)
{
    Response response(LLSD(), request);

    LLViewerRegion* region = gAgent.getRegion();
    if (!region)
    {
        return response.error("Not connected to a region");
    }

    LLSD caps;
    std::string provisionCap = region->getCapability("ProvisionVoiceAccountRequest");
    std::string signalingCap = region->getCapability("VoiceSignalingRequest");
    std::string parcelInfoCap = region->getCapability("ParcelVoiceInfoRequest");

    if (!provisionCap.empty())
        caps["ProvisionVoiceAccountRequest"] = provisionCap;
    if (!signalingCap.empty())
        caps["VoiceSignalingRequest"] = signalingCap;
    if (!parcelInfoCap.empty())
        caps["ParcelVoiceInfoRequest"] = parcelInfoCap;

    response["caps"] = caps;
    response["agentId"] = gAgent.getID().asString();
    response["sessionId"] = gAgent.getSessionID().asString();
    response["regionName"] = region->getName();

    // Parcel local ID
    LLParcel* parcel = LLViewerParcelMgr::getInstance()->getAgentParcel();
    response["parcelLocalId"] = parcel ? parcel->getLocalID() : -1;

    // Current position and rotation for immediate use
    LLVector3d globalPos = gAgent.getPositionGlobal();
    LLQuaternion rot = gAgent.getFrameAgent().getQuaternion();

    LLSD position;
    position.append(globalPos.mdV[VX]);
    position.append(globalPos.mdV[VY]);
    position.append(globalPos.mdV[VZ]);
    response["position"] = position;

    LLSD rotation;
    rotation.append(rot.mQ[VX]);
    rotation.append(rot.mQ[VY]);
    rotation.append(rot.mQ[VZ]);
    rotation.append(rot.mQ[VW]);
    response["rotation"] = rotation;
}

void PKVoiceEventAPI::subscribePosition(const LLSD& request)
{
    Response response(LLSD(), request);

    if (!request.has("reply"))
    {
        return response.error("'reply' pump name is required");
    }

    mPositionReplyPump = request["reply"].asString();

    F32 interval = POSITION_UPDATE_INTERVAL;
    if (request.has("interval"))
    {
        interval = (F32)request["interval"].asReal();
        if (interval < 0.05f) interval = 0.05f;  // Min 50ms
        if (interval > 5.0f) interval = 5.0f;    // Max 5s
    }

    // Stop existing timer if any
    if (mPositionTimer)
    {
        delete mPositionTimer;
        mPositionTimer = nullptr;
    }

    mPositionTimer = new PositionTimer(this, interval);

    response["success"] = true;
    response["interval"] = interval;

    LL_INFOS("PKVoiceEventAPI") << "Position subscription started, interval=" << interval << "s" << LL_ENDL;
}

void PKVoiceEventAPI::unsubscribePosition(const LLSD& request)
{
    Response response(LLSD(), request);

    if (mPositionTimer)
    {
        delete mPositionTimer;
        mPositionTimer = nullptr;
    }

    mPositionReplyPump.clear();
    response["success"] = true;

    LL_INFOS("PKVoiceEventAPI") << "Position subscription stopped" << LL_ENDL;
}

void PKVoiceEventAPI::sendPositionUpdate()
{
    if (mPositionReplyPump.empty()) return;

    LLViewerRegion* region = gAgent.getRegion();
    if (!region) return;

    LLVector3d globalPos = gAgent.getPositionGlobal();
    LLQuaternion rot = gAgent.getFrameAgent().getQuaternion();

    LLSD event;
    event["type"] = "positionUpdate";

    LLSD position;
    position.append(globalPos.mdV[VX]);
    position.append(globalPos.mdV[VY]);
    position.append(globalPos.mdV[VZ]);
    event["position"] = position;

    LLSD rotation;
    rotation.append(rot.mQ[VX]);
    rotation.append(rot.mQ[VY]);
    rotation.append(rot.mQ[VZ]);
    rotation.append(rot.mQ[VW]);
    event["rotation"] = rotation;

    event["regionName"] = region->getName();

    LLParcel* parcel = LLViewerParcelMgr::getInstance()->getAgentParcel();
    event["parcelLocalId"] = parcel ? parcel->getLocalID() : -1;

    LLEventPumps::instance().obtain(mPositionReplyPump).post(event);
}

// PositionTimer implementation
PKVoiceEventAPI::PositionTimer::PositionTimer(PKVoiceEventAPI* api, F32 period)
    : LLEventTimer(period)
    , mAPI(api)
{
}

bool PKVoiceEventAPI::PositionTimer::tick()
{
    if (mAPI)
    {
        mAPI->sendPositionUpdate();
    }
    return false;  // Return false to keep the timer running
}

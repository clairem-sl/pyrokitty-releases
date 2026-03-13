/**
 * @file   pkvoiceeventapi.h
 * @brief  PKVoiceEventAPI class for exposing voice caps and position to external sidecar
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

#ifndef PK_PKVOICEEVENTAPI_H
#define PK_PKVOICEEVENTAPI_H

#include "lleventapi.h"
#include "lleventtimer.h"

class LLSD;

/**
 * PKVoiceEventAPI provides voice capability and position data to the external
 * voice sidecar process via the WebSocket connection.
 *
 * Pump name: "VoiceAPI"
 *
 * Operations:
 * - getCaps: Returns voice capability URLs for the current region
 * - subscribePosition: Starts periodic position/rotation/parcel updates
 * - unsubscribePosition: Stops position updates
 */
class PKVoiceEventAPI : public LLEventAPI
{
public:
    PKVoiceEventAPI();
    ~PKVoiceEventAPI();

private:
    // API Operations
    void getCaps(const LLSD& request);
    void subscribePosition(const LLSD& request);
    void unsubscribePosition(const LLSD& request);

    // Position update timer
    class PositionTimer : public LLEventTimer
    {
    public:
        PositionTimer(PKVoiceEventAPI* api, F32 period);
        bool tick() override;
    private:
        PKVoiceEventAPI* mAPI;
    };

    void sendPositionUpdate();

    std::string mPositionReplyPump;
    PositionTimer* mPositionTimer;
};

#endif // PK_PKVOICEEVENTAPI_H

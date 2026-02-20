/**
 * @file   pkchateventapi.h
 * @brief  PKChatEventAPI class for external chat plugin support via LEAP
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

#ifndef PK_PKCHATEVENTAPI_H
#define PK_PKCHATEVENTAPI_H

#include "lleventapi.h"
#include <boost/signals2.hpp>

class LLSD;

/**
 * PKChatEventAPI provides an event API for external chat applications.
 *
 * This allows external applications (like Electron apps) to:
 * - Receive all chat messages (nearby and IM)
 * - Send instant messages
 * - Control native chat UI visibility
 *
 * Pump name: "ChatAPI"
 *
 * Operations:
 * - subscribe: Start receiving chat events
 * - sendNearby: Send nearby chat (whisper/normal/shout)
 * - sendIM: Send an instant message (creates session if needed)
 * - setVisible: Show/hide native chat UI
 * - requestQuit: Request the viewer to quit gracefully
 */
class PKChatEventAPI : public LLEventAPI
{
public:
    PKChatEventAPI();
    ~PKChatEventAPI();

private:
    // API Operations
    void subscribe(const LLSD& request);
    void sendNearby(const LLSD& request);
    void sendIM(const LLSD& request);
    void setVisible(const LLSD& request);
    void requestQuit(const LLSD& request);
    void getMapData(const LLSD& request);

    // Internal handlers for chat signals
    void onNearbyChat(const LLSD& chat);
    void onIMMessage(const LLSD& msg);

    // Signal connections
    boost::signals2::scoped_connection mNearbyChatConnection;
    boost::signals2::scoped_connection mIMConnection;

    // The pump to send events to (set by subscribe)
    std::string mReplyPump;
    bool mSubscribedNearby;
    bool mSubscribedIM;

    // Throttle for nearby chat
    F64 mLastNearbyThrottleTime;
};

#endif // PK_PKCHATEVENTAPI_H

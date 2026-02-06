/**
 * @file   pkchateventapi.cpp
 * @brief  Implementation of PKChatEventAPI for external chat plugin support
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

#include "pkchateventapi.h"

#include "llagent.h"
#include "llagentui.h"
#include "llevents.h"
#include "llfloaterreg.h"
#include "llimview.h"
#include "llnotificationmanager.h"
#include "llfloaterimnearbychathandler.h"
#include "llviewermessage.h"
#include "fsnearbychathub.h"
#include "llchat.h"
#include "llviewercontrol.h"

static const F64 CHAT_THROTTLE_PERIOD = 1.0;

// Note: Instance is created in llappviewer.cpp after core systems initialize

PKChatEventAPI::PKChatEventAPI()
    : LLEventAPI("ChatAPI",
                 "API for external chat applications.\n"
                 "Allows receiving chat events, sending IMs, and controlling chat UI visibility.")
    , mSubscribedNearby(false)
    , mSubscribedIM(false)
    , mLastNearbyThrottleTime(0.0)
{
    add("subscribe",
        "Subscribe to chat events.\n"
        "[\"reply\"] pump name to receive events on [required]\n"
        "[\"events\"] which events to subscribe to: \"nearby\", \"im\", or \"all\" [default=\"all\"]\n"
        "Returns list of active IM sessions.",
        &PKChatEventAPI::subscribe);

    add("sendNearby",
        "Send nearby chat.\n"
        "[\"message\"] chat message text [required]\n"
        "[\"channel\"] chat channel number [default=0]\n"
        "[\"type\"] chat type: \"whisper\", \"normal\", \"shout\" [default=\"normal\"]",
        &PKChatEventAPI::sendNearby);

    add("sendIM",
        "Send an instant message. Creates session if needed.\n"
        "[\"participant_id\"] UUID of avatar to send to [required for P2P]\n"
        "[\"group_id\"] UUID of group to send to [required for group chat]\n"
        "[\"message\"] text message to send [required]",
        &PKChatEventAPI::sendIM);

    add("setVisible",
        "Control visibility of native chat UI.\n"
        "[\"visible\"] boolean to show (true) or hide (false) chat floaters [required]",
        &PKChatEventAPI::setVisible);
}

PKChatEventAPI::~PKChatEventAPI()
{
    // Connections are automatically disconnected by scoped_connection destructor
}

void PKChatEventAPI::subscribe(const LLSD& request)
{
    Response response(LLSD(), request);

    if (!request.has("reply"))
    {
        return response.error("'reply' pump name is required");
    }

    mReplyPump = request["reply"].asString();

    std::string events = "all";
    if (request.has("events"))
    {
        events = request["events"].asString();
    }

    bool subscribeNearby = (events == "all" || events == "nearby");
    bool subscribeIM = (events == "all" || events == "im");

    // Subscribe to nearby chat
    if (subscribeNearby && !mSubscribedNearby)
    {
        auto chatHandler = LLNotificationsUI::LLNotificationManager::instance().getChatHandler();
        if (chatHandler)
        {
            mNearbyChatConnection = chatHandler->addNewChatCallback(
                boost::bind(&PKChatEventAPI::onNearbyChat, this, _1));
            mSubscribedNearby = true;
            LL_INFOS("PKChatEventAPI") << "Subscribed to nearby chat events" << LL_ENDL;
        }
        else
        {
            response.warn("Could not get nearby chat handler");
        }
    }

    // Subscribe to IM
    if (subscribeIM && !mSubscribedIM)
    {
        mIMConnection = LLIMModel::instance().addNewMsgCallback(
            boost::bind(&PKChatEventAPI::onIMMessage, this, _1));
        mSubscribedIM = true;
        LL_INFOS("PKChatEventAPI") << "Subscribed to IM events" << LL_ENDL;
    }

    // Build list of active sessions
    LLSD sessions = LLSD::emptyArray();
    for (const auto& pair : LLIMModel::instance().mId2SessionMap)
    {
        LLIMModel::LLIMSession* session = pair.second;
        if (session)
        {
            LLSD sessionInfo;
            sessionInfo["session_id"] = session->mSessionID;
            sessionInfo["name"] = session->mName;
            sessionInfo["participant_id"] = session->mOtherParticipantID;

            switch (session->mSessionType)
            {
                case LLIMModel::LLIMSession::P2P_SESSION:
                    sessionInfo["type"] = "p2p";
                    break;
                case LLIMModel::LLIMSession::GROUP_SESSION:
                    sessionInfo["type"] = "group";
                    break;
                case LLIMModel::LLIMSession::ADHOC_SESSION:
                    sessionInfo["type"] = "adhoc";
                    break;
                default:
                    sessionInfo["type"] = "unknown";
                    break;
            }

            sessions.append(sessionInfo);
        }
    }

    response["subscribed_nearby"] = mSubscribedNearby;
    response["subscribed_im"] = mSubscribedIM;
    response["sessions"] = sessions;
}

void PKChatEventAPI::sendNearby(const LLSD& request)
{
    Response response(LLSD(), request);

    // Throttle to prevent spam
    F64 cur_time = LLTimer::getElapsedSeconds();
    if (cur_time < mLastNearbyThrottleTime + CHAT_THROTTLE_PERIOD)
    {
        return response.error("Chat throttled - please wait");
    }
    mLastNearbyThrottleTime = cur_time;

    if (!request.has("message"))
    {
        return response.error("'message' is required");
    }

    std::string message = request["message"].asString();

    // Get channel (default 0)
    S32 channel = 0;
    if (request.has("channel"))
    {
        channel = request["channel"].asInteger();
        if (channel < 0 || channel >= CHAT_CHANNEL_DEBUG)
        {
            channel = 0;
        }
    }

    // Get chat type (default normal)
    EChatType chat_type = CHAT_TYPE_NORMAL;
    if (request.has("type"))
    {
        std::string type_str = request["type"].asString();
        if (type_str == "whisper")
        {
            chat_type = CHAT_TYPE_WHISPER;
        }
        else if (type_str == "shout")
        {
            chat_type = CHAT_TYPE_SHOUT;
        }
    }

    // Prepend channel number if non-zero
    if (channel != 0)
    {
        message = llformat("/%d %s", channel, message.c_str());
    }

    // Send the chat
    bool animate = (channel == 0) && gSavedSettings.getBOOL("PlayChatAnim");
    FSNearbyChat::instance().sendChatFromViewer(message, chat_type, animate);

    response["success"] = true;
}

void PKChatEventAPI::sendIM(const LLSD& request)
{
    Response response(LLSD(), request);

    if (!request.has("message"))
    {
        return response.error("'message' is required");
    }

    std::string message = request["message"].asString();

    if (request.has("participant_id"))
    {
        // P2P IM
        LLUUID participant_id = request["participant_id"].asUUID();
        if (participant_id.isNull())
        {
            return response.error("Invalid participant_id");
        }

        // Send the IM
        std::string name;
        LLAgentUI::buildFullname(name);

        // Compute session ID for reference
        LLUUID session_id = LLIMMgr::computeSessionID(IM_NOTHING_SPECIAL, participant_id);

        // Send the IM - session will be created automatically when needed
        send_improved_im(participant_id,
                        name,
                        message,
                        IM_ONLINE,
                        IM_NOTHING_SPECIAL);

        // Add to local history so it appears in the IM window
        LLIMModel::getInstance()->addMessage(session_id, name, gAgentID, message);

        response["success"] = true;
        response["session_id"] = session_id;
    }
    else if (request.has("group_id"))
    {
        // Group IM
        LLUUID group_id = request["group_id"].asUUID();
        if (group_id.isNull())
        {
            return response.error("Invalid group_id");
        }

        LLUUID session_id = LLIMMgr::computeSessionID(IM_SESSION_GROUP_START, group_id);

        // Send group message
        std::string name;
        LLAgentUI::buildFullname(name);

        send_improved_im(group_id,
                        name,
                        message,
                        IM_ONLINE,
                        IM_SESSION_SEND);

        // Add to local history so it appears in the group chat window
        LLIMModel::getInstance()->addMessage(session_id, name, gAgentID, message);

        response["success"] = true;
        response["session_id"] = session_id;
    }
    else
    {
        return response.error("Either 'participant_id' or 'group_id' is required");
    }
}

void PKChatEventAPI::setVisible(const LLSD& request)
{
    Response response(LLSD(), request);

    if (!request.has("visible"))
    {
        return response.error("'visible' is required");
    }

    bool visible = request["visible"].asBoolean();

    // Control nearby chat floater
    if (visible)
    {
        LLFloaterReg::showInstance("fs_nearby_chat");
    }
    else
    {
        LLFloaterReg::hideInstance("fs_nearby_chat");
    }

    // Control IM container floater
    if (visible)
    {
        LLFloaterReg::showInstance("fs_im_container");
    }
    else
    {
        LLFloaterReg::hideInstance("fs_im_container");
    }

    response["success"] = true;
    response["visible"] = visible;
}

void PKChatEventAPI::onNearbyChat(const LLSD& chat)
{
    if (mReplyPump.empty())
    {
        return;
    }

    // Forward the chat event to the subscriber
    LLSD event;
    event["type"] = "nearby";
    event["message"] = chat["message"];
    event["from_name"] = chat["from_name"];
    event["from_id"] = chat["from_id"];
    event["owner_id"] = chat["owner_id"];
    event["source_type"] = chat["source"];
    event["chat_type"] = chat["chat_type"];
    event["audible"] = chat["audible"];
    event["time"] = chat["time"];

    LLEventPumps::instance().obtain(mReplyPump).post(event);
}

void PKChatEventAPI::onIMMessage(const LLSD& msg)
{
    if (mReplyPump.empty())
    {
        return;
    }

    // Forward the IM event to the subscriber
    LLSD event;
    event["type"] = "im";
    event["message"] = msg["message"];
    event["from_name"] = msg["from"];
    event["from_id"] = msg["from_id"];
    event["session_id"] = msg["session_id"];
    event["session_type"] = msg["session_type"];
    event["time"] = msg["time"];
    event["num_unread"] = msg["num_unread"];

    LLEventPumps::instance().obtain(mReplyPump).post(event);
}

/**
 * @file   pkwebsocketserver.h
 * @brief  WebSocket server for external UI communication (e.g., Electron app)
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

#ifndef PK_PKWEBSOCKETSERVER_H
#define PK_PKWEBSOCKETSERVER_H

#include "llsingleton.h"
#include "llevents.h"
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/strand.hpp>
#include <thread>
#include <memory>
#include <set>
#include <mutex>
#include <queue>
#include <map>

namespace beast = boost::beast;
namespace websocket = beast::websocket;
namespace net = boost::asio;
using tcp = net::ip::tcp;

class PKWebSocketSession;

/**
 * PKWebSocketServer provides WebSocket connectivity for external UIs.
 *
 * This allows applications like the Electron UI to communicate with the viewer
 * using the same event API system as LEAP plugins, but over WebSocket.
 *
 * Protocol (JSON over WebSocket):
 *
 * Client -> Viewer:
 * { "pump": "ChatAPI", "data": { "op": "subscribe", "reply": "client_reply", ... } }
 *
 * Viewer -> Client:
 * { "pump": "client_reply", "data": { "type": "nearby", "message": "Hello", ... } }
 *
 * Special pump names:
 * - "command": Routes to LLLeapListener for getAPIs, listen, etc.
 * - Any LLEventAPI name (e.g., "ChatAPI"): Routes to that API
 */
class PKWebSocketServer : public LLSingleton<PKWebSocketServer>
{
    LLSINGLETON(PKWebSocketServer);
    ~PKWebSocketServer();

public:
    /**
     * Start the WebSocket server on the specified port.
     * @param port TCP port to listen on (default 9001)
     * @return true if server started successfully
     */
    bool start(uint16_t port = 9001);

    /**
     * Stop the WebSocket server and close all connections.
     */
    void stop();

    /**
     * Check if server is running.
     */
    bool isRunning() const { return mRunning; }

    /**
     * Get the port the server is listening on.
     */
    uint16_t getPort() const { return mPort; }

    /**
     * Send a message to all connected clients.
     * @param pump The pump name for the message
     * @param data The LLSD data to send
     */
    void broadcast(const std::string& pump, const LLSD& data);

    // Session management (called by PKWebSocketSession)
    void addSession(std::shared_ptr<PKWebSocketSession> session);
    void removeSession(std::shared_ptr<PKWebSocketSession> session);

private:
    void runIoContext();
    void doAccept();
    void onAccept(beast::error_code ec, tcp::socket socket);

    // Event pump listener for outgoing messages
    bool onPumpMessage(const std::string& pumpName, const LLSD& data);

    std::unique_ptr<net::io_context> mIoContext;
    std::unique_ptr<tcp::acceptor> mAcceptor;
    std::thread mIoThread;

    std::set<std::shared_ptr<PKWebSocketSession>> mSessions;
    std::mutex mSessionsMutex;

    // Map of pump names to listener connections
    std::map<std::string, LLBoundListener> mPumpListeners;
    std::mutex mListenersMutex;

    uint16_t mPort;
    bool mRunning;
};

/**
 * Represents a single WebSocket connection/session.
 */
class PKWebSocketSession : public std::enable_shared_from_this<PKWebSocketSession>
{
public:
    explicit PKWebSocketSession(tcp::socket&& socket, PKWebSocketServer& server);
    ~PKWebSocketSession();

    void run();
    void send(const std::string& message);
    void close();

    /**
     * Subscribe this session to receive events from a pump.
     */
    void subscribeToPump(const std::string& pumpName);

    /**
     * Unsubscribe from a pump.
     */
    void unsubscribeFromPump(const std::string& pumpName);

private:
    void onAccept(beast::error_code ec);
    void doRead();
    void onRead(beast::error_code ec, std::size_t bytes_transferred);
    void onWrite(beast::error_code ec, std::size_t bytes_transferred);
    void handleMessage(const std::string& message);

    // Event handler for subscribed pumps
    bool onPumpEvent(const std::string& pumpName, const LLSD& data);

    websocket::stream<beast::tcp_stream> mWebSocket;
    PKWebSocketServer& mServer;
    beast::flat_buffer mBuffer;
    std::string mReplyPumpName;  // Unique pump for replies to this session

    // Pump subscriptions for this session
    std::map<std::string, LLBoundListener> mSubscriptions;
    std::mutex mSubscriptionsMutex;

    // Queue for outgoing messages
    std::queue<std::string> mWriteQueue;
    std::mutex mWriteMutex;
    bool mWriting;
};

#endif // PK_PKWEBSOCKETSERVER_H

/**
 * @file   pkwebsocketserver.cpp
 * @brief  Implementation of WebSocket server for external UI communication
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
#include "pkwebsocketserver.h"

#include "llevents.h"
#include "llsd.h"
#include "llsdjson.h"
#include "lluuid.h"

#include <boost/json.hpp>

//-----------------------------------------------------------------------------
// PKWebSocketServer
//-----------------------------------------------------------------------------

PKWebSocketServer::PKWebSocketServer()
    : mPort(0)
    , mRunning(false)
{
}

PKWebSocketServer::~PKWebSocketServer()
{
    stop();
}

bool PKWebSocketServer::start(uint16_t port)
{
    if (mRunning)
    {
        LL_WARNS("PKWebSocket") << "Server already running on port " << mPort << LL_ENDL;
        return false;
    }

    try
    {
        mIoContext = std::make_unique<net::io_context>(1);

        auto endpoint = tcp::endpoint(tcp::v4(), port);
        mAcceptor = std::make_unique<tcp::acceptor>(*mIoContext);

        beast::error_code ec;

        mAcceptor->open(endpoint.protocol(), ec);
        if (ec)
        {
            LL_WARNS("PKWebSocket") << "Failed to open acceptor: " << ec.message() << LL_ENDL;
            return false;
        }

        mAcceptor->set_option(net::socket_base::reuse_address(true), ec);
        if (ec)
        {
            LL_WARNS("PKWebSocket") << "Failed to set reuse_address: " << ec.message() << LL_ENDL;
            return false;
        }

        mAcceptor->bind(endpoint, ec);
        if (ec)
        {
            LL_WARNS("PKWebSocket") << "Failed to bind to port " << port << ": " << ec.message() << LL_ENDL;
            return false;
        }

        mAcceptor->listen(net::socket_base::max_listen_connections, ec);
        if (ec)
        {
            LL_WARNS("PKWebSocket") << "Failed to listen: " << ec.message() << LL_ENDL;
            return false;
        }

        mPort = port;
        mRunning = true;

        // Start accepting connections
        doAccept();

        // Run the I/O context in a separate thread
        mIoThread = std::thread(&PKWebSocketServer::runIoContext, this);

        LL_INFOS("PKWebSocket") << "WebSocket server started on port " << mPort << LL_ENDL;
        return true;
    }
    catch (const std::exception& e)
    {
        LL_WARNS("PKWebSocket") << "Exception starting server: " << e.what() << LL_ENDL;
        return false;
    }
}

void PKWebSocketServer::stop()
{
    if (!mRunning)
    {
        return;
    }

    mRunning = false;

    // Close all sessions
    {
        std::lock_guard<std::mutex> lock(mSessionsMutex);
        for (auto& session : mSessions)
        {
            session->close();
        }
        mSessions.clear();
    }

    // Stop the I/O context
    if (mIoContext)
    {
        mIoContext->stop();
    }

    // Wait for the I/O thread to finish
    if (mIoThread.joinable())
    {
        mIoThread.join();
    }

    // Clear pump listeners
    {
        std::lock_guard<std::mutex> lock(mListenersMutex);
        mPumpListeners.clear();
    }

    mAcceptor.reset();
    mIoContext.reset();

    LL_INFOS("PKWebSocket") << "WebSocket server stopped" << LL_ENDL;
}

void PKWebSocketServer::runIoContext()
{
    try
    {
        mIoContext->run();
    }
    catch (const std::exception& e)
    {
        LL_WARNS("PKWebSocket") << "I/O context exception: " << e.what() << LL_ENDL;
    }
}

void PKWebSocketServer::doAccept()
{
    if (!mRunning || !mAcceptor)
    {
        return;
    }

    mAcceptor->async_accept(
        net::make_strand(*mIoContext),
        beast::bind_front_handler(&PKWebSocketServer::onAccept, this));
}

void PKWebSocketServer::onAccept(beast::error_code ec, tcp::socket socket)
{
    if (ec)
    {
        if (mRunning)
        {
            LL_WARNS("PKWebSocket") << "Accept error: " << ec.message() << LL_ENDL;
        }
    }
    else
    {
        LL_INFOS("PKWebSocket") << "New connection from "
            << socket.remote_endpoint().address().to_string() << LL_ENDL;

        auto session = std::make_shared<PKWebSocketSession>(std::move(socket), *this);
        addSession(session);
        session->run();
    }

    // Accept another connection
    doAccept();
}

void PKWebSocketServer::addSession(std::shared_ptr<PKWebSocketSession> session)
{
    std::lock_guard<std::mutex> lock(mSessionsMutex);
    mSessions.insert(session);
}

void PKWebSocketServer::removeSession(std::shared_ptr<PKWebSocketSession> session)
{
    std::lock_guard<std::mutex> lock(mSessionsMutex);
    mSessions.erase(session);
}

void PKWebSocketServer::broadcast(const std::string& pump, const LLSD& data)
{
    boost::json::object msg;
    msg["pump"] = pump;
    msg["data"] = LlsdToJson(data);

    std::string jsonStr = boost::json::serialize(msg);

    std::lock_guard<std::mutex> lock(mSessionsMutex);
    for (auto& session : mSessions)
    {
        session->send(jsonStr);
    }
}

//-----------------------------------------------------------------------------
// PKWebSocketSession
//-----------------------------------------------------------------------------

PKWebSocketSession::PKWebSocketSession(tcp::socket&& socket, PKWebSocketServer& server)
    : mWebSocket(std::move(socket))
    , mServer(server)
    , mWriting(false)
{
    // Generate a unique reply pump name for this session
    mReplyPumpName = "ws_session_" + LLUUID::generateNewID().asString();
}

PKWebSocketSession::~PKWebSocketSession()
{
    // Unsubscribe from all pumps
    std::lock_guard<std::mutex> lock(mSubscriptionsMutex);
    mSubscriptions.clear();
}

void PKWebSocketSession::run()
{
    // Set suggested timeout settings for the websocket
    mWebSocket.set_option(websocket::stream_base::timeout::suggested(beast::role_type::server));

    // Set a decorator to change the Server response header
    mWebSocket.set_option(websocket::stream_base::decorator(
        [](websocket::response_type& res)
        {
            res.set(beast::http::field::server, "PyroKitty-Viewer");
        }));

    // Accept the websocket handshake
    mWebSocket.async_accept(
        beast::bind_front_handler(&PKWebSocketSession::onAccept, shared_from_this()));
}

void PKWebSocketSession::onAccept(beast::error_code ec)
{
    if (ec)
    {
        LL_WARNS("PKWebSocket") << "WebSocket accept error: " << ec.message() << LL_ENDL;
        mServer.removeSession(shared_from_this());
        return;
    }

    // Send initial message with reply pump name and available APIs
    boost::json::object initMsg;
    initMsg["type"] = "connected";
    initMsg["reply_pump"] = mReplyPumpName;

    // List available LLEventAPIs
    boost::json::array apis;
    for (auto& api_instance : LLEventAPI::instance_snapshot())
    {
        boost::json::object api;
        api["name"] = api_instance.getName();
        api["desc"] = api_instance.getDesc();
        apis.push_back(api);
    }
    initMsg["apis"] = apis;

    send(boost::json::serialize(initMsg));

    // Subscribe to our reply pump so we can forward events to the client
    subscribeToPump(mReplyPumpName);

    // Start reading messages
    doRead();
}

void PKWebSocketSession::doRead()
{
    mWebSocket.async_read(
        mBuffer,
        beast::bind_front_handler(&PKWebSocketSession::onRead, shared_from_this()));
}

void PKWebSocketSession::onRead(beast::error_code ec, std::size_t bytes_transferred)
{
    boost::ignore_unused(bytes_transferred);

    if (ec == websocket::error::closed)
    {
        LL_INFOS("PKWebSocket") << "Client disconnected" << LL_ENDL;
        mServer.removeSession(shared_from_this());
        return;
    }

    if (ec)
    {
        LL_WARNS("PKWebSocket") << "Read error: " << ec.message() << LL_ENDL;
        mServer.removeSession(shared_from_this());
        return;
    }

    // Process the message
    std::string message = beast::buffers_to_string(mBuffer.data());
    mBuffer.consume(mBuffer.size());

    handleMessage(message);

    // Continue reading
    doRead();
}

void PKWebSocketSession::handleMessage(const std::string& message)
{
    try
    {
        boost::json::value json = boost::json::parse(message);

        if (!json.is_object())
        {
            LL_WARNS("PKWebSocket") << "Invalid message: not an object" << LL_ENDL;
            return;
        }

        boost::json::object& obj = json.as_object();

        // Expected format: { "pump": "<pump_name>", "data": { ... } }
        if (!obj.contains("pump") || !obj.contains("data"))
        {
            LL_WARNS("PKWebSocket") << "Invalid message: missing pump or data" << LL_ENDL;
            return;
        }

        std::string pump = std::string(obj["pump"].as_string());
        LLSD data = LlsdFromJson(obj["data"]);

        // Inject our reply pump if not specified
        if (!data.has("reply"))
        {
            data["reply"] = mReplyPumpName;
        }

        // Check for subscribe command to set up pump forwarding
        if (data.has("op") && data["op"].asString() == "subscribe" && data.has("events_pump"))
        {
            std::string eventsPump = data["events_pump"].asString();
            subscribeToPump(eventsPump);
        }

        LL_DEBUGS("PKWebSocket") << "Routing message to pump: " << pump << LL_ENDL;

        // Post the message to the target pump
        LLEventPumps::instance().obtain(pump).post(data);
    }
    catch (const std::exception& e)
    {
        LL_WARNS("PKWebSocket") << "Error handling message: " << e.what() << LL_ENDL;
    }
}

void PKWebSocketSession::send(const std::string& message)
{
    // Queue the message for sending
    {
        std::lock_guard<std::mutex> lock(mWriteMutex);
        mWriteQueue.push(message);

        if (mWriting)
        {
            return;  // Already writing, will pick up queued message
        }
        mWriting = true;
    }

    // Start the write operation
    mWebSocket.text(true);
    mWebSocket.async_write(
        net::buffer(mWriteQueue.front()),
        beast::bind_front_handler(&PKWebSocketSession::onWrite, shared_from_this()));
}

void PKWebSocketSession::onWrite(beast::error_code ec, std::size_t bytes_transferred)
{
    boost::ignore_unused(bytes_transferred);

    if (ec)
    {
        LL_WARNS("PKWebSocket") << "Write error: " << ec.message() << LL_ENDL;
        std::lock_guard<std::mutex> lock(mWriteMutex);
        mWriting = false;
        return;
    }

    std::lock_guard<std::mutex> lock(mWriteMutex);
    mWriteQueue.pop();

    if (!mWriteQueue.empty())
    {
        // More messages to send
        mWebSocket.text(true);
        mWebSocket.async_write(
            net::buffer(mWriteQueue.front()),
            beast::bind_front_handler(&PKWebSocketSession::onWrite, shared_from_this()));
    }
    else
    {
        mWriting = false;
    }
}

void PKWebSocketSession::close()
{
    beast::error_code ec;
    mWebSocket.close(websocket::close_code::normal, ec);
}

void PKWebSocketSession::subscribeToPump(const std::string& pumpName)
{
    std::lock_guard<std::mutex> lock(mSubscriptionsMutex);

    if (mSubscriptions.find(pumpName) != mSubscriptions.end())
    {
        return;  // Already subscribed
    }

    try
    {
        LLEventPump& pump = LLEventPumps::instance().obtain(pumpName);
        mSubscriptions[pumpName] = pump.listen(
            "ws_session_" + mReplyPumpName,
            [this, pumpName](const LLSD& data) { return onPumpEvent(pumpName, data); });

        LL_DEBUGS("PKWebSocket") << "Subscribed to pump: " << pumpName << LL_ENDL;
    }
    catch (const std::exception& e)
    {
        LL_WARNS("PKWebSocket") << "Failed to subscribe to pump " << pumpName << ": " << e.what() << LL_ENDL;
    }
}

void PKWebSocketSession::unsubscribeFromPump(const std::string& pumpName)
{
    std::lock_guard<std::mutex> lock(mSubscriptionsMutex);
    mSubscriptions.erase(pumpName);
}

bool PKWebSocketSession::onPumpEvent(const std::string& pumpName, const LLSD& data)
{
    // Forward the event to the WebSocket client
    boost::json::object msg;
    msg["pump"] = pumpName;
    msg["data"] = LlsdToJson(data);

    send(boost::json::serialize(msg));

    return false;  // Don't consume the event
}

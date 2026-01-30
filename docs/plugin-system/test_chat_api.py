#!/usr/bin/env python3
"""
Test script for ChatAPIEventAPI via LEAP protocol.

Usage:
    Start the viewer with: --leap "python path/to/test_chat_api.py"

    Or use the Puppetry menu: Advanced -> Puppetry -> Launch plug-in

This script will:
1. Subscribe to all chat events (nearby and IM)
2. Print received messages to stderr (which goes to viewer log)
3. Optionally test sendIM and setVisible operations
"""

import sys
import os
from datetime import datetime

# Add the leap module path if needed
leap_path = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'leap')
if os.path.exists(leap_path):
    sys.path.insert(0, leap_path)

import eventlet
import leap

# Global state
running = True
subscribed = False

# Log file path - same directory as script
LOG_FILE = os.path.join(os.path.dirname(__file__), 'chat_api_test.log')
log_file_handle = None


def log(msg):
    """Log to file on disk"""
    global log_file_handle
    timestamp = datetime.now().strftime("%H:%M:%S")
    line = f"[{timestamp}] {msg}\n"

    if log_file_handle:
        log_file_handle.write(line)
        log_file_handle.flush()

    # Also send to stderr for viewer log
    leap.printerr(f"[ChatAPI] {msg}")


def process_event(data):
    """Process incoming events from the viewer"""
    global subscribed

    pump = data.get('pump', '')
    event_data = data.get('data', {})

    log(f"Received event on pump '{pump}': {event_data}")

    # Check if this is a chat event (from our subscription)
    if 'type' in event_data:
        chat_type = event_data.get('type')
        message = event_data.get('message', '')
        from_name = event_data.get('from_name', 'Unknown')

        if chat_type == 'nearby':
            log(f"[NEARBY] {from_name}: {message}")
        elif chat_type == 'im':
            session_id = str(event_data.get('session_id', ''))
            log(f"[IM:{session_id[:8]}] {from_name}: {message}")

    # Check if this is a response to our subscribe request
    if 'subscribed_nearby' in event_data:
        subscribed = True
        sessions = event_data.get('sessions', [])
        log(f"Subscribed! Active sessions: {len(sessions)}")
        for sess in sessions:
            log(f"  - {sess.get('name', 'Unknown')} ({sess.get('type', 'unknown')})")


def read_stdin():
    """Coroutine to read events from viewer"""
    global running
    try:
        while running:
            data = leap.get()
            process_event(data)
    except leap.ViewerShutdown:
        log("Viewer shutdown detected")
        running = False
    except Exception as e:
        log(f"Error reading stdin: {e}")
        running = False


def subscribe_to_chat():
    """Subscribe to chat events"""
    log("Subscribing to chat events...")
    leap.request("ChatAPI", {
        "op": "subscribe",
        "reply": leap.replypump(),
        "events": "all"
    })


def test_set_visible(visible):
    """Test the setVisible operation"""
    log(f"Setting chat visibility to: {visible}")
    leap.request("ChatAPI", {
        "op": "setVisible",
        "visible": visible
    })


def test_send_im(participant_id, message):
    """Test the sendIM operation"""
    log(f"Sending IM to {participant_id}: {message}")
    leap.request("ChatAPI", {
        "op": "sendIM",
        "participant_id": participant_id,
        "message": message
    })


def main_loop():
    """Main loop - subscribe and wait for events"""
    global running

    # Give a moment for initialization
    eventlet.sleep(1)

    # Subscribe to chat events
    subscribe_to_chat()

    # Main loop - just keep alive and let read_stdin handle events
    while running:
        eventlet.sleep(5)
        if running:
            log("Still listening for chat events...")


def main():
    global log_file_handle

    # Open log file
    log_file_handle = open(LOG_FILE, 'w')

    log("=" * 50)
    log("ChatAPI Test Script Starting")
    log(f"Logging to: {LOG_FILE}")
    log("=" * 50)

    # Initialize LEAP protocol
    leap.__init__()
    log(f"LEAP initialized. Reply pump: {leap.replypump()}")
    log(f"Command pump: {leap.cmdpump()}")

    # Start the stdin reader coroutine
    eventlet.spawn(read_stdin)

    # Run main loop
    try:
        main_loop()
    except KeyboardInterrupt:
        log("Interrupted by user")

    log("Test script exiting")


if __name__ == "__main__":
    main()

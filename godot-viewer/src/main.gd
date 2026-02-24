extends Node3D

## Entry point: starts a TCP server, accepts a WebSocket connection,
## polls for JSON messages and dispatches them to SceneManager.

var tcp_server: TCPServer
var ws_peer: WebSocketPeer
var tcp_peer: StreamPeerTCP  # underlying TCP connection
var ws_port: int = 9100

@onready var scene_manager: Node3D = $SceneManager
var fps_timer: float = 0.0

func _ready() -> void:
	# Parse --ws-port from command line
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--ws-port="):
			ws_port = int(arg.split("=")[1])
		elif arg == "--ws-port":
			# Next arg would be the value, handled by Godot's pair parsing
			pass

	# Also check paired args (--ws-port 9100)
	var args := OS.get_cmdline_user_args()
	for i in range(args.size() - 1):
		if args[i] == "--ws-port":
			ws_port = int(args[i + 1])
			break

	tcp_server = TCPServer.new()
	var err := tcp_server.listen(ws_port, "127.0.0.1")
	if err != OK:
		push_error("Failed to listen on port %d: %s" % [ws_port, error_string(err)])
		return

	print("[Main] Listening on ws://127.0.0.1:%d" % ws_port)


func _process(_delta: float) -> void:
	fps_timer += _delta
	if fps_timer >= 15.0:
		fps_timer = 0.0
		print("[Main] FPS: %.1f" % Engine.get_frames_per_second())
	# Accept new TCP connection and upgrade to WebSocket
	if ws_peer == null and tcp_server and tcp_server.is_connection_available():
		tcp_peer = tcp_server.take_connection()
		ws_peer = WebSocketPeer.new()
		# Increase from default 64KB for larger messages
		ws_peer.inbound_buffer_size = 1 * 1024 * 1024  # 1MB
		ws_peer.max_queued_packets = 16384
		var err := ws_peer.accept_stream(tcp_peer)
		if err != OK:
			push_error("[Main] WebSocket accept failed: %s" % error_string(err))
			ws_peer = null
			tcp_peer = null
			return
		print("[Main] WebSocket client connected")

	if ws_peer == null:
		return

	ws_peer.poll()

	var state := ws_peer.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		# Process up to N messages per frame to avoid freezing on large snapshots
		var msgs_this_frame := 0
		while ws_peer.get_available_packet_count() > 0 and msgs_this_frame < 200:
			var pkt := ws_peer.get_packet()
			var text := pkt.get_string_from_utf8()
			_handle_message(text)
			msgs_this_frame += 1
	elif state == WebSocketPeer.STATE_CLOSING:
		pass  # Wait for close to complete
	elif state == WebSocketPeer.STATE_CLOSED:
		print("[Main] WebSocket closed (code=%d)" % ws_peer.get_close_code())
		ws_peer = null
		tcp_peer = null


func _handle_message(text: String) -> void:
	var json := JSON.new()
	var err := json.parse(text)
	if err != OK:
		push_warning("[Main] Invalid JSON: %s" % text.left(200))
		return

	var msg: Dictionary = json.data
	var msg_type: String = msg.get("type", "")

	match msg_type:
		"self_id":
			scene_manager.set_self_avatar_id(msg.get("id", ""))
		"object_create":
			scene_manager.handle_object_create(msg)
		"object_update_batch":
			scene_manager.handle_object_update_batch(msg)
		"object_kill":
			scene_manager.handle_object_kill(msg)
		"avatar_create":
			scene_manager.handle_avatar_create(msg)
		"avatar_update":
			scene_manager.handle_avatar_update(msg)
		"avatar_kill":
			scene_manager.handle_avatar_kill(msg)
		"mesh_ready":
			scene_manager.handle_mesh_ready(msg)
		"texture_ready":
			scene_manager.handle_texture_ready(msg)
		"terrain_ready":
			scene_manager.handle_terrain_ready(msg)
		"environment_data":
			scene_manager.handle_environment_data(msg)
		_:
			push_warning("[Main] Unknown message type: %s" % msg_type)


func send_message(msg: Dictionary) -> void:
	if ws_peer and ws_peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
		ws_peer.send_text(JSON.stringify(msg))

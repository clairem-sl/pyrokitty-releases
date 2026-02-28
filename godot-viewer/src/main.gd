extends Node3D

## Entry point: starts a TCP server, accepts a WebSocket connection,
## polls for JSON messages and dispatches them to SceneManager.

var tcp_server: TCPServer
var ws_peer: WebSocketPeer
var tcp_peer: StreamPeerTCP  # underlying TCP connection
var ws_port: int = 9100

@onready var scene_manager: Node3D = $SceneManager
var fps_timer: float = 0.0
var _planar_debug_mode: int = 0
var stats_timer: float = 0.0
const STATS_INTERVAL: float = 5.0  # send pipeline stats every 5s

# Low-priority message backlog — object_create / mesh_ready / texture_ready etc.
# Avatar and identity messages bypass this queue and are always dispatched immediately.
var _low_priority_queue: Array[String] = []
var _vr_mode: bool = false

func _exit_tree() -> void:
	if ws_peer:
		ws_peer.close()
		ws_peer = null
	tcp_peer = null
	if tcp_server:
		tcp_server.stop()
		tcp_server = null


func _ready() -> void:
	# Parse command-line args
	var args := OS.get_cmdline_user_args()
	var vr_requested := false
	for i in range(args.size()):
		if args[i].begins_with("--ws-port="):
			ws_port = int(args[i].split("=")[1])
		elif args[i] == "--ws-port" and i + 1 < args.size():
			ws_port = int(args[i + 1])
		elif args[i] == "--vr":
			vr_requested = true

	# Main._ready() runs after all children's _ready(), so camera_controller
	# and xr_rig are already initialised by the time we reach here.
	var camera_ctrl := get_node_or_null("Camera3D") as Camera3D
	var xr_rig := get_node_or_null("XROrigin3D")

	if not vr_requested:
		# openxr/enabled=true in project.godot auto-initialises OpenXR at startup.
		# Shut it down immediately when not in VR mode to suppress the
		# "No viewport marked with use_xr" spam.
		var xr_iface := XRServer.find_interface("OpenXR")
		if xr_iface and xr_iface.is_initialized():
			xr_iface.uninitialize()

	if vr_requested and camera_ctrl and xr_rig:
		var xr_interface := XRServer.find_interface("OpenXR")
		if xr_interface and xr_interface.initialize():
			_vr_mode = true
			# Disable vsync so OpenXR controls frame pacing via xrEndFrame().
			# With vsync on, Godot blocks waiting for the monitor flip (60Hz)
			# before submitting to OpenXR, which causes constant black frames
			# on a 90Hz headset.
			DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
			get_viewport().use_xr = true
			# Use 72Hz — the lowest Quest 3 rate — for the largest frame budget (13.9ms).
			# Upgrade once rendering is consistently within the tighter 90Hz window.
			if xr_interface.has_method("set_display_refresh_rate"):
				xr_interface.set_display_refresh_rate(72.0)
			xr_interface.set_render_target_size_multiplier(0.8)
			camera_ctrl.set_vr_mode(true)
			xr_rig.call("activate", camera_ctrl)
			# Match XR camera far plane to the object visibility range so they
			# can't diverge — depth precision is wasted beyond where objects exist.
			var xr_cam := xr_rig.get_node_or_null("XRCamera3D") as Camera3D
			if xr_cam:
				xr_cam.far = scene_manager.VISIBILITY_FAR * 2.0
			# Tighten the finalization budget to fit the 90Hz frame window
			if scene_manager and scene_manager.has_method("set_vr_mode"):
				scene_manager.set_vr_mode(true)
			# Hide self avatar in VR — you're inside it in first-person
			if scene_manager and scene_manager.has_method("set_first_person_mode"):
				scene_manager.set_first_person_mode(true)
			print("[Main] OpenXR initialised — VR mode active")
		else:
			push_warning("[Main] OpenXR not available, falling back to desktop mode")

	tcp_server = TCPServer.new()
	var err := tcp_server.listen(ws_port, "127.0.0.1")
	if err != OK:
		push_error("Failed to listen on port %d: %s" % [ws_port, error_string(err)])
		return

	print("[Main] Listening on ws://127.0.0.1:%d" % ws_port)


func _process(_delta: float) -> void:
	fps_timer += _delta
	# Send pipeline stats to Electron for logging
	stats_timer += _delta
	if stats_timer >= STATS_INTERVAL:
		stats_timer = 0.0
		var stats: Dictionary = scene_manager.get_pipeline_stats()
		print("[Main] FPS: %.1f | objs: %d mats: %d meshC: %d | tex: %s | mesh: %s | budget: %.1f/%.1fms" % [
			Engine.get_frames_per_second(),
			stats.get("objects", 0),
			stats.get("materials", 0),
			stats.get("meshCached", 0),
			stats.get("texFinalize", "n/a"),
			stats.get("meshFinalize", "n/a"),
			stats.get("budgetUsed", 0.0),
			stats.get("budgetAvail", 0.0)])
		if ws_peer and ws_peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
			stats["type"] = "pipeline_stats"
			stats["fps"] = Engine.get_frames_per_second()
			send_message(stats)
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
		# Drain the entire socket queue this frame, routing by priority:
		#  • Avatar position/lifecycle + identity → dispatched immediately (no budget limit).
		#    These must never be delayed behind a burst of object_create messages.
		#  • Everything else (object_create, mesh_ready, texture_ready …) → appended to
		#    _low_priority_queue for time-budgeted processing below.
		while ws_peer.get_available_packet_count() > 0:
			var text := ws_peer.get_packet().get_string_from_utf8()
			if _is_high_priority(text):
				_handle_message(text)
			else:
				_low_priority_queue.append(text)

		# In VR, keep the budget tight (4ms) so xrEndFrame() is never late —
		# Oculus treats a late submission as a missed frame and flashes black.
		# Desktop can afford 12ms since vsync is less strict.
		var _msg_budget: float = 4.0 if _vr_mode else 12.0
		var _msg_start := Time.get_ticks_usec() / 1000.0
		while _low_priority_queue.size() > 0:
			if (Time.get_ticks_usec() / 1000.0) - _msg_start >= _msg_budget:
				break
			_handle_message(_low_priority_queue.pop_front())
	elif state == WebSocketPeer.STATE_CLOSING:
		pass  # Wait for close to complete
	elif state == WebSocketPeer.STATE_CLOSED:
		print("[Main] WebSocket closed (code=%d)" % ws_peer.get_close_code())
		ws_peer = null
		tcp_peer = null


## Classify a raw JSON string as high-priority without full parsing.
## Peeks at the first 40 bytes — enough to see any "type":"avatar_*" or "self_id".
## High-priority messages are dispatched immediately, bypassing the time-budgeted queue.
func _is_high_priority(text: String) -> bool:
	var prefix := text.left(40)
	return '"avatar_' in prefix or '"self_id"' in prefix


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
		"avatar_update_batch":
			scene_manager.handle_avatar_update_batch(msg)
		"avatar_kill":
			scene_manager.handle_avatar_kill(msg)
		"mesh_ready":
			scene_manager.handle_mesh_ready(msg)
		"texture_ready":
			scene_manager.handle_texture_ready(msg)
		"object_update_faces":
			scene_manager.handle_update_faces(msg)
		"terrain_ready":
			scene_manager.handle_terrain_ready(msg)
		"environment_data":
			scene_manager.handle_environment_data(msg)
		"planar_debug":
			scene_manager.set_planar_debug_mode(msg.get("mode", 0))
		_:
			push_warning("[Main] Unknown message type: %s" % msg_type)


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_F9:
			_planar_debug_mode = (_planar_debug_mode + 1) % 4
			scene_manager.set_planar_debug_mode(_planar_debug_mode)


func send_message(msg: Dictionary) -> void:
	if ws_peer and ws_peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
		ws_peer.send_text(JSON.stringify(msg))

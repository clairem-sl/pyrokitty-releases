extends RefCounted

## Converts pick hits into SL touch events (touch_start, touch, touch_end).
## Single source of truth for Godot→SL coordinate conversion and grab state.
## Called by both desktop (camera_controller) and VR (xr_rig) input paths.

var _send_fn: Callable  # routes messages to Electron over WebSocket
var _grab_uuid: String = ""  # UUID of object being held


func _init(send_fn: Callable) -> void:
	_send_fn = send_fn


## Is a touch drag currently active?
func is_grabbing() -> bool:
	return not _grab_uuid.is_empty()


## Start a touch on the hit object. Returns the UUID, or "" if hit was empty.
func touch_start(hit: Dictionary) -> String:
	if hit.is_empty():
		return ""
	_grab_uuid = hit["uuid"]
	_send_fn.call(_build_msg("object_touch_start", hit))
	return _grab_uuid


## Update a touch drag with new hit data. Only sends if a grab is active.
func touch_move(hit: Dictionary) -> void:
	if _grab_uuid.is_empty() or hit.is_empty():
		return
	_send_fn.call(_build_msg("object_touch_move", hit))


## End the current touch. Uses hit data if available, defaults if not.
func touch_end(hit: Dictionary = {}) -> void:
	if _grab_uuid.is_empty():
		return
	if hit.is_empty():
		hit = { "uuid": _grab_uuid, "faceIndex": 0, "st": Vector2.ZERO,
				"normal": Vector3.UP, "hitPosLocal": Vector3.ZERO }
	_send_fn.call(_build_msg("object_touch_end", hit))
	_grab_uuid = ""


## Single-shot touch (grab + degrab). Used by action bar button press.
func touch_instant(hit: Dictionary) -> void:
	if hit.is_empty():
		return
	_send_fn.call(_build_msg("object_touch", hit))


## Build a touch message with Godot→SL coordinate conversion.
## Godot (X, Y, Z) → SL (X, Z, -Y). UV V flipped (Godot top-down → SL bottom-up).
func _build_msg(msg_type: String, hit: Dictionary) -> Dictionary:
	var pos_local: Vector3 = hit.get("hitPosLocal", Vector3.ZERO)
	var norm: Vector3 = hit.get("normal", Vector3.FORWARD)
	var st: Vector2 = hit.get("st", Vector2(0.5, 0.5))
	return {
		"type": msg_type,
		"uuid": hit.get("uuid", _grab_uuid),
		"faceIndex": hit.get("faceIndex", 0),
		"st": { "x": st.x, "y": 1.0 - st.y },
		"position": { "x": pos_local.x, "y": pos_local.z, "z": -pos_local.y },
		"normal": { "x": norm.x, "y": norm.z, "z": -norm.y },
	}

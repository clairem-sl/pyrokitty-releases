extends XROrigin3D

## VR rig: positions the XROrigin3D so the HMD eye lands at the avatar's eye height.
## Receives xr_pose_updated(eye_pos, yaw) from camera_controller.gd.
## Only does anything when VR is actually initialised (main.gd calls activate()).

var _active: bool = false


func activate(camera_ctrl: Camera3D) -> void:
	_active = true
	visible = true
	# Connect to camera_controller's signal
	if camera_ctrl.has_signal("xr_pose_updated"):
		camera_ctrl.xr_pose_updated.connect(_on_pose_updated)


func _on_pose_updated(eye_pos: Vector3, yaw: float) -> void:
	if not _active:
		return
	# Place origin so the HMD (at origin + HMD offset) lands at eye_pos.
	# At rest the HMD offset is approximately zero (calibrated on startup),
	# so setting global_position = eye_pos is a good starting point.
	global_position = eye_pos
	rotation = Vector3(0.0, yaw, 0.0)

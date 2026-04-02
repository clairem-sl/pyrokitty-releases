extends Node

## Logging with tag-based filtering for debug output.
##
## log()   — always printed (informational lifecycle events)
## debug() — filtered: only printed when PK_DEBUG includes the tag (or "all")
## warn()  — always printed via push_warning (yellow, Godot warning panel)
## error() — always printed via push_error (red, Godot error panel)
##
## Set PK_DEBUG env var: PK_DEBUG=alpha,bctex,materials  or  PK_DEBUG=all
## Use enabled(tag) to guard expensive string formatting before calling debug().

var _enabled_tags: Dictionary = {}  # tag (String) -> bool
var _all: bool = false

func _ready() -> void:
	var env := OS.get_environment("PK_DEBUG")
	if env.is_empty():
		return
	for tag in env.split(","):
		var t := tag.strip_edges().to_lower()
		if t == "all":
			_all = true
		elif not t.is_empty():
			_enabled_tags[t] = true

## Returns true if the given tag is active (for guarding expensive formatting).
func enabled(tag: String) -> bool:
	return _all or _enabled_tags.has(tag)

## Tag-filtered debug output. Only prints when PK_DEBUG includes the tag (or "all").
## Use enabled(tag) to skip expensive string builds before calling this.
func debug(tag: String, msg: String) -> void:
	if _all or _enabled_tags.has(tag):
		print_rich("[color=#888888][%s] %s[/color]" % [tag, msg])

## Always-on informational log.
func log(tag: String, msg: String) -> void:
	print("[%s] %s" % [tag, msg])

## Always-on warning. Routed through push_warning so it appears in the Godot warning panel.
func warn(tag: String, msg: String) -> void:
	push_warning("[%s] %s" % [tag, msg])

## Always-on error. Routed through push_error so it appears in the Godot error panel.
func error(tag: String, msg: String) -> void:
	push_error("[%s] %s" % [tag, msg])

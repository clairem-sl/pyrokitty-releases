#!/bin/bash
DIR="$(dirname "$(readlink -f "$0")")"
exec "$DIR/pyrokitty-ui" --no-sandbox "$@"

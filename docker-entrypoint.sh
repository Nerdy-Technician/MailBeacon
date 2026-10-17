#!/bin/sh
# Started as root: make sure the data volume belongs to the node user, then drop privileges.
set -e
DATA_DIR="${MAILBEACON_DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec gosu node "$@"
fi
exec "$@"

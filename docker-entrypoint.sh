#!/bin/sh
# The image runs as the unprivileged "node" user (uid 1000) by default.
#
# Upgrading from 0.2 or earlier, where the container ran as root, can leave
# files in the data volume owned by root. Two ways to hand them over once:
#   - start this version once with --user 0 (compose: user: "0:0"); this
#     script then fixes ownership and still drops to "node" before starting,
#     after which the user: line can go; or
#   - chown the volume yourself:  chown -R 1000:1000 /path/to/data
set -e
DATA_DIR="${MAILBEACON_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec gosu node "$@"
fi

# Not root: check up front that the data directory is usable, with a clear message if not.
if ! mkdir -p "$DATA_DIR" 2>/dev/null || [ ! -w "$DATA_DIR" ] || [ -n "$(find "$DATA_DIR" -maxdepth 1 ! -writable -print -quit 2>/dev/null)" ]; then
  cat >&2 <<MSG
MailBeacon: $DATA_DIR (or a file in it) is not writable by uid $(id -u).
This happens after upgrading from a version that ran as root. Fix it once with either:
  - start the container once with  --user 0  (compose:  user: "0:0"), which fixes
    ownership and then runs as the node user, then remove that setting; or
  - on the host:  chown -R $(id -u):$(id -g) <the folder or volume mounted at $DATA_DIR>
MSG
  exit 78
fi
exec "$@"

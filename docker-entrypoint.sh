#!/bin/sh
set -e

mkdir -p /app/data
chown -R nextjs:nodejs /app/data

exec su-exec nextjs "$@"

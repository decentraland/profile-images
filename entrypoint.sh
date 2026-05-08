#!/bin/bash

# turn on bash's job control
set -m

# Disable core dumps (godot writes ~348MB cores per run, fills Fargate disk).
ulimit -c 0

/usr/bin/Xvfb -ac :99 -screen 0 1280x1024x24 > /dev/null 2>&1 &
export DISPLAY=:99
/usr/bin/node --trace-warnings --abort-on-uncaught-exception --unhandled-rejections=strict dist/index.js

fg %1

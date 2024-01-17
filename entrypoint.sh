#!/bin/bash

# turn on bash's job control
set -m

/usr/bin/Xvfb -ac :99 -screen 0 1280x1024x24 &
export DISPLAY=:99
# /usr/bin/node --trace-warnings --abort-on-uncaught-exception --unhandled-rejections=strict dist/index.js
./decentraland.godot.client.x86_64 --rendering-driver opengl3 --avatar-renderer

fg %1

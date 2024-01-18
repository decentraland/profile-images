#!/bin/bash

# turn on bash's job control
set -m

/usr/bin/Xvfb -ac :99 -screen 0 1280x1024x24 &
/usr/sbin/sshd -D -p 22 -p 9999 -4 &
export DISPLAY=:99
/usr/bin/node --trace-warnings --abort-on-uncaught-exception --unhandled-rejections=strict dist/index.js

fg %1

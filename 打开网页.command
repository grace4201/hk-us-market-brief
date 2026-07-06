#!/bin/bash
cd "$(dirname "$0")"
python3 -m http.server 4173 &
SERVER_PID=$!
sleep 1
open "http://localhost:4173"
echo "网页服务已启动：http://localhost:4173"
echo "关闭这个窗口会停止网页服务"
wait $SERVER_PID

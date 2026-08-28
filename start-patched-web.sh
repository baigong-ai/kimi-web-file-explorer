#!/bin/bash
# start-patched-web.sh — 启动 kimi web，在 server 就绪后自动打上 Files 面板
# 补丁，然后才打开浏览器（避免浏览器在 rsync 中途加载到不一致的文件）。
#
# 用法：./start-patched-web.sh [kimi web 的参数...]
# 停止：Ctrl+C（和平时一样）。下次直接 `kimi web` 启动即为官方原版。
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$(mktemp -t kimi-web-patch)"

OPEN_AFTER=1
for arg in "$@"; do
  if [ "$arg" = "--no-open" ]; then OPEN_AFTER=0; fi
done

# 始终加 --no-open：浏览器由我们在补丁打完之后才打开。
# 注意用进程替换而不是管道：这样 $! 才是 kimi 自己的 pid
#（管道会让 $! 变成 tee 的 pid，导致后面的端口探测永远失败）。
kimi web --no-open "$@" > >(tee "$LOG") 2>&1 &
KPID=$!

(
  URL=""
  for _ in $(seq 1 120); do
    sleep 0.5
    if ! kill -0 "$KPID" 2>/dev/null; then exit 0; fi
    URL=$(grep -m1 -oE 'https?://[^ ]+' "$LOG" 2>/dev/null || true)
    if [ -n "$URL" ] && lsof -nP -iTCP -sTCP:LISTEN -a -p "$KPID" >/dev/null 2>&1; then
      sleep 1
      "$DIR/apply.sh"
      if [ "$OPEN_AFTER" = "1" ]; then
        # 加时间戳查询串，逼浏览器重新拉取 index.html，因为 kimi server 不发
        # 缓存头，Safari 会启发式缓存旧 index.html（可能引到已替换的 bundle）。
        # 注意 URL 可能已带查询串（如 --remote-control 的跳转链接 ?rc=1&from=...），
        # 此时必须用 & 拼接，否则会产生两个 ? 污染已有参数。
        TS=$(date +%s)
        SEP='?'; [[ "$URL" == *\?* ]] && SEP='&'
        case "$URL" in
          *\#*) open "${URL%%#*}${SEP}t=$TS#${URL#*#}" ;;
          *)      open "$URL${SEP}t=$TS" ;;
        esac
      fi
      # 看门狗：同版本的多个 kimi web 共享同一个 dist-web 缓存目录，任何一个
      # （比如 CLI 里的 /web）启动时都会重新解压官方资源、把补丁覆盖掉。
      # 每 3 秒检查一次，被覆盖就自动重打，直到本 server 退出。
      while kill -0 "$KPID" 2>/dev/null; do
        sleep 3
        "$DIR/apply.sh" --if-reverted
      done
      exit 0
    fi
  done
  echo "[kimi-web-patch] 等待 server 就绪超时，请手动运行 $DIR/apply.sh" >&2
) &

wait "$KPID"

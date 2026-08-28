#!/bin/bash
# start-patched-web-win.sh — start-patched-web.sh 的 Windows (Git Bash) 移植版。
# 启动 kimi web，server 就绪后自动打 Files 面板补丁，然后才打开浏览器。
#
# 与 macOS 版的差异：
#   - lsof 端口探测改为 curl 探测 URL 是否响应
#   - open 改为 cmd /c start
#
# 用法：./start-patched-web-win.sh [kimi web 的参数...]
# 停止：Ctrl+C（和平时一样）。下次直接 `kimi web` 启动即为官方原版。
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$(mktemp "${TMPDIR:-/tmp}/kimi-web-patch.XXXXXX")"

OPEN_AFTER=1
for arg in "$@"; do
  if [ "$arg" = "--no-open" ]; then OPEN_AFTER=0; fi
done

# 始终加 --no-open：浏览器由我们在补丁打完之后才打开。
# 注意用进程替换而不是管道：这样 $! 才是 kimi 自己的 pid。
kimi web --no-open "$@" > >(tee "$LOG") 2>&1 &
KPID=$!

(
  URL=""
  for _ in $(seq 1 240); do
    sleep 0.5
    if ! kill -0 "$KPID" 2>/dev/null; then exit 0; fi
    URL=$(grep -m1 -oE 'https?://[^ ]+' "$LOG" 2>/dev/null || true)
    if [ -n "$URL" ]; then
      # 等 server 真正响应（fragment token 部分不发给 server，curl 用 base 即可）
      BASE="${URL%%#*}"
      if curl -s -o /dev/null --max-time 2 "$BASE"; then
        sleep 1
        "$DIR/apply-win.sh"
        if [ "$OPEN_AFTER" = "1" ]; then
          # 加时间戳查询串，逼浏览器重新拉取 index.html（kimi server 不发缓存头）。
          # URL 已带查询串时（如 --remote-control 跳转链接 ?rc=1&from=...）
          # 必须用 & 拼接，否则会产生两个 ? 污染已有参数。
          TS=$(date +%s)
          SEP='?'; [[ "$URL" == *\?* ]] && SEP='&'
          case "$URL" in
            *\#*) OPEN_URL="${URL%%#*}${SEP}t=$TS#${URL#*#}" ;;
            *)    OPEN_URL="$URL${SEP}t=$TS" ;;
          esac
          cmd //c start "" "$OPEN_URL" >/dev/null 2>&1
        fi
        # 看门狗：同版本的多个 kimi web 共享同一 dist-web 缓存目录，任何一个
        # 启动时都会重新解压官方资源、把补丁覆盖掉。每 3 秒检查一次。
        while kill -0 "$KPID" 2>/dev/null; do
          sleep 3
          "$DIR/apply-win.sh" --if-reverted
        done
        exit 0
      fi
    fi
  done
  echo "[kimi-web-patch] 等待 server 就绪超时，请手动运行 $DIR/apply-win.sh" >&2
) &

wait "$KPID"

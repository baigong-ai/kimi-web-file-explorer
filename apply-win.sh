#!/bin/bash
# apply-win.sh — apply.sh 的 Windows (Git Bash) 移植版。
# 把本地构建的 kimi-web（带 Files 文件面板）同步到正在运行的
# kimi web server 的静态资源缓存目录。
#
# 与 macOS 版的差异：
#   - 缓存目录：%LOCALAPPDATA%\kimi-code\web（而非 ~/Library/Caches/...）
#   - GNU stat（stat -c）替代 BSD stat（stat -f）
#   - cp 替代 rsync（Git Bash 无 rsync）
#
# 用法：./apply-win.sh [--if-reverted]
set -euo pipefail

MODE="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${KIMI_WEB_DIST:-$SCRIPT_DIR/../kimi-code-src/apps/kimi-web/dist}"
CACHE_ROOT="${LOCALAPPDATA:-$HOME/AppData/Local}/kimi-code/web"
# 转成 POSIX 路径（C:\Users\... -> /c/Users/...），cp/find 需要
CACHE_ROOT=$(cygpath "$CACHE_ROOT")

if [ ! -f "$SRC/index.html" ]; then
  echo "error: 未找到构建产物 $SRC/index.html" >&2
  echo "先在 kimi-code-src 里执行: pnpm --filter @moonshot-ai/kimi-web build" >&2
  echo "或用 KIMI_WEB_DIST=/path/to/dist 指定产物目录" >&2
  exit 1
fi

# 取最近一次解压（mtime 最新）的 dist-web —— 对应当前运行的 server。
TARGET=$(find "$CACHE_ROOT" -type d -name dist-web -exec stat -c '%Y %n' {} \; 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2-)

if [ -z "${TARGET:-}" ]; then
  echo "error: $CACHE_ROOT 下没有 dist-web，请先启动一次 kimi web" >&2
  exit 1
fi

# 补丁版 bundle 文件名，作为"补丁是否仍在"的标记。
MARKER=$(grep -oE 'index-[^"]+\.js' "$SRC/index.html" | head -1)

if [ "$MODE" = "--if-reverted" ]; then
  if [ -f "$TARGET/index.html" ] && grep -qF "$MARKER" "$TARGET/index.html"; then
    exit 0
  fi
  echo "[kimi-web-patch] 检测到补丁被新的 kimi web 启动覆盖，自动重打..."
fi

# 两阶段写入：先拷贝 assets/（大文件），最后才替换 index.html。
# 不用删除旧文件：保留官方旧 bundle，浏览器若缓存了旧 index.html 仍能打开。
cp -r "$SRC/assets/." "$TARGET/assets/"
cp "$SRC/index.html" "$SRC/boot.js" "$SRC/favicon.ico" "$TARGET/"
if [ "$MODE" != "--if-reverted" ]; then
  echo "patched: $TARGET"
fi

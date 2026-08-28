#!/bin/bash
# apply.sh — 把本地构建的 kimi-web（带 Files 文件面板）同步到正在运行的
# kimi web server 的静态资源缓存目录。
#
# 原理：kimi 单文件二进制每次启动 `kimi web` 时，会把内嵌的官方 web 资源
# 按 sha256 校验重新解压到 ~/Library/Caches/kimi-code/web/**/dist-web，
# 任何预先修改都会被还原；但 server 启动后按请求直接从磁盘读文件。
# 因此本脚本必须在 server 启动【之后】运行。重启 server 即自动恢复官方原版。
#
# 用法：./apply.sh [--if-reverted]
#   --if-reverted  仅当补丁已被还原（被其他 kimi web 启动时的重新解压覆盖）
#                  才重新打补丁；补丁仍在则静默退出。供 start-patched-web.sh 的
#                  看门狗循环调用。
set -euo pipefail

MODE="${1:-}"

# 构建产物位置：默认取本仓库旁边的 kimi-code-src 克隆，可用 KIMI_WEB_DIST 覆盖。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${KIMI_WEB_DIST:-$SCRIPT_DIR/../kimi-code-src/apps/kimi-web/dist}"
CACHE_ROOT="$HOME/Library/Caches/kimi-code/web"

if [ ! -f "$SRC/index.html" ]; then
  echo "error: 未找到构建产物 $SRC/index.html" >&2
  echo "先在 kimi-code-src 里执行: pnpm --filter @moonshot-ai/kimi-web build" >&2
  echo "或用 KIMI_WEB_DIST=/path/to/dist 指定产物目录" >&2
  exit 1
fi

# 取最近一次解压（mtime 最新）的 dist-web，对应当前运行的 server。
TARGET=$(find "$CACHE_ROOT" -type d -name dist-web -exec stat -f '%m %N' {} \; 2>/dev/null \
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

# 两阶段写入：先同步 assets/（大文件），最后才替换 index.html。
# 这样浏览器即使在补丁中途刷新，也只会拿到"全旧"或"全新"的入口，
# 不会遇到 index.html 引用了尚未拷贝的 bundle 的白屏窗口期。
# 不用 --delete：保留官方旧 bundle，浏览器若缓存了旧 index.html 仍能正常
# 打开（显示官方界面），而不会因 404 白屏。
rsync -a "$SRC/assets/" "$TARGET/assets/"
rsync -a "$SRC/index.html" "$SRC/boot.js" "$SRC/favicon.ico" "$TARGET/"
# rsync -a 保留源文件 mtime，会让入口文件的 Last-Modified 比浏览器缓存的
# 官方版更旧；静态服务按 If-Modified-Since 回 304，浏览器继续用缓存的
# 官方 index.html（加载旧 bundle，补丁看似"没生效"）。touch 到当前时间，
# 强制下次请求返回 200。
touch "$TARGET/index.html" "$TARGET/boot.js"
if [ "$MODE" != "--if-reverted" ]; then
  echo "patched: $TARGET"
fi

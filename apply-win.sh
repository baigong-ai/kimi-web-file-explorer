#!/bin/bash
# apply-win.sh — apply.sh 的 Windows (Git Bash) 移植版。
# 把 Files 文件面板注入到正在运行的 kimi web server 的官方 UI 里：
# 只往 dist-web 拷两个静态文件，并在 index.html 里加 <link> 和
# <script defer> 各一行；官方 bundle 不做任何改动。
#
# 与 macOS 版的差异：
#   - 缓存目录：%LOCALAPPDATA%\kimi-code\web（而非 ~/Library/Caches/...）
#   - GNU stat（stat -c）替代 BSD stat（stat -f）
#   - sed -i 不带空串参数（GNU sed）
#
# 用法：./apply-win.sh [--if-reverted]
#   --if-reverted  仅当注入已被还原才重新注入；供看门狗循环调用。
set -euo pipefail

MODE="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL_DIR="${KIMI_PANEL_DIR:-$SCRIPT_DIR/panel}"
JS_SRC="$PANEL_DIR/kimi-files-panel.js"
CSS_SRC="$PANEL_DIR/kimi-files-panel.css"
CACHE_ROOT="${LOCALAPPDATA:-$HOME/AppData/Local}/kimi-code/web"
# 转成 POSIX 路径（C:\Users\... -> /c/Users/...），cp/find 需要
CACHE_ROOT=$(cygpath "$CACHE_ROOT")
MARKER='kimi-files-panel.js'

if [ ! -f "$JS_SRC" ] || [ ! -f "$CSS_SRC" ]; then
  echo "error: 未找到 $JS_SRC / $CSS_SRC" >&2
  exit 1
fi

# 取最近一次解压（mtime 最新）的 dist-web，对应当前运行的 server。
TARGET=$(find "$CACHE_ROOT" -type d -name dist-web -exec stat -c '%Y %n' {} \; 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2-)

if [ -z "${TARGET:-}" ] || [ ! -f "$TARGET/index.html" ]; then
  echo "error: $CACHE_ROOT 下没有 dist-web，请先启动一次 kimi web" >&2
  exit 1
fi

if [ "$MODE" = "--if-reverted" ] && grep -qF "$MARKER" "$TARGET/index.html"; then
  exit 0
fi

# 内容短哈希作为查询串版本号，面板文件更新后浏览器能拿到新文件。
VERSION=$(sha256sum "$JS_SRC" "$CSS_SRC" | sha256sum | cut -c1-12)

cp "$JS_SRC" "$TARGET/assets/kimi-files-panel.js"
cp "$CSS_SRC" "$TARGET/assets/kimi-files-panel.css"

LINK_TAG="<link rel=\"stylesheet\" href=\"/assets/kimi-files-panel.css?v=$VERSION\" />"
SCRIPT_TAG="<script defer src=\"/assets/kimi-files-panel.js?v=$VERSION\"></script>"

if grep -qF "$MARKER" "$TARGET/index.html"; then
  # 已注入过：只更新版本号查询串（如果有变化）。
  sed -i -E \
    -e "s|/assets/kimi-files-panel\.js\?v=[a-z0-9]+|/assets/kimi-files-panel.js?v=$VERSION|g" \
    -e "s|/assets/kimi-files-panel\.css\?v=[a-z0-9]+|/assets/kimi-files-panel.css?v=$VERSION|g" \
    "$TARGET/index.html"
else
  # 两阶段写入：先拷资源（上面已做），最后才改 index.html。
  TMP="$TARGET/index.html.kfp-tmp"
  sed -E \
    -e "s|</head>|$LINK_TAG</head>|" \
    -e "s|</body>|$SCRIPT_TAG</body>|" \
    "$TARGET/index.html" > "$TMP"
  mv "$TMP" "$TARGET/index.html"
fi

# cp 保留源文件 mtime，入口文件 Last-Modified 可能比浏览器缓存的官方版更旧，
# 静态服务按 If-Modified-Since 回 304 导致注入看似没生效。touch 强制更新。
touch "$TARGET/index.html" "$TARGET/assets/kimi-files-panel.js" "$TARGET/assets/kimi-files-panel.css"
if [ "$MODE" != "--if-reverted" ]; then
  echo "patched: $TARGET (panel v$VERSION)"
fi

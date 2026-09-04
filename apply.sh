#!/bin/bash
# apply.sh — 把 Files 文件面板注入到正在运行的 kimi web server 的官方 UI 里。
#
# 与旧的"整包替换"不同：官方 dist-web 的 bundle 一个都不动，只往资源目录
# 拷两个静态文件（kimi-files-panel.js / .css），并在 index.html 里加一行
# <script defer> 和一行 <link>。Settings、插件面板、多技能 composer 等官方
# 功能始终保持当前安装版本。
#
# 原理：kimi 单文件二进制每次启动 `kimi web` 时，会把内嵌的官方 web 资源
# 按 sha256 校验重新解压到 ~/Library/Caches/kimi-code/web/**/dist-web，
# index.html 会被还原（注入随之失效）；但 server 启动后按请求直接从磁盘读
# 文件。因此本脚本必须在 server 启动【之后】运行；若之后又有别的 kimi web
# 启动把 index.html 还原了，重跑一次本脚本即可（start-patched-web.sh 的
# 看门狗会自动做）。
#
# 用法：./apply.sh [--if-reverted]
#   --if-reverted  仅当注入已被还原才重新注入；注入仍在则静默退出。
#                  供 start-patched-web.sh 的看门狗循环调用。
set -euo pipefail

MODE="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL_DIR="${KIMI_PANEL_DIR:-$SCRIPT_DIR/panel}"
JS_SRC="$PANEL_DIR/kimi-files-panel.js"
CSS_SRC="$PANEL_DIR/kimi-files-panel.css"
CACHE_ROOT="$HOME/Library/Caches/kimi-code/web"
MARKER='kimi-files-panel.js'

if [ ! -f "$JS_SRC" ] || [ ! -f "$CSS_SRC" ]; then
  echo "error: 未找到 $JS_SRC / $CSS_SRC" >&2
  exit 1
fi

# 取最近一次解压（mtime 最新）的 dist-web，对应当前运行的 server。
TARGET=$(find "$CACHE_ROOT" -type d -name dist-web -exec stat -f '%m %N' {} \; 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2-)

if [ -z "${TARGET:-}" ] || [ ! -f "$TARGET/index.html" ]; then
  echo "error: $CACHE_ROOT 下没有 dist-web，请先启动一次 kimi web" >&2
  exit 1
fi

if [ "$MODE" = "--if-reverted" ] && grep -qF "$MARKER" "$TARGET/index.html"; then
  exit 0
fi

# 内容短哈希作为查询串版本号：面板文件更新后浏览器能拿到新文件
#（server 静态响应带 cache-control: no-cache，但带上版本号更保险）。
VERSION=$(shasum -a 256 "$JS_SRC" "$CSS_SRC" | shasum -a 256 | cut -c1-12)

cp "$JS_SRC" "$TARGET/assets/kimi-files-panel.js"
cp "$CSS_SRC" "$TARGET/assets/kimi-files-panel.css"

LINK_TAG="<link rel=\"stylesheet\" href=\"/assets/kimi-files-panel.css?v=$VERSION\" />"
SCRIPT_TAG="<script defer src=\"/assets/kimi-files-panel.js?v=$VERSION\"></script>"

if grep -qF "$MARKER" "$TARGET/index.html"; then
  # 已注入过：只更新版本号查询串（如果有变化）。
  sed -i '' -E \
    -e "s|/assets/kimi-files-panel\.js\?v=[a-z0-9]+|/assets/kimi-files-panel.js?v=$VERSION|g" \
    -e "s|/assets/kimi-files-panel\.css\?v=[a-z0-9]+|/assets/kimi-files-panel.css?v=$VERSION|g" \
    "$TARGET/index.html"
else
  # 两阶段写入：先拷资源（上面已做），最后才改 index.html。
  # 浏览器即使在注入中途刷新，也只会拿到"全旧"或"全新"的入口。
  TMP="$TARGET/index.html.kfp-tmp"
  sed -E \
    -e "s|</head>|$LINK_TAG</head>|" \
    -e "s|</body>|$SCRIPT_TAG</body>|" \
    "$TARGET/index.html" > "$TMP"
  mv "$TMP" "$TARGET/index.html"
fi

# cp 保留源文件 mtime，会让入口文件的 Last-Modified 比浏览器缓存的官方版
# 更旧；静态服务按 If-Modified-Since 回 304，浏览器继续用缓存的官方
# index.html（没有 script 标签，注入看似"没生效"）。touch 到当前时间，
# 强制下次请求返回 200。
touch "$TARGET/index.html" "$TARGET/assets/kimi-files-panel.js" "$TARGET/assets/kimi-files-panel.css"

if [ "$MODE" != "--if-reverted" ]; then
  echo "patched: $TARGET (panel v$VERSION)"
fi

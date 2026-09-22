#!/usr/bin/env bash
# 构建 SkillDock 的 Linux 安装包（deb / rpm / AppImage）。
#
# 用法：
#   Docker： 容器入口（WORKDIR=/work），参数 amd64 | aarch64
#   WSL：    cd <仓库根目录> && src-tauri/docker/build.sh amd64|aarch64
#
# 环境变量：
#   REPO              仓库根目录（默认当前目录）
#   CARGO_TARGET_DIR  构建产物目录（默认 $REPO/src-tauri/target-linux，
#                     与宿主机 Windows 构建的 src-tauri/target 隔离；
#                     WSL 中可指向 $HOME/target-linux 避开 9p 文件系统）
set -euo pipefail

ARCH="${1:-amd64}"
REPO="${REPO:-$(pwd)}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$REPO/src-tauri/target-linux}"

cd "$REPO"

CROSS_ENV=()
case "$ARCH" in
  amd64)
    TARGET="x86_64-unknown-linux-gnu"
    OUT_DIR="$REPO/dist-release/linux/x86_64"
    ;;
  aarch64)
    TARGET="aarch64-unknown-linux-gnu"
    OUT_DIR="$REPO/dist-release/linux/aarch64"
    CROSS_ENV=(
      "CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc"
      "CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc"
      "PKG_CONFIG_ALLOW_CROSS=1"
      "PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig"
    )
    ;;
  *)
    echo "usage: build-linux.sh [amd64|aarch64]" >&2
    exit 2
    ;;
esac

# linuxdeploy/appimagetool 在 x86_64 上运行其它架构 ELF 时需要 FUSE-free 的解压运行模式
export APPIMAGE_EXTRACT_AND_RUN=1

echo "==> 环境"
node --version
npm --version
rustc --version

echo "==> 安装前端依赖（Linux 原生二进制，不复用宿主机 node_modules）"
npm ci --no-audit --no-fund

echo "==> 构建 $TARGET（deb / rpm / AppImage）"
if [ "$ARCH" = "amd64" ]; then
  npm run tauri:build -- --bundles deb,rpm,appimage
  BUNDLE_DIR="$CARGO_TARGET_DIR/release/bundle"
else
  env "${CROSS_ENV[@]}" npm run tauri:build -- --bundles deb,rpm,appimage --target "$TARGET"
  BUNDLE_DIR="$CARGO_TARGET_DIR/$TARGET/release/bundle"
fi

mkdir -p "$OUT_DIR"
for kind in deb rpm appimage; do
  src="$BUNDLE_DIR/$kind"
  if [ -d "$src" ]; then
    mkdir -p "$OUT_DIR/$kind"
    # 只拷贝最终产物文件：AppImage 目录下的 AppDir 中间产物含符号链接，
    # 无法复制到 /mnt（DrvFs 不支持创建符号链接）
    find "$src" -maxdepth 1 -type f -exec cp -f {} "$OUT_DIR/$kind/" \;
  else
    echo "警告：未找到 $kind 产物（$src）" >&2
  fi
done

echo "==> 完成，产物位于 $OUT_DIR"
find "$OUT_DIR" -type f | sort

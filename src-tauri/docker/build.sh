#!/usr/bin/env bash
# 构建 SkillDock 的 Linux 安装包（deb / rpm / AppImage）。
#
# 用法：
#   Docker： 容器入口（WORKDIR=/work），参数 amd64 | aarch64
#   WSL：    cd <仓库根目录> && src-tauri/docker/build.sh amd64|aarch64
#
# 环境变量：
#   REPO              仓库根目录（默认当前目录）
#   CARGO_TARGET_DIR  构建产物目录（默认 $REPO/src-tauri/target-linux/<架构>，
#                     与宿主机 Windows 及另一架构的构建产物隔离；
#                     WSL 中可指向 $HOME/target-linux 避开 9p 文件系统）
set -euo pipefail

ARCH="${1:-amd64}"
REPO="${REPO:-$(pwd)}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$REPO/src-tauri/target-linux/$ARCH}"

cd "$REPO"

case "$ARCH" in
  amd64)
    EXPECTED_MACHINE="x86_64"
    OUT_DIR="$REPO/dist-release/linux/x86_64"
    ;;
  aarch64)
    EXPECTED_MACHINE="aarch64"
    OUT_DIR="$REPO/dist-release/linux/aarch64"
    ;;
  *)
    echo "usage: build-linux.sh [amd64|aarch64]" >&2
    exit 2
    ;;
esac

ACTUAL_MACHINE="$(uname -m)"
if [ "$ACTUAL_MACHINE" != "$EXPECTED_MACHINE" ]; then
  echo "错误：请求构建 $ARCH，但当前容器架构为 $ACTUAL_MACHINE" >&2
  echo "请使用 docker buildx build --platform linux/$ARCH 构建对应镜像。" >&2
  exit 2
fi

# AppImage 工具在容器中以免 FUSE 模式运行
export APPIMAGE_EXTRACT_AND_RUN=1

echo "==> 环境"
node --version
npm --version
rustc --version

echo "==> 安装前端依赖（Linux 原生二进制，不复用宿主机 node_modules）"
npm ci --no-audit --no-fund

echo "==> 构建 Linux $ARCH（deb / rpm / AppImage）"
npm run tauri:build -- --bundles deb,rpm,appimage
BUNDLE_DIR="$CARGO_TARGET_DIR/release/bundle"

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

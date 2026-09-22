# SkillDock Linux 打包镜像（Tauri v2）
#
# 用法（在仓库根目录）：
#   docker build -t skilldock-linux-builder src-tauri/docker
#   docker run --rm -v "$(pwd):/work" skilldock-linux-builder amd64
#   docker run --rm -v "$(pwd):/work" skilldock-linux-builder aarch64
#
# 产物输出到宿主机：
#   dist-release/linux/x86_64/{deb,rpm,appimage}/...
#   dist-release/linux/aarch64/{deb,rpm,appimage}/...
#
# 注意：
# - aarch64 为 amd64 宿主机上的交叉编译。
# - AppImage 打包阶段的 linuxdeploy 需要在 x86_64 上运行 aarch64 ELF，
#   依赖 qemu-user-static（Docker Desktop 的 Linux VM 默认注册 binfmt）。
# - 所有外部源使用国内镜像（Docker 基础镜像 / apt / node / rustup / npm），
#   避免跨境网络限速导致构建卡死。
FROM docker.1ms.run/library/ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# apt 换阿里云源
RUN sed -i 's|//.*archive.ubuntu.com|//mirrors.aliyun.com|g; s|//security.ubuntu.com|//mirrors.aliyun.com|g' /etc/apt/sources.list.d/ubuntu.sources \
    && dpkg --add-architecture arm64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        file \
        patchelf \
        pkg-config \
        rpm \
        wget \
        xz-utils \
        xdg-utils \
        qemu-user-static \
        gcc-aarch64-linux-gnu \
        g++-aarch64-linux-gnu \
        libssl-dev \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libwebkit2gtk-4.1-dev:arm64 \
        libgtk-3-dev:arm64 \
        libayatana-appindicator3-dev:arm64 \
        librsvg2-dev:arm64 \
    && rm -rf /var/lib/apt/lists/*

RUN update-binfmts --enable qemu-aarch64 2>/dev/null || true

# Node 24 LTS（npmmirror 二进制发行版，无需 nodesource）
ENV NODE_VERSION=v24.9.0
RUN curl -fsSL "https://registry.npmmirror.com/-/binary/node/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version && npm --version \
    && npm config set registry https://registry.npmmirror.com

# Rust 工具链（rsproxy 镜像；target aarch64 供交叉编译）
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin \
    RUSTUP_DIST_SERVER=https://rsproxy.cn \
    RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
RUN curl -fsSL "https://rsproxy.cn/rustup/dist/x86_64-unknown-linux-gnu/rustup-init" -o /usr/local/bin/rustup-init \
    && chmod +x /usr/local/bin/rustup-init \
    && rustup-init -y --default-toolchain stable --profile minimal --no-modify-path \
    && rustup target add aarch64-unknown-linux-gnu

# Linux 构建使用独立的 target 目录，避免与宿主机 Windows 构建产物互相污染
ENV CARGO_TARGET_DIR=/work/src-tauri/target-linux

COPY build.sh /usr/local/bin/build-linux.sh
RUN chmod +x /usr/local/bin/build-linux.sh

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/build-linux.sh"]

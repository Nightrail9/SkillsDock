# SkillDock Linux 打包镜像（Tauri v2）
#
# 用法（在仓库根目录）：
#   docker buildx build --load --platform linux/amd64 -t skilldock-linux-builder:amd64 src-tauri/docker
#   docker buildx build --load --platform linux/arm64 -t skilldock-linux-builder:aarch64 src-tauri/docker
#   docker run --rm --platform linux/amd64 -v "$(pwd):/work" -v skilldock-node-amd64:/work/node_modules -v skilldock-cargo-registry-amd64:/usr/local/cargo/registry -v skilldock-target-amd64:/work/src-tauri/target-linux/amd64 skilldock-linux-builder:amd64 amd64
#   docker run --rm --platform linux/arm64 -v "$(pwd):/work" -v skilldock-node-arm64:/work/node_modules -v skilldock-cargo-registry-arm64:/usr/local/cargo/registry -v skilldock-target-arm64:/work/src-tauri/target-linux/aarch64 skilldock-linux-builder:aarch64 aarch64
#
# 产物输出到宿主机：
#   dist-release/linux/x86_64/{deb,rpm,appimage}/...
#   dist-release/linux/aarch64/{deb,rpm,appimage}/...
#
# 注意：
# - 两个架构分别在对应架构容器中原生构建，Docker Desktop 负责 arm64 模拟。
# - node_modules、Cargo 注册表与 target 使用架构独立的 Docker volume，
#   避免覆盖宿主机依赖，并绕开 Windows 绑定目录的小文件 I/O 瓶颈。
# - 所有外部源使用国内镜像（Docker 基础镜像 / apt / node / rustup / npm），
#   避免跨境网络限速导致构建卡死。
FROM docker.1ms.run/library/ubuntu:24.04

ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive

# apt 按容器架构切换阿里云对应归档。
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && sed -i \
        -e 's|http://archive.ubuntu.com/ubuntu|http://mirrors.aliyun.com/ubuntu|g' \
        -e 's|http://security.ubuntu.com/ubuntu|http://mirrors.aliyun.com/ubuntu|g' \
        -e 's|http://ports.ubuntu.com/ubuntu-ports|http://mirrors.aliyun.com/ubuntu-ports|g' \
        -e 's|https://ports.ubuntu.com/ubuntu-ports|http://mirrors.aliyun.com/ubuntu-ports|g' \
        /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get -o Acquire::Retries=10 -o Acquire::http::Timeout=90 update \
    && packages="build-essential ca-certificates curl file patchelf pkg-config rpm wget xz-utils xdg-utils libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev" \
    && for attempt in 1 2 3 4 5; do \
         apt-get -o Acquire::Retries=10 -o Acquire::http::Timeout=90 install -y --no-install-recommends $packages && break; \
         if [ "$attempt" = 5 ]; then exit 1; fi; \
         echo "apt 安装失败，第 $attempt 次重试" >&2; \
         sleep 5; \
       done

# Node 24 LTS（npmmirror 二进制发行版，无需 nodesource）
ENV NODE_VERSION=v24.9.0
RUN case "$TARGETARCH" in amd64) NODE_ARCH=x64 ;; arm64) NODE_ARCH=arm64 ;; *) exit 2 ;; esac \
    && curl -fsSL "https://registry.npmmirror.com/-/binary/node/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version && npm --version \
    && npm config set registry https://registry.npmmirror.com

# Rust 工具链（rsproxy 镜像）
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin \
    RUSTUP_DIST_SERVER=https://rsproxy.cn \
    RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
RUN case "$TARGETARCH" in amd64) RUST_ARCH=x86_64 ;; arm64) RUST_ARCH=aarch64 ;; *) exit 2 ;; esac \
    && curl -fsSL "https://rsproxy.cn/rustup/dist/${RUST_ARCH}-unknown-linux-gnu/rustup-init" -o /usr/local/bin/rustup-init \
    && chmod +x /usr/local/bin/rustup-init \
    && rustup-init -y --default-toolchain stable --profile minimal --no-modify-path

COPY build.sh /usr/local/bin/build-linux.sh
RUN chmod +x /usr/local/bin/build-linux.sh

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/build-linux.sh"]

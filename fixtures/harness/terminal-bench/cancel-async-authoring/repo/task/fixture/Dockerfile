FROM niceeval/codex@sha256:157152804b0ac443e62936d3ce2c8191a1df125bdcb121370c05c00be7c8ab96 AS node

FROM python:3.11.9-bookworm@sha256:c95170ff7d59de63e9445d3d503644a635c1b8cb7f4fa99f19a1c76da92a849a
COPY --from=node /usr/local/bin/node /usr/local/bin/node

RUN mkdir -p /home/sandbox/workspace \
 && if [ -L /app ]; then test "$(readlink -f /app)" = "/home/sandbox/workspace"; \
    elif [ -e /app ]; then test -d /app && test -z "$(find /app -mindepth 1 -maxdepth 1 -print -quit)" && rmdir /app; fi \
 && if [ ! -L /app ]; then ln -s /home/sandbox/workspace /app; fi \
 && test "$(readlink -f /app)" = "/home/sandbox/workspace"

WORKDIR /home/sandbox/workspace

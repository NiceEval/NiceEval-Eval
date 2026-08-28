FROM cache.invalid/niceeval-harness/runtime:python

RUN mkdir -p /home/sandbox/workspace \
 && if [ -L /app ]; then test "$(readlink -f /app)" = "/home/sandbox/workspace"; \
    elif [ -e /app ]; then test -d /app && test -z "$(find /app -mindepth 1 -maxdepth 1 -print -quit)" && rmdir /app; fi \
 && if [ ! -L /app ]; then ln -s /home/sandbox/workspace /app; fi \
 && test "$(readlink -f /app)" = "/home/sandbox/workspace"

WORKDIR /home/sandbox/workspace

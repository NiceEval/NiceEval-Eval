import json
import os
from pathlib import Path
import pwd
import stat
import sys
import time


def bounded(items, limit=30):
    return {"entries": items[:limit], "total": len(items), "truncated": len(items) > limit}


def process_stat(pid):
    # comm is parenthesized and can itself contain spaces or parentheses.
    raw = (Path("/proc") / str(pid) / "stat").read_text(errors="replace")
    name, _, fields = raw.partition(" (")[2].rpartition(") ")
    values = fields.split()
    return name, values[0], int(values[1]), int(values[19])


def processes(uid, started):
    ancestors = set()
    pid = os.getpid()
    while pid:
        ancestors.add(pid)
        pid = process_stat(pid)[2]

    items = []
    for entry in sorted((p for p in Path("/proc").iterdir() if p.name.isdecimal()), key=lambda p: int(p.name)):
        pid = int(entry.name)
        if pid in ancestors:
            continue
        try:
            if entry.stat().st_uid != uid:
                continue
            name, state, parent, start = process_stat(pid)
            if start <= started or state in {"Z", "X"} or name in {"codex", "codex-linux-x86"}:
                continue
            items.append({"pid": pid, "parentPid": parent, "name": name, "startTicks": start})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            # A process can exit while /proc is being scanned.
            continue
    return bounded(items)


def files(root, accept, skip):
    items = []
    for directory, dirs, names in os.walk(root):
        dirs[:] = sorted(name for name in dirs if not skip(Path(directory) / name))
        for name in sorted(dirs + names):
            path = Path(directory) / name
            if skip(path):
                continue
            try:
                info = path.lstat()
            except FileNotFoundError:
                continue
            if accept(path, info):
                kind = "directory" if stat.S_ISDIR(info.st_mode) else "symlink" if stat.S_ISLNK(info.st_mode) else "file"
                items.append({"path": str(path), "kind": kind, "bytes": info.st_size})
    return bounded(items)


mode, marker_path = sys.argv[1:3]
marker = Path(marker_path)
if mode == "mark":
    marker.write_text(json.dumps({
        "startTicks": int(time.clock_gettime(time.CLOCK_BOOTTIME) * os.sysconf("SC_CLK_TCK")),
        "tracked": json.loads(os.environ["CONCORD_RSI_BASELINE_FILES"]),
    }))
    sys.exit(0)

uid = int(sys.argv[3])
project = Path(sys.argv[4]).resolve()
home = Path(pwd.getpwuid(uid).pw_dir).resolve()
initial = json.loads(marker.read_text())
marked_at = marker.stat().st_mtime_ns
live_processes = processes(uid, initial["startTicks"])
tracked = set(initial["tracked"])
excluded = {project / name for name in (".git", ".niceeval", "node_modules", "vendor/concord", "assistant", "experiments")}


def after_start(path, info):
    return info.st_uid == uid and info.st_mtime_ns > marked_at


def new_project_file(path, info):
    return (
        not stat.S_ISDIR(info.st_mode)
        and path.relative_to(project).as_posix() not in tracked
        and info.st_ctime_ns > marked_at
    )


print(json.dumps({
    "processes": live_processes,
    "tmp": files(Path("/tmp"), after_start, lambda path: path in {project, home}),
    "home": files(home, after_start, lambda path: path == project),
    "project": files(project, new_project_file, excluded.__contains__),
}, sort_keys=True))

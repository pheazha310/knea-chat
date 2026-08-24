#!/usr/bin/env python3
"""KneaChat server supervisor daemon.

Keeps the KneaChat Node server (server/src/server.js) running and its logs
bounded:

  * Auto-restarts the server whenever it exits unexpectedly, with exponential
    backoff (--restart-delay up to --max-restart-delay) that resets once the
    server has stayed up for --healthy-uptime seconds.
  * Rotates the server log when it grows past --max-log-bytes: the log is
    rolled to log.1, log.2, ... (--keep-logs backups), then the server is
    gracefully restarted so the fresh process writes to a clean log. The
    existing oversized log is also rotated at startup.
  * Writes the server PID to --pidfile so health checks and tooling can find
    it, and its own PID to --supervisor-pidfile to prevent double supervision.
  * Stops the server cleanly on SIGTERM/SIGINT (and via the `stop` subcommand).

Subcommands:
  start                 detach and supervise (default)
  foreground            supervise in the foreground (logs to stderr)
  status                show supervisor + server state
  stop                  stop the supervisor and the server
  restart               stop, then start fresh

Options (start/foreground):
  --workdir DIR          server directory (default: this script's ../..)
  --log FILE             server log (default: /tmp/kneachat-server.log)
  --pidfile FILE         server PID file (default: /tmp/kneachat-server.pid)
  --supervisor-log FILE  supervisor log (default: /tmp/kneachat-supervisor.log)
  --supervisor-pidfile   supervisor PID file (default: /tmp/kneachat-supervisor.pid)
  --max-log-bytes N      rotate when the log exceeds N bytes (default: 10 MiB)
  --keep-logs N          number of rotated log backups to keep (default: 3)
  --restart-delay N      base seconds before a restart (default: 2)
  --max-restart-delay N  backoff cap in seconds (default: 30)
  --healthy-uptime N     uptime (s) after which the crash counter resets (default: 30)
  --stop-timeout N       seconds to wait for a graceful stop before SIGKILL (default: 10)
  --check-interval N     seconds between log-size checks (default: 3)
  --force                when starting, kill a previously running supervisor
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_WORKDIR = str(SCRIPT_DIR.parent)
DEFAULT_LOG = "/tmp/kneachat-server.log"
DEFAULT_PIDFILE = "/tmp/kneachat-server.pid"
DEFAULT_SUPERVISOR_LOG = "/tmp/kneachat-supervisor.log"
DEFAULT_SUPERVISOR_PIDFILE = "/tmp/kneachat-supervisor.pid"


def log_line(message: str) -> str:
    return f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}"


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def read_pid(path: str) -> int:
    try:
        return int(Path(path).read_text().strip())
    except (OSError, ValueError):
        return 0


def stop_process(pid: int, force: bool, timeout: float) -> None:
    """Stop a process: SIGTERM (or SIGKILL), then wait, then SIGKILL as fallback."""
    if not pid_alive(pid):
        return
    try:
        os.kill(pid, signal.SIGKILL if force else signal.SIGTERM)
    except ProcessLookupError:
        return
    if force:
        return
    deadline = time.time() + timeout
    while time.time() < deadline and pid_alive(pid):
        time.sleep(0.2)
    if pid_alive(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


class Supervisor:
    def __init__(self, args: argparse.Namespace, foreground: bool):
        self.args = args
        self.foreground = foreground
        self.child: subprocess.Popen | None = None
        self.child_log = None
        self.stopping = False
        self.restarting = False  # True while a rotation-restart is in progress
        self.started_at = 0.0
        self.last_size_check = 0.0

    # ------------------------------------------------------------------ log
    def log(self, message: str) -> None:
        line = log_line(message)
        if self.foreground:
            print(line, file=sys.stderr, flush=True)
        try:
            with open(self.args.supervisor_log, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass

    # ------------------------------------------------------------ pidfiles
    def write_pidfile(self) -> None:
        Path(self.args.supervisor_pidfile).write_text(str(os.getpid()))

    def remove_pidfile(self) -> None:
        try:
            Path(self.args.supervisor_pidfile).unlink(missing_ok=True)
        except OSError:
            pass

    def write_child_pidfile(self) -> None:
        if self.child is not None:
            Path(self.args.pidfile).write_text(str(self.child.pid))

    def remove_child_pidfile(self) -> None:
        try:
            Path(self.args.pidfile).unlink(missing_ok=True)
        except OSError:
            pass

    # ------------------------------------------------------------- logging
    def log_size(self) -> int:
        try:
            return os.path.getsize(self.args.log)
        except OSError:
            return 0

    def rotate_logs(self) -> None:
        keep = max(1, self.args.keep_logs)
        for i in range(keep - 1, 0, -1):
            src = f"{self.args.log}.{i}"
            dst = f"{self.args.log}.{i + 1}"
            if os.path.exists(src):
                os.replace(src, dst)
        if os.path.exists(self.args.log):
            os.replace(self.args.log, f"{self.args.log}.1")
        self.log(f"rotated {self.args.log} (keeping {keep} backup(s))")

    # ------------------------------------------------------------- signals
    def _handle_signal(self, signum, _frame) -> None:
        self.log(f"received signal {signum} — shutting down")
        self.stopping = True

    # --------------------------------------------------------------- child
    def start_child(self) -> None:
        self.close_child_log()
        logf = open(self.args.log, "ab", buffering=0)
        self.child_log = logf
        self.child = subprocess.Popen(
            ["node", "src/server.js"],
            cwd=self.args.workdir,
            stdout=logf,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        self.write_child_pidfile()
        self.started_at = time.time()
        self.log(f"started server pid={self.child.pid}")

    def close_child_log(self) -> None:
        if self.child_log is not None:
            try:
                self.child_log.close()
            except OSError:
                pass
            self.child_log = None

    def stop_child(self) -> None:
        if self.child is None:
            self.remove_child_pidfile()
            return
        if self.child.poll() is not None:
            self.close_child_log()
            self.remove_child_pidfile()
            return
        pid = self.child.pid
        self.log(f"stopping server pid={pid} (SIGTERM, timeout {self.args.stop_timeout}s)")
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            self.child.wait(timeout=self.args.stop_timeout)
        except subprocess.TimeoutExpired:
            self.log(f"server pid={pid} did not stop in time — SIGKILL")
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.child.wait()
        self.close_child_log()
        self.remove_child_pidfile()
        self.log(f"server pid={pid} stopped")

    # ------------------------------------------------------------ rotation
    def maybe_rotate(self) -> bool:
        """Rotate + restart the child if the log has grown past the cap."""
        if self.log_size() < self.args.max_log_bytes:
            return False
        self.restarting = True
        self.log(
            f"log is {self.log_size()} bytes (cap {self.args.max_log_bytes}) "
            "— rotating and restarting"
        )
        self.stop_child()
        self.rotate_logs()
        return True

    # ------------------------------------------------------------ backoff
    def backoff_delay(self, consecutive_crashes: int) -> float:
        if consecutive_crashes <= 1:
            return float(self.args.restart_delay)
        delay = self.args.restart_delay * (2 ** (consecutive_crashes - 1))
        return min(delay, float(self.args.max_restart_delay))

    def wait_or_stop(self, seconds: float) -> None:
        end = time.time() + seconds
        while time.time() < end and not self.stopping:
            time.sleep(0.2)

    # ------------------------------------------------------------ main loop
    def supervise(self) -> int:
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)
        self.write_pidfile()
        self.log(
            f"supervisor started (pid={os.getpid()}, workdir={self.args.workdir}, "
            f"log={self.args.log}, cap={self.args.max_log_bytes})"
        )

        # A leftover oversized log from a previous run is rotated at startup.
        if self.log_size() >= self.args.max_log_bytes:
            self.rotate_logs()

        consecutive_crashes = 0
        while not self.stopping:
            # Child exited (or was never started) → restart it.
            if self.child is None or self.child.poll() is not None:
                if self.child is not None:
                    code = self.child.poll()
                    if self.restarting:
                        self.log(f"server stopped for rotation (code={code})")
                        consecutive_crashes = 0
                        self.restarting = False
                    else:
                        self.log(f"server exited unexpectedly (code={code})")
                        consecutive_crashes += 1
                    self.close_child_log()
                    self.remove_child_pidfile()

                delay = self.backoff_delay(consecutive_crashes)
                if consecutive_crashes >= 2:
                    self.log(
                        f"crash counter at {consecutive_crashes} — "
                        f"restarting in {delay:.0f}s (backoff)"
                    )
                self.wait_or_stop(delay)
                if self.stopping:
                    break
                self.start_child()
                continue

            # Child is healthy → periodic housekeeping.
            if time.time() - self.last_size_check >= self.args.check_interval:
                self.last_size_check = time.time()
                if self.maybe_rotate():
                    # The loop will pick up the exited child and restart it.
                    continue

            if consecutive_crashes and time.time() - self.started_at >= self.args.healthy_uptime:
                self.log("server healthy — crash counter reset")
                consecutive_crashes = 0

            self.wait_or_stop(1.0)

        self.stop_child()
        self.log("supervisor stopped")
        self.remove_pidfile()
        return 0


# -------------------------------------------------------------- daemonizing
def daemonize() -> None:
    if os.fork() > 0:
        os._exit(0)
    os.setsid()
    if os.fork() > 0:
        os._exit(0)
    os.umask(0)
    sys.stdout.flush()
    sys.stderr.flush()
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    os.close(devnull)


def stop_supervisor(supervisor_pidfile: str, pidfile: str, force: bool) -> int:
    """Stop a running supervisor (and its server child) — idempotent."""
    sup_pid = read_pid(supervisor_pidfile)
    child_pid = read_pid(pidfile)
    stopped_any = False

    if sup_pid and pid_alive(sup_pid):
        print(f"stopping supervisor pid={sup_pid} ...")
        stop_process(sup_pid, force, 12)
        stopped_any = True
        # The supervisor may have restarted the child while we stopped it —
        # re-read the pidfile so a fresh child doesn't escape.
        child_pid = read_pid(pidfile)

    if child_pid and pid_alive(child_pid):
        print(f"stopping orphaned server pid={child_pid} ...")
        stop_process(child_pid, force, 12)
        stopped_any = True

    for path in (supervisor_pidfile, pidfile):
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass

    if not stopped_any:
        print("nothing running")
    return 0


def cmd_status(supervisor_pidfile: str, pidfile: str) -> int:
    sup_pid = read_pid(supervisor_pidfile)
    child_pid = read_pid(pidfile)
    sup_alive = pid_alive(sup_pid) if sup_pid else False
    child_alive = pid_alive(child_pid) if child_pid else False

    print(f"supervisor: {'running (pid ' + str(sup_pid) + ')' if sup_alive else 'not running'}")
    print(f"server:     {'running (pid ' + str(child_pid) + ')' if child_alive else 'not running'}")
    if not sup_alive and not child_alive:
        print("(stale pidfiles cleaned up)")
        for path in (supervisor_pidfile, pidfile):
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="KneaChat server supervisor (auto-restart + log rotation)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command")
    for name in ("start", "foreground"):
        p = sub.add_parser(name)
        p.add_argument("--workdir", default=DEFAULT_WORKDIR)
        p.add_argument("--log", default=DEFAULT_LOG)
        p.add_argument("--pidfile", default=DEFAULT_PIDFILE)
        p.add_argument("--supervisor-log", default=DEFAULT_SUPERVISOR_LOG)
        p.add_argument("--supervisor-pidfile", default=DEFAULT_SUPERVISOR_PIDFILE)
        p.add_argument("--max-log-bytes", type=int, default=10 * 1024 * 1024)
        p.add_argument("--keep-logs", type=int, default=3)
        p.add_argument("--restart-delay", type=int, default=2)
        p.add_argument("--max-restart-delay", type=int, default=30)
        p.add_argument("--healthy-uptime", type=int, default=30)
        p.add_argument("--stop-timeout", type=int, default=10)
        p.add_argument("--check-interval", type=int, default=3)
        p.add_argument("--force", action="store_true", help="kill a previous supervisor first")
    sub.add_parser("status")
    sub.add_parser("stop")
    sub.add_parser("restart")
    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    command = args.command or "start"

    if command == "status":
        return cmd_status(DEFAULT_SUPERVISOR_PIDFILE, DEFAULT_PIDFILE)

    if command == "stop":
        return stop_supervisor(DEFAULT_SUPERVISOR_PIDFILE, DEFAULT_PIDFILE, force=False)

    if command == "restart":
        stop_supervisor(DEFAULT_SUPERVISOR_PIDFILE, DEFAULT_PIDFILE, force=False)
        time.sleep(1)
        args = parser.parse_args(["start"])
        command = "start"

    # start / foreground
    args.workdir = str(Path(args.workdir).resolve())
    existing = read_pid(args.supervisor_pidfile)
    if existing and pid_alive(existing):
        if not args.force:
            print(
                f"supervisor already running (pid={existing}) — use `stop`/`restart` "
                "or --force",
                file=sys.stderr,
            )
            return 1
        stop_supervisor(args.supervisor_pidfile, args.pidfile, force=True)
        time.sleep(1)

    # Stop an orphaned server (e.g. left by the old fire-and-forget launcher)
    # so the port is free before we spawn our own.
    orphan = read_pid(args.pidfile)
    if orphan and pid_alive(orphan):
        print(f"stopping orphaned server pid={orphan} before start ...", file=sys.stderr)
        stop_process(orphan, False, args.stop_timeout)

    if command == "foreground":
        return Supervisor(args, foreground=True).supervise()

    daemonize()
    # supervise() writes the supervisor pidfile from the detached process.
    return Supervisor(args, foreground=False).supervise()


if __name__ == "__main__":
    sys.exit(main())

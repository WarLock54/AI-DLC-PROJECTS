#!/usr/bin/env python3
"""Install the project's engine repair for terminal and harness invocations."""
import argparse
import os
from pathlib import Path
import shlex
import shutil
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--print", action="store_true", help="print the launcher without installing")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
launcher = Path.home() / ".local/bin/aidlc"
backup = launcher.with_name("aidlc.native-before-team-progress")
bun = shutil.which("bun")
if not bun:
    raise SystemExit("Bun is required to run the patched project engine.")
quote = shlex.quote
marker = "# Project-specific AI-DLC shared-progress hotfix; native fallback is preserved."
script = f'''#!/bin/sh
{marker}
case "$PWD" in
  {quote(str(root))}|{quote(str(root))}/*)
    case "${{1-}}" in
      engine|unit|--status|--resume|--scope|--claim|--release|next|continue|report|park|team-board|compose) exec {quote(bun)} {quote(str(root / '.claude/tools/aidlc.ts'))} "$@" ;;
    esac
    ;;
esac
exec {quote(str(backup))} "$@"
'''
if args.print:
    print(script, end="")
else:
    if not launcher.is_file():
        raise SystemExit(f"Expected an existing AI-DLC launcher at {launcher}.")
    existing = launcher.read_bytes()
    if backup.exists() and marker.encode() not in existing:
        raise SystemExit("The native launcher changed since this repair. Review the backup before reinstalling.")
    if not backup.exists():
        if marker.encode() in existing:
            raise SystemExit("Cannot install: the original native launcher backup is missing.")
        shutil.copy2(launcher, backup)
    fd, temporary = tempfile.mkstemp(prefix=".aidlc-repair-", dir=launcher.parent)
    try:
        with os.fdopen(fd, "w") as output:
            output.write(script)
        os.chmod(temporary, 0o755)
        os.replace(temporary, launcher)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f"Installed project engine repair at {launcher}; native backup: {backup}")

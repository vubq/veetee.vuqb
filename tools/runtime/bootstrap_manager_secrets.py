#!/usr/bin/env python3
"""Create owner-read bootstrap material without printing its value."""

from __future__ import annotations

import argparse
from pathlib import Path
import secrets


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--master-path', default='secrets/manager.secret')
    parser.add_argument('--auth-path', default=None)
    args = parser.parse_args()
    paths = [Path(args.master_path)] + ([Path(args.auth_path)] if args.auth_path else [])
    for path in paths:
        if path.exists():
            raise SystemExit(f'refusing to overwrite existing secret file: {path}')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_urlsafe(48) + '\n', encoding='utf-8')
        path.chmod(0o600)
    print(f'created {len(paths)} owner-read manager secret file(s)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

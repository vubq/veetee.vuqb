"""Service entrypoint."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from aiohttp import web

from .app import VoiceApplication
from .config import ServerConfig
from .runtime import RuntimeConfigManager
from .secrets import EncryptedFileSecretResolver


async def serve() -> None:
    config = ServerConfig.from_env()
    logging.basicConfig(level=getattr(logging, config.log_level, logging.INFO), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    secret_file = Path(os.environ["VEETEE_GROQ_SECRET_FILE"]) if os.environ.get("VEETEE_GROQ_SECRET_FILE") else None
    secret_store_file = os.environ.get("VEETEE_SECRET_STORE_FILE")
    secret_master_file = os.environ.get("VEETEE_SECRET_MASTER_KEY_FILE")
    if bool(secret_store_file) != bool(secret_master_file):
        raise RuntimeError("VEETEE_SECRET_STORE_FILE and VEETEE_SECRET_MASTER_KEY_FILE must be configured together")
    secret_resolver = None
    if secret_store_file and secret_master_file:
        master_material = Path(secret_master_file).read_text(encoding="utf-8").strip()
        secret_resolver = EncryptedFileSecretResolver(Path(secret_store_file), master_material)
    runtime = RuntimeConfigManager(config, secret_file=secret_file, secret_resolver=secret_resolver)
    await runtime.start()
    voice = VoiceApplication(config, runtime)
    runner = web.AppRunner(voice.make_app(), access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, config.host, config.port)
    await site.start()
    logging.getLogger("veetee.voice").info("ready host=%s port=%s profile=%s revision=%s", config.host, config.port, config.ws_path, runtime.view.snapshot.revision)
    try:
        await asyncio.Event().wait()
    finally:
        await runtime.stop()
        await runner.cleanup()


def main() -> None:
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass

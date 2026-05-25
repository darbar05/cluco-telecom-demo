"""Async HTTP exporter — batches spans and sends to Cluco backend."""

import json
import logging
import queue
import threading
import time
from typing import Optional

logger = logging.getLogger("cluco_obs.exporter")


class AsyncHTTPExporter:
    def __init__(self, backend_url: str, batch_size: int = 10, flush_interval: float = 5.0, max_queue_size: int = 1000):
        self._url = backend_url.rstrip("/") + "/api/v1/traces/ingest"
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._queue: queue.Queue = queue.Queue(maxsize=max_queue_size)
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="cluco-obs-exporter")
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        self._flush()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)

    def enqueue(self, trace_data: dict) -> None:
        if not self._running:
            self.start()
        try:
            self._queue.put_nowait(trace_data)
        except queue.Full:
            logger.warning("Cluco obs export queue full, dropping trace")

    def _run_loop(self) -> None:
        while self._running:
            time.sleep(self._flush_interval)
            self._flush()
        self._flush()

    def _flush(self) -> None:
        batch = []
        while len(batch) < self._batch_size * 5:
            try:
                batch.append(self._queue.get_nowait())
            except queue.Empty:
                break
        if not batch:
            return
        for i in range(0, len(batch), self._batch_size):
            chunk = batch[i:i + self._batch_size]
            self._send(chunk)

    def _send(self, traces: list) -> None:
        import urllib.error
        import urllib.request

        def _default_ser(o):
            """Fallback for json.dumps — convert any non-serializable object to string."""
            if hasattr(o, "value"):
                return o.value
            if hasattr(o, "isoformat"):
                return o.isoformat()
            return str(o)

        data = json.dumps({"traces": traces}, default=_default_ser).encode("utf-8")
        delays = (0.0, 1.0, 2.0)
        last_err = None
        for delay in delays:
            if delay:
                time.sleep(delay)
            try:
                req = urllib.request.Request(
                    self._url,
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    if resp.status >= 400:
                        logger.warning("Cluco obs export failed: HTTP %d", resp.status)
                    return
            except Exception as e:
                last_err = e
        logger.warning("Cluco obs export error: %s", last_err)

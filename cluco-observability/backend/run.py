#!/usr/bin/env python3
"""Run Cluco Observability backend."""
import copy
import uvicorn
from app.main import app, LOG_DIR

if __name__ == "__main__":
    log_config = copy.deepcopy(uvicorn.config.LOGGING_CONFIG)
    log_config["handlers"]["file"] = {
        "class": "logging.handlers.RotatingFileHandler",
        "filename": str(LOG_DIR / "cluco_backend.log"),
        "maxBytes": 5 * 1024 * 1024,
        "backupCount": 5,
        "formatter": "default",
        "encoding": "utf-8",
    }
    for handler_list in log_config["loggers"].values():
        if "handlers" in handler_list:
            handler_list["handlers"].append("file")
    import os
    port = int(os.environ.get("PORT", 9410))
    uvicorn.run(app, host="0.0.0.0", port=port, log_config=log_config)

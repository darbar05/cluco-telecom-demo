"""Email alert system — SMTP sending, rule evaluation, and notification dispatch."""

import logging
import os
import smtplib
import threading
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger("cluco.email_alerts")


# ── SMTP Configuration ─────────────────────────────────────────────────

def _get_smtp_config() -> dict:
    """Read SMTP config from env vars (fallback defaults for dev)."""
    return {
        "host": os.getenv("SMTP_HOST", ""),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "username": os.getenv("SMTP_USERNAME", ""),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from_email": os.getenv("SMTP_FROM_EMAIL", "alerts@cluco-observability.local"),
        "from_name": os.getenv("SMTP_FROM_NAME", "Cluco Observability"),
        "use_tls": os.getenv("SMTP_USE_TLS", "true").lower() in ("true", "1"),
        "enabled": os.getenv("SMTP_ENABLED", "false").lower() in ("true", "1"),
    }


def _get_smtp_config_from_db() -> Optional[dict]:
    """Read SMTP config from MongoDB (user-configured via UI)."""
    try:
        from app.storage.mongodb import _get_db
        db = _get_db()
        doc = db["email_config"].find_one({"config_type": "smtp"})
        if doc:
            return {
                "host": doc.get("host", ""),
                "port": doc.get("port", 587),
                "username": doc.get("username", ""),
                "password": doc.get("password", ""),
                "from_email": doc.get("from_email", "alerts@cluco-observability.local"),
                "from_name": doc.get("from_name", "Cluco Observability"),
                "use_tls": doc.get("use_tls", True),
                "enabled": doc.get("enabled", False),
            }
    except Exception as e:
        logger.debug("Could not read SMTP config from DB: %s", e)
    return None


def get_effective_smtp_config() -> dict:
    """DB config takes priority over env vars."""
    db_config = _get_smtp_config_from_db()
    if db_config and db_config.get("host"):
        return db_config
    return _get_smtp_config()


def save_smtp_config(config: dict) -> dict:
    """Persist SMTP config to MongoDB."""
    try:
        from app.storage.mongodb import _get_db
        db = _get_db()
        now = datetime.utcnow()
        db["email_config"].update_one(
            {"config_type": "smtp"},
            {"$set": {
                "config_type": "smtp",
                "host": config.get("host", ""),
                "port": config.get("port", 587),
                "username": config.get("username", ""),
                "password": config.get("password", ""),
                "from_email": config.get("from_email", "alerts@cluco-observability.local"),
                "from_name": config.get("from_name", "Cluco Observability"),
                "use_tls": config.get("use_tls", True),
                "enabled": config.get("enabled", False),
                "updated_at": now,
            }},
            upsert=True,
        )
        return {"ok": True}
    except Exception as e:
        logger.warning("Failed to save SMTP config: %s", e)
        return {"ok": False, "error": str(e)}


# ── Email Sending ──────────────────────────────────────────────────────

def send_email(to_emails: list, subject: str, html_body: str,
               text_body: str = "") -> dict:
    """Send an email via SMTP. Runs synchronously — call in a thread for async."""
    config = get_effective_smtp_config()
    if not config.get("enabled"):
        return {"ok": False, "error": "SMTP not enabled"}
    if not config.get("host"):
        return {"ok": False, "error": "SMTP host not configured"}
    if not to_emails:
        return {"ok": False, "error": "No recipients"}

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{config['from_name']} <{config['from_email']}>"
        msg["To"] = ", ".join(to_emails)

        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        if config.get("use_tls"):
            server = smtplib.SMTP(config["host"], config["port"], timeout=15)
            server.ehlo()
            server.starttls()
        else:
            server = smtplib.SMTP(config["host"], config["port"], timeout=15)
            server.ehlo()

        if config.get("username") and config.get("password"):
            server.login(config["username"], config["password"])

        server.sendmail(config["from_email"], to_emails, msg.as_string())
        server.quit()
        logger.info("[email] Sent to %s: %s", to_emails, subject)
        return {"ok": True, "recipients": len(to_emails)}
    except Exception as e:
        logger.warning("[email] Send failed: %s", e)
        return {"ok": False, "error": str(e)}


def send_email_async(to_emails: list, subject: str, html_body: str,
                     text_body: str = ""):
    """Fire-and-forget email in a background thread."""
    t = threading.Thread(
        target=send_email,
        args=(to_emails, subject, html_body, text_body),
        daemon=True,
        name="email-alert",
    )
    t.start()


# ── Email Templates ────────────────────────────────────────────────────

def _build_alert_email(alert_data: dict, rule: dict) -> tuple:
    """Build subject + HTML body for an alert email."""
    rule_name = rule.get("name", "Alert Rule")
    alert_type = alert_data.get("alert_type", "alert")
    severity = alert_data.get("severity", "warning")
    message = alert_data.get("message", "An alert was triggered.")
    trace_id = alert_data.get("trace_id", "")
    details = alert_data.get("details", {})

    subject = f"[Cluco {severity.upper()}] {rule_name}"

    detail_rows = ""
    for k, v in details.items():
        detail_rows += f"<tr><td style='padding:4px 12px;color:#64748b;font-size:13px'>{k}</td><td style='padding:4px 12px;font-weight:600;font-size:13px'>{v}</td></tr>"

    html = f"""
    <div style="font-family:'Inter',system-ui,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:{'#dc2626' if severity == 'critical' else '#f59e0b'};padding:16px 24px">
        <h2 style="margin:0;color:#fff;font-size:16px">{rule_name}</h2>
        <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:4px">{alert_type} &middot; {severity}</div>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.6">{message}</p>
        {f'<div style="margin-bottom:16px"><span style="font-size:12px;color:#64748b">Trace ID:</span> <code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px">{trace_id}</code></div>' if trace_id else ''}
        {f'<table style="width:100%;border-collapse:collapse;margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px">{detail_rows}</table>' if detail_rows else ''}
        <div style="font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:12px">
          Sent by Cluco Observability &middot; {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
        </div>
      </div>
    </div>
    """
    text = f"[{severity.upper()}] {rule_name}\n\n{message}\nTrace: {trace_id}\n"
    return subject, html, text


def _build_test_email() -> tuple:
    """Build a test email to verify SMTP config."""
    subject = "[Cluco] Test Email - SMTP Configuration"
    html = """
    <div style="font-family:'Inter',system-ui,sans-serif;max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#4c6ef5;padding:16px 24px">
        <h2 style="margin:0;color:#fff;font-size:16px">SMTP Test Successful</h2>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 12px;font-size:14px;color:#334155">Your email configuration is working correctly.</p>
        <p style="margin:0;font-size:12px;color:#94a3b8">Cluco Observability will use this SMTP configuration to send alert notifications.</p>
      </div>
    </div>
    """
    return subject, html, "SMTP Test: Your email configuration is working correctly."


# ── Alert Rules Engine ─────────────────────────────────────────────────

def evaluate_rules_for_trace(trace_data: dict) -> list:
    """Evaluate all active alert rules against a finalized trace.
    Returns list of triggered rule dicts."""
    try:
        from app.storage.mongodb import _get_db
        db = _get_db()
        rules = list(db["alert_rules"].find({"enabled": True}))
    except Exception:
        return []

    triggered = []
    for rule in rules:
        if _rule_matches(rule, trace_data):
            triggered.append(rule)
    return triggered


def _rule_matches(rule: dict, trace_data: dict) -> bool:
    """Check if a single rule is triggered by the trace data."""
    condition = rule.get("condition", {})
    metric = condition.get("metric", "")
    operator = condition.get("operator", "gt")
    threshold = condition.get("threshold", 0)

    if metric == "evaluator_result":
        return _check_evaluator_result(condition, trace_data)

    value = _extract_metric(metric, trace_data)
    if value is None:
        return False

    try:
        threshold = float(threshold)
        value = float(value)
    except (ValueError, TypeError):
        return False

    if operator == "gt":
        return value > threshold
    elif operator == "gte":
        return value >= threshold
    elif operator == "lt":
        return value < threshold
    elif operator == "lte":
        return value <= threshold
    elif operator == "eq":
        return value == threshold
    elif operator == "neq":
        return value != threshold
    return False


def _check_evaluator_result(condition: dict, trace_data: dict) -> bool:
    """Check if a trace has a specific evaluator/assessment result."""
    evaluator_name = condition.get("evaluator_name", "")
    expected_value = condition.get("expected_value", "False")
    if not evaluator_name:
        return False
    try:
        from app.storage.mongodb import _get_db
        db = _get_db()
        trace_id = trace_data.get("trace_id", "")
        fb = db["feedback"].find_one({"trace_id": trace_id, "key": evaluator_name})
        if fb:
            return str(fb.get("value", "")) == str(expected_value)
    except Exception:
        pass
    return False


def _extract_metric(metric: str, trace_data: dict):
    """Extract a metric value from trace data for rule evaluation."""
    metric_map = {
        "total_cost_usd": lambda t: t.get("total_cost_usd", 0) or 0,
        "total_tokens": lambda t: t.get("total_tokens", 0) or 0,
        "latency_ms": lambda t: t.get("latency_ms", 0) or 0,
        "error_rate": lambda t: 100.0 if t.get("status") == "error" else 0.0,
        "status_error": lambda t: 1 if t.get("status") == "error" else 0,
        "span_count": lambda t: t.get("span_count", 0) or 0,
    }
    extractor = metric_map.get(metric)
    if extractor:
        return extractor(trace_data)
    # Allow dotted access for nested fields
    parts = metric.split(".")
    val = trace_data
    for p in parts:
        if isinstance(val, dict):
            val = val.get(p)
        else:
            return None
    return val


def dispatch_alert_emails(trace_data: dict, triggered_rules: list):
    """For each triggered rule, send emails to configured recipients."""
    if not triggered_rules:
        return

    try:
        from app.storage.mongodb import _get_db
        db = _get_db()
    except Exception:
        return

    for rule in triggered_rules:
        recipient_ids = rule.get("recipient_ids", [])
        if not recipient_ids:
            # Fall back to all active recipients
            recipients = list(db["email_recipients"].find({"active": True}))
        else:
            from bson import ObjectId
            recipients = list(db["email_recipients"].find({
                "_id": {"$in": [ObjectId(rid) for rid in recipient_ids if rid]},
                "active": True,
            }))

        if not recipients:
            continue

        to_emails = [r["email"] for r in recipients if r.get("email")]
        if not to_emails:
            continue

        # Build alert data
        alert_data = {
            "alert_type": rule.get("alert_type", "rule_triggered"),
            "severity": rule.get("severity", "warning"),
            "trace_id": trace_data.get("trace_id", ""),
            "message": _build_rule_message(rule, trace_data),
            "details": {
                "Rule": rule.get("name", ""),
                "Metric": rule.get("condition", {}).get("metric", ""),
                "Threshold": str(rule.get("condition", {}).get("threshold", "")),
                "Actual Value": str(_extract_metric(
                    rule.get("condition", {}).get("metric", ""),
                    trace_data
                )),
                "Product": trace_data.get("product_id", ""),
            },
        }

        subject, html, text = _build_alert_email(alert_data, rule)
        send_email_async(to_emails, subject, html, text)

        # Also store the alert in the alerts collection
        try:
            from app.storage import get_trace_store
            store = get_trace_store()
            store.store_alert({
                "trace_id": trace_data.get("trace_id", ""),
                "product_id": trace_data.get("product_id", "default"),
                "alert_type": rule.get("alert_type", "rule_triggered"),
                "severity": rule.get("severity", "warning"),
                "message": alert_data["message"],
                "details": {
                    "rule_name": rule.get("name", ""),
                    "email_sent_to": to_emails,
                    **alert_data["details"],
                },
            })
        except Exception as e:
            logger.debug("Could not store alert record: %s", e)


def _build_rule_message(rule: dict, trace_data: dict) -> str:
    """Build a human-readable message for a triggered rule."""
    name = rule.get("name", "Alert Rule")
    cond = rule.get("condition", {})
    metric = cond.get("metric", "metric")
    operator = cond.get("operator", "gt")
    threshold = cond.get("threshold", 0)
    actual = _extract_metric(metric, trace_data)
    op_labels = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "eq": "=", "neq": "!="}
    op_str = op_labels.get(operator, operator)
    return f"{name}: {metric} = {actual} ({op_str} {threshold} threshold)"


# ── Agent Report Email ─────────────────────────────────────────────────

def build_agent_report_email(agent_name: str, metrics: dict, period_days: int = 7) -> tuple:
    """Build an HTML email report for an agent. Returns (subject, html, text)."""
    subject = f"Agent Report: {agent_name} ({period_days}d)"

    traces = metrics.get("traces", 0)
    errors = metrics.get("errors", 0)
    cost = metrics.get("total_cost_usd", 0)
    tokens = metrics.get("total_tokens", 0)
    sessions = metrics.get("sessions", 0)
    success_rate = ((traces - errors) / traces * 100) if traces > 0 else 100

    html = f"""
    <html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #334155;">
    <div style="background: linear-gradient(135deg, #4c6ef5, #7c3aed); padding: 24px 30px; border-radius: 12px 12px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 20px;">Agent Report: {agent_name}</h1>
      <p style="color: rgba(255,255,255,0.8); margin: 6px 0 0; font-size: 13px;">Last {period_days} days</p>
    </div>
    <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; padding: 24px 30px;">
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 12px; text-align: center; background: #f8fafc; border-radius: 8px; width: 33%;">
            <div style="font-size: 24px; font-weight: 700; color: #1e293b;">{traces}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Traces</div>
          </td>
          <td style="width: 8px;"></td>
          <td style="padding: 12px; text-align: center; background: #f8fafc; border-radius: 8px; width: 33%;">
            <div style="font-size: 24px; font-weight: 700; color: {'#16a34a' if success_rate >= 90 else '#dc2626'};">{success_rate:.1f}%</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Success Rate</div>
          </td>
          <td style="width: 8px;"></td>
          <td style="padding: 12px; text-align: center; background: #f8fafc; border-radius: 8px; width: 33%;">
            <div style="font-size: 24px; font-weight: 700; color: #059669;">${cost:.4f}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Total Cost</div>
          </td>
        </tr>
      </table>
      <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px 0; color: #64748b;">Sessions</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">{sessions}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px 0; color: #64748b;">Total Tokens</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">{tokens:,}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 8px 0; color: #64748b;">Errors</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: {'#dc2626' if errors > 0 else '#64748b'};">{errors}</td>
        </tr>
      </table>
      <p style="font-size: 11px; color: #94a3b8; margin-top: 20px; text-align: center;">
        Generated by Cluco Observability &middot; {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
      </p>
    </div>
    </body></html>
    """

    text = (
        f"Agent Report: {agent_name} (Last {period_days}d)\n"
        f"Traces: {traces} | Success: {success_rate:.1f}% | Cost: ${cost:.4f}\n"
        f"Sessions: {sessions} | Tokens: {tokens:,} | Errors: {errors}"
    )

    return subject, html, text

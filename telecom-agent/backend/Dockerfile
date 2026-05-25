FROM python:3.11-slim

WORKDIR /app

COPY telecom-agent/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY cluco-observability/sdk /sdk/
RUN pip install --no-cache-dir -e /sdk

COPY telecom-agent/backend/ ./

EXPOSE 9412

CMD ["python", "-m", "app.chat_server"]

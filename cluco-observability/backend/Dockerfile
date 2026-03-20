FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY sdk/ /sdk/
RUN pip install --no-cache-dir -e /sdk

COPY backend/ ./

EXPOSE 9410

CMD ["python", "run.py"]

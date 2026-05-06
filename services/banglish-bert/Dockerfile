FROM python:3.11-slim

WORKDIR /app

# Install CPU-only torch first to keep image size manageable
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8001
CMD ["python", "app.py"]

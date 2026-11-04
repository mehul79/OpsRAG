# Backend image for Hugging Face Spaces (Docker SDK) or any container host.
FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# HF Spaces runs the container as uid 1000
RUN useradd -m -u 1000 user
USER user
WORKDIR /home/user/app
ENV UV_COMPILE_BYTECODE=1 PATH="/home/user/app/.venv/bin:$PATH"

COPY --chown=user pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY --chown=user backend ./backend

# Bake the 3 ONNX models into the image (pipeline.py caches them in ./models).
# The dense + BM25 models load on import; the reranker is lazy, so call it too.
RUN python -c "import sys; sys.path.insert(0, 'backend'); import pipeline; pipeline.local_reranker()"

EXPOSE 7860
CMD ["uvicorn", "app:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "7860"]

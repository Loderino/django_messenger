.PHONY: help install sync migrate makemigrations run test lint fmt check docker-up docker-down init-dirs

help:
	@echo "Available commands:"
	@echo "  install        - Install dependencies"
	@echo "  sync           - Sync dependencies with uv"
	@echo "  migrate        - Apply migrations"
	@echo "  makemigrations - Create new migrations"
	@echo "  run            - Run development server"
	@echo "  test           - Run tests"
	@echo "  lint           - Check code with ruff and ty"
	@echo "  fmt            - Format code with ruff"
	@echo "  check          - Run all checks (lint + test)"
	@echo "  docker-up      - Start PostgreSQL in Docker"
	@echo "  docker-down    - Stop PostgreSQL"
	@echo "  init-dirs      - Create required directories (data/, media/)"

install:
	uv sync
	pre-commit install
	@make init-dirs

sync:
	uv sync

init-dirs:
	mkdir -p data/media
	mkdir -p data/db

migrate:
	uv run python manage.py migrate --settings=config.settings.dev

makemigrations:
	uv run python manage.py makemigrations --settings=config.settings.dev

run:
	uv run python manage.py runserver --settings=config.settings.dev

test:
	uv run pytest

lint:
	uv run ruff check .
	uv run ty check

fmt:
	uv run ruff format .

check: lint test

docker-up:
	docker compose up -d

docker-down:
	docker compose down

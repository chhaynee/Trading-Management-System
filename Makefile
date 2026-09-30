# Trading Management System: Docker control panel.
#
#   make              list every target
#   make up           dev stack:  live editing on http://localhost:3001, separate data
#   make up-prod      prod stack: your real data on http://localhost:3000
#
# Targets act on ENV=dev (default) or ENV=prod. Appending -prod or -dev to any
# target is a shortcut: `make logs-prod` is `make logs ENV=prod`.
# Defaults can be changed in .env (see .env.example).

SHELL         := bash
.SHELLFLAGS   := -eu -o pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS     += --no-print-directory
.NOTPARALLEL:

-include .env

# POSIX shells use $ENV to name an rc file, so ignore a value that only comes
# from the environment; set it on the command line or in .env instead.
ifeq ($(origin ENV),environment)
ENV := dev
endif
ENV          ?= dev
TMS_PORT     ?= 3000
TMS_DEV_PORT ?= 3001
BACKUP_DIR   ?= backups
SRC          ?= .
TAIL         ?= 100

ifeq ($(filter $(ENV),dev prod),)
$(error ENV must be dev or prod, got '$(ENV)')
endif

COMPOSE_dev  := docker compose -f compose.dev.yaml
COMPOSE_prod := docker compose -f compose.yaml
COMPOSE      := $(COMPOSE_$(ENV))
URL_dev      := http://localhost:$(TMS_DEV_PORT)
URL_prod     := http://localhost:$(TMS_PORT)
URL          := $(URL_$(ENV))
SERVICE      := app

ifeq ($(NO_COLOR),)
BOLD  := \033[1m
DIM   := \033[2m
CYAN  := \033[36m
GREEN := \033[32m
RESET := \033[0m
endif

# Ask before anything destructive; YES=1 skips the prompt (for scripts).
# The message can't contain commas: they separate $(call) arguments.
confirm = [ "$(YES)" = 1 ] || { printf '%s [y/N] ' "$(1)"; read -r reply || true; \
  case "$$reply" in [yY]*) ;; *) echo "Aborted."; exit 1 ;; esac; }

.PHONY: help doctor up up-prod down restart ps logs open \
        build build-prod rebuild test shell config \
        backup restore import-legacy update clean destroy mountpoint

##@ General

help: ## Show this help
	@printf '$(BOLD)Trading Management System$(RESET): Docker control\n\n'
	@printf 'Usage:  make $(CYAN)<target>$(RESET) [ENV=dev|prod] [VAR=value ...]\n'
	@printf 'Active: ENV=$(BOLD)$(ENV)$(RESET) → $(URL)\n'
	@awk 'BEGIN { FS = ":.*## " } \
	  /^##@/ { printf "\n$(BOLD)%s$(RESET)\n", substr($$0, 5) } \
	  /^[a-zA-Z0-9_-]+:.*## / { printf "  $(CYAN)%-14s$(RESET) %s\n", $$1, $$2 }' \
	  $(firstword $(MAKEFILE_LIST))
	@printf '\n$(DIM)Append -prod or -dev to any target: make logs-prod, make backup-prod, ...$(RESET)\n'

doctor: ## Check that Docker and Docker Compose are installed and running
	@command -v docker >/dev/null \
	  || { echo "✗ docker not found: install Docker Desktop (Windows/macOS) or Docker Engine (Linux)"; exit 1; }
	@echo "✓ $$(docker --version)"
	@docker compose version >/dev/null 2>&1 \
	  || { echo "✗ the Docker Compose v2 plugin (docker compose) is missing"; exit 1; }
	@echo "✓ $$(docker compose version)"
	@docker info >/dev/null 2>&1 || { \
	  echo "✗ can't reach the Docker daemon. Start Docker Desktop, or on Linux:"; \
	  echo "    sudo systemctl enable --now docker"; \
	  echo "    sudo usermod -aG docker $$USER    # then log out and back in"; \
	  exit 1; }
	@echo "✓ Docker daemon is reachable"

##@ Stack

up: mountpoint build ## Start in the background and wait until healthy (builds first)
	$(COMPOSE) up -d --wait --wait-timeout 60
	@printf '$(GREEN)✓ TMS ($(ENV)) is up → $(URL)$(RESET)\n'

up-prod: ## Start the production stack
	@$(MAKE) up ENV=prod

down: ## Stop and remove the containers (your data is kept)
	$(COMPOSE) down --remove-orphans

restart: ## Restart the app container
	$(COMPOSE) restart $(SERVICE)

ps: ## Show container status and health
	$(COMPOSE) ps --all

logs: ## Follow the logs (TAIL=100 lines of history)
	$(COMPOSE) logs --follow --tail=$(TAIL) $(SERVICE)

open: ## Open the app in your browser
	@case "$$(uname -s)" in \
	  Darwin) open "$(URL)" ;; \
	  MINGW*|MSYS*|CYGWIN*) start "$(URL)" ;; \
	  *) if command -v wslview >/dev/null; then wslview "$(URL)"; \
	     elif command -v xdg-open >/dev/null; then xdg-open "$(URL)" >/dev/null 2>&1 & \
	     else echo "Open $(URL) in your browser"; fi ;; \
	esac

##@ Build & develop

build: ## Build the image for ENV (default: dev)
	$(COMPOSE) build

build-prod: ## Build the production image
	@$(MAKE) build ENV=prod

rebuild: ## Rebuild from scratch: fresh base image, no layer cache
	$(COMPOSE) build --pull --no-cache

test: ## Run the test suite in a throwaway dev container
	@mkdir -p server/node_modules
	$(COMPOSE_dev) run --rm --build $(SERVICE) npm test

shell: ## Open a shell inside the running container
	$(COMPOSE) exec $(SERVICE) bash

config: ## Validate the compose file and print the resolved config
	$(COMPOSE) config

##@ Data

backup: mountpoint ## Snapshot database + screenshots into ./backups (safe while running)
	@mkdir -p "$(BACKUP_DIR)"
	@stem="$(BACKUP_DIR)/tms-$(ENV)-$$(date +%Y%m%d-%H%M%S)"; out="$$stem.tar.gz"; n=1; \
	while [ -e "$$out" ]; do out="$$stem-$$n.tar.gz"; n=$$((n + 1)); done; \
	$(COMPOSE) run --rm -T $(SERVICE) tms-backup > "$$out" || { rm -f "$$out"; exit 1; }; \
	if [ -s "$$out" ]; then echo "✓ Backup written to $$out ($$(du -h "$$out" | cut -f1))"; else rm -f "$$out"; fi

restore: mountpoint ## Replace ENV data with a backup: make restore FILE=backups/<name>.tar.gz
	@[ -n "$(FILE)" ] || { echo "Usage: make restore FILE=backups/<name>.tar.gz [ENV=prod]"; exit 1; }
	@[ -f "$(FILE)" ] || { echo "No such file: $(FILE)"; exit 1; }
	@$(call confirm,Replace ALL $(ENV) data with $(FILE)? The current data is backed up first.)
	@$(MAKE) backup
	$(COMPOSE) stop $(SERVICE)
	$(COMPOSE) run --rm -T $(SERVICE) tms-restore < "$(FILE)"
	@$(MAKE) up

import-legacy: mountpoint ## Import tms.db + uploads/ from a pre-Docker install (SRC=its folder)
	@[ -f "$(SRC)/tms.db" ] || { echo "No tms.db in '$(SRC)'. Usage: make import-legacy SRC=/path/to/old/Trading-Management-System"; exit 1; }
	@echo "Stop the old server first (Ctrl+C in its terminal, or: pm2 stop tms) so tms.db isn't changing."
	@$(call confirm,Replace ALL $(ENV) data with $(SRC)/tms.db + uploads/? The current data is backed up first and the originals are left untouched.)
	@$(MAKE) backup
	$(COMPOSE) stop $(SERVICE)
	tar -C "$(SRC)" -czf - tms.db $$(cd "$(SRC)" && ls -d tms.db-wal uploads 2>/dev/null) \
	  | $(COMPOSE) run --rm -T $(SERVICE) tms-restore
	@$(MAKE) up

##@ Maintenance

update: ## Back up, git pull, then rebuild and restart production
	@$(MAKE) backup ENV=prod
	git pull --ff-only
	@$(MAKE) up ENV=prod

clean: ## Remove the ENV containers and image (your data is kept)
	$(COMPOSE) down --rmi all --remove-orphans

destroy: ## Delete the ENV containers, image AND data volume (backs up first)
	@$(call confirm,Permanently delete ALL $(ENV) data? A backup is taken first.)
	@$(MAKE) backup
	$(COMPOSE) down --rmi all --volumes --remove-orphans

# compose.dev.yaml mounts a tmpfs at server/node_modules. Create the mount point
# as you first; otherwise Docker creates it on the host owned by root.
mountpoint:
	@$(if $(filter dev,$(ENV)),mkdir -p server/node_modules,:)

# `make <target>-prod` / `make <target>-dev` run <target> against that stack.
%-prod:
	@$(MAKE) $* ENV=prod
%-dev:
	@$(MAKE) $* ENV=dev

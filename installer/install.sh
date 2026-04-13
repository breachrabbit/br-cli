#!/usr/bin/env bash

set -euo pipefail

REPO_SOURCE_URL="${BR_REPO_SOURCE_URL:-https://codeload.github.com/breachrabbit/br-cli/tar.gz/refs/heads/main}"
WORKDIR=""
INSTALL_LOG=""
TOTAL_STEPS=5
CURRENT_STEP=0

refresh_homebrew_path() {
  if [[ -x "/opt/homebrew/bin/brew" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x "/usr/local/bin/brew" ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

cleanup() {
  if [[ -n "${WORKDIR}" && -d "${WORKDIR}" ]]; then
    rm -rf "${WORKDIR}"
  fi
}

trap cleanup EXIT

on_error() {
  printf '\n' >&2
  fail "Installation failed"
  if [[ -n "${INSTALL_LOG}" && -f "${INSTALL_LOG}" ]]; then
    printf 'Reason: see installer log at %s\n' "${INSTALL_LOG}" >&2
    tail -n 20 "${INSTALL_LOG}" >&2 || true
  fi
}

trap on_error ERR

clear_screen() {
  if [[ -t 1 ]]; then
    printf '\033c'
  fi
}

print_logo() {
  cat <<'EOF'
 ____    ____      _          _               
| __ )  |  _ \    | |    __ _| |__   ___      
|  _ \  | |_) |   | |   / _` | '_ \ / __|     
| |_) | |  _ <    | |__| (_| | |_) |\__ \     
|____/  |_| \_\   |_____\__,_|_.__/ |___/.    

https://github.com/breachrabbit/br-cli
Backup & recovery CLI for Breach Rabbit environments

Installer
EOF
  printf '\n'
}

bar() {
  local percent="$1"
  local width=28
  local filled=$(( percent * width / 100 ))
  local empty=$(( width - filled ))
  printf '['
  printf '%0.s#' $(seq 1 "${filled}")
  printf '%0.s-' $(seq 1 "${empty}")
  printf '] %s%%\n' "${percent}"
}

step() {
  local message="$1"
  CURRENT_STEP=$((CURRENT_STEP + 1))
  local percent=$(( CURRENT_STEP * 100 / TOTAL_STEPS ))
  printf '\n'
  bar "${percent}"
  printf '⏳ %s\n' "${message}"
}

ok() {
  printf '✔ %s\n' "$1"
}

warn() {
  printf '⚠ %s\n' "$1"
}

fail() {
  printf '✖ %s\n' "$1" >&2
}

run_quiet() {
  if "$@" >>"${INSTALL_LOG}" 2>&1; then
    return 0
  fi

  return 1
}

ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    ok "Homebrew installed"
    return
  fi

  printf '⏳ Installing Homebrew...\n'
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" >>"${INSTALL_LOG}" 2>&1
  refresh_homebrew_path
  ok "Homebrew installed"
}

bootstrap_repo() {
  if [[ -f "package.json" && -f "bin/br" ]]; then
    pwd
    return
  fi

  WORKDIR="$(mktemp -d)"
  curl -fsSL "${REPO_SOURCE_URL}" -o "${WORKDIR}/br.tar.gz"
  tar -xzf "${WORKDIR}/br.tar.gz" -C "${WORKDIR}"
  mv "${WORKDIR}"/br-cli-* "${WORKDIR}/br-cli"
  echo "${WORKDIR}/br-cli"
}

install_with_brew_if_missing() {
  local binary="$1"
  local formula="$2"
  local label="$3"

  if command -v "${binary}" >/dev/null 2>&1; then
    ok "${label} installed"
    return
  fi

  ensure_homebrew
  refresh_homebrew_path
  printf '⏳ Installing %s...\n' "${label}"
  run_quiet brew install "${formula}"
  refresh_homebrew_path
  if [[ -z "$(detect_binary_path "${binary}")" ]]; then
    fail "${label} was installed but ${binary} could not be resolved."
    exit 1
  fi
  ok "${label} installed"
}

detect_binary_path() {
  local binary="$1"
  which "${binary}" 2>/dev/null || true
}

resolve_br_command() {
  if command -v br >/dev/null 2>&1; then
    command -v br
    return
  fi

  local npm_prefix
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [[ -n "${npm_prefix}" && -x "${npm_prefix}/bin/br" ]]; then
    echo "${npm_prefix}/bin/br"
    return
  fi

  echo "node ./bin/br"
}

run_setup_wizard() {
  local br_cmd
  br_cmd="$(resolve_br_command)"

  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    fail "Setup requires an interactive terminal on /dev/tty."
    exit 1
  fi

  if [[ "${br_cmd}" == "node ./bin/br" ]]; then
    node ./bin/br setup </dev/tty >/dev/tty
    return
  fi

  "${br_cmd}" setup </dev/tty >/dev/tty
}

install_menu_bar_agent() {
  local br_cmd
  br_cmd="$(resolve_br_command)"

  if [[ "${br_cmd}" == "node ./bin/br" ]]; then
    node ./bin/br agent install </dev/tty >/dev/tty
    return
  fi

  "${br_cmd}" agent install </dev/tty >/dev/tty
}

print_path_hint_if_needed() {
  if command -v br >/dev/null 2>&1; then
    return
  fi

  local npm_prefix
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [[ -n "${npm_prefix}" ]]; then
    warn "br was installed, but ${npm_prefix}/bin is not on PATH in this shell."
    return
  fi

  warn "br was installed, but is not on PATH in this shell."
}

main() {
  clear_screen
  print_logo

  if [[ "$(uname -s)" != "Darwin" ]]; then
    fail "installer/install.sh currently supports macOS only."
    exit 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required for installation."
    exit 1
  fi

  INSTALL_LOG="$(mktemp -t br-installer-log.XXXXXX)"

  local src_dir
  src_dir="$(bootstrap_repo)"

  step "Checking environment"
  install_with_brew_if_missing git git "Git"
  install_with_brew_if_missing node node "Node"
  install_with_brew_if_missing rclone rclone "rclone"
  local rclone_path
  rclone_path="$(detect_binary_path rclone)"
  if [[ -z "${rclone_path}" ]]; then
    fail "rclone was installed but could not be resolved on PATH."
    exit 1
  fi
  ok "rclone path: ${rclone_path}"

  step "Installing CLI"
  cd "${src_dir}"
  run_quiet npm install --silent --no-fund --no-audit
  run_quiet npm install -g . --silent --no-fund --no-audit
  hash -r
  ok "CLI installed"

  step "Running setup"
  run_setup_wizard
  ok "Setup complete"

  step "Installing menu bar agent"
  if install_menu_bar_agent; then
    ok "Menu bar agent installed"
  else
    warn "Menu bar agent could not be enabled automatically. Run br agent install later."
  fi

  step "Finalizing"
  print_path_hint_if_needed
  ok "Installation complete"
  printf '\n'
  printf 'Run %s to open the CLI.\n' "br"
}

main "$@"

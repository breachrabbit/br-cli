# BR Labs CLI

<img width="1076" height="700" alt="br-cli" src="https://github.com/user-attachments/assets/475aeb6c-e37f-49e3-a514-f4187bdbe522" />

Reliable backup & recovery system for Breach Rabbit development environments.

---

## ✦ Overview

BR Labs CLI (`br`) is a production-ready backup system designed for real-world development workflows.

It provides:

* consistent repository backups
* S3-compatible storage integration
* automated scheduling via launchd
* clean terminal UX
* full recovery capabilities

The system is built to be:

* predictable
* calm under failure
* safe by default
* easy to operate

---

## ✦ Components

BR Labs is not just a CLI.

It consists of two layers:

### CLI (`br`)

Core engine responsible for:

* backup execution
* storage interaction
* scheduling
* restore operations

### Agent (`br-agent`)

macOS menu bar application providing:

* real-time status
* quick access to actions
* background monitoring
* notifications

---

## ✦ Features

### Backup

* ✔ Full repository backups
* ✔ Lightweight quick backups
* ✔ Per-repository status tracking
* ✔ Backup manifests

---

### Storage

* ✔ S3-compatible storage via rclone
* ✔ Verified uploads
* ✔ Structured backup layout

---

### Scheduling

* ✔ launchd-based automation
* ✔ full backup (daily)
* ✔ quick backup (interval-based)
* ✔ schedule inspection

---

### Environment

* ✔ `.env` backup
* ✔ optional encryption
* ✔ separate storage

---

### UX

* ✔ clean terminal interface
* ✔ real progress indicators
* ✔ human-readable output
* ✔ structured summaries

---

### History

* ✔ backup logs
* ✔ size + duration tracking
* ✔ status overview

---

## ✦ Menu Bar Agent

The BR Agent is a macOS menu bar application that turns the CLI into a persistent, always-available system.

It provides quick access, real-time status, and background monitoring without requiring terminal interaction.

---

### Overview

The agent lives in the macOS status bar and gives instant visibility into the backup system.

It is designed to be:

* minimal
* informative
* non-intrusive

---

### Capabilities

* Run full and quick backups directly from the menu bar
* Display current system state at a glance
* Show last backup result
* Monitor storage connectivity (rclone / S3)
* Monitor launchd schedules
* Provide quick access to CLI, logs, and settings

---

### Menu Structure

```text
BR Labs

Run full backup
Run quick backup

Last backup: <status>
Storage: <status>
Schedule: full / quick
Agent: <status>

Open CLI
Setup
Settings
Schedule

View history
View logs

Refresh
Quit
```

---

### Status Indicators

The agent continuously reflects system state:

* **Last backup**

  * ✔ success
  * ⚠ warning
  * ✖ failed
  * or `never`

* **Storage**

  * ✔ connected
  * ⚠ not configured / unavailable

* **Schedule**

  * full: enabled / disabled
  * quick: enabled / disabled

* **Agent**

  * loaded / not loaded

---

### Real-time Backup Execution

When triggered from the agent:

* backup runs via CLI (`br run` / `br quick`)
* output is piped internally
* progress is displayed in the menu

```text
Backup running...
Progress: 42%
```

Progress updates are enabled via:

```bash
BR_AGENT_PROGRESS=1
```

Terminal output remains unchanged.

---

### Notifications

* Native macOS notifications
* Uses application icon
* Shows success / warning / failure

CLI notifications are suppressed to prevent duplication:

```bash
BR_SUPPRESS_CLI_NOTIFICATIONS=1
```

---

### Monitoring

The agent continuously checks:

* rclone availability
* S3 connectivity
* launchd job state
* last backup execution

This allows instant detection of misconfiguration or failures.

---

### Architecture

The agent does not perform backup logic itself.

It acts as a thin UI layer over the CLI:

```text
br-agent → br CLI → backup system
```

---

### Scheduling Model

* launchd executes scheduled backups
* agent monitors and displays state

This separation ensures:

* reliability (system scheduler)
* visibility (agent UI)

---

### Behavior Notes

* The agent reflects real system state — it does not simulate it
* Backup execution is always delegated to the CLI
* All configuration remains centralized in CLI config

---

### Example States

```text
Last backup: never
Storage: ⚠ not configured
Schedule: full: disabled
Agent: not loaded
```

or

```text
Last backup: ✔ 2 minutes ago
Storage: ✔ connected
Schedule: full: enabled
Agent: loaded
```

---

### Summary

The agent transforms BR Labs from a CLI tool into a persistent system:

* always visible
* always accessible
* always aware of system state


---

### Capabilities

* Runs backups directly from the menu bar
* Displays real-time backup progress
* Shows last backup status
* Monitors storage connectivity (S3 / rclone)
* Monitors launchd schedule state
* Provides quick access to CLI and logs

---

### Real-time status

When a backup is running:

```text
Backup running...
Progress: 45%
```

The agent receives real progress updates via:

```text
BR_AGENT_PROGRESS=1
```

CLI output remains unchanged in terminal mode.

---

### Monitoring

The agent continuously checks:

* Storage status

  * ✔ connected
  * ⚠ warning

* Schedule status

  * full backup loaded / not loaded
  * quick backup loaded / not loaded

* Agent status

  * running / not running

* Last backup result

---

### Notifications

* Native macOS notifications
* Custom application icon
* CLI notifications suppressed to avoid duplication

```text
BR_SUPPRESS_CLI_NOTIFICATIONS=1
```

---

### Menu

```text
BR Labs

Run full backup
Run quick backup

Open CLI
Setup
Settings
Schedule

View history
View logs

Refresh
Quit
```

---

### Architecture

The agent does NOT execute backup logic directly.

It acts as a UI layer:

```text
br-agent → br CLI → backup system
```

---

### Scheduling model

* launchd executes scheduled backups
* agent monitors and displays status

This ensures:

* reliability (launchd)
* visibility (agent)

---

## ✦ Installation

```bash
curl -fsSL https://raw.githubusercontent.com/breachrabbit/br-cli/main/installer/install.sh | bash
```

---

## ✦ Usage

Interactive menu:

```bash
br
```

Run full backup:

```bash
br run
```

Run quick backup:

```bash
br quick
```

---

## ✦ Commands

| Command       | Description                 |
| ------------- | --------------------------- |
| `br`          | Open interactive menu       |
| `br run`      | Run full backup             |
| `br quick`    | Run lightweight backup      |
| `br setup`    | Configure storage and repos |
| `br history`  | View backup history         |
| `br schedule` | Manage automation           |

---

## ✦ Backup Structure

```text
s3://bucket/

full/
  YYYY-MM-DD/
    <backup-id>/
      repositories/
      manifest.json

env/
  YYYY-MM-DD/
    env-files.tar.gz
```

---

## ✦ Configuration

Stored in:

```text
~/.br-config.json
```

Includes:

* repository paths
* storage configuration
* retention policy
* notifications
* encryption
* schedule

---

## ✦ Storage

Supports any S3-compatible provider:

* AWS S3
* TimeWeb S3
* MinIO
* other S3 APIs

---

## ✦ Philosophy

BR Labs is built on a few principles:

* backups must be reliable
* output must be readable
* failures must be clear
* tools must not be noisy

---

## ✦ Status

```text
v1 — stable
```

Core system complete:

* CLI ✔
* Storage ✔
* Scheduling ✔
* Agent ✔
* UX ✔

---

## ✦ Next

* project-aware backups
* restore UX improvements
* deployment integration
* platform architecture

---

## ✦ Author

Breach Rabbit

---

## ✦ License

MIT

[2026-04-14]
- br-cli эволюционирует в BR Labs.vault
- vault становится execution layer для backup/restore и infra operations
- агенты не реализуют backup логику сами, а вызывают vault
- first target: single-server local mode
- first DB support: PostgreSQL dump/restore
- later target: head + node agents architecture

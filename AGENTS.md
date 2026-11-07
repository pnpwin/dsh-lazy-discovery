# Repository conventions

- Runtime implementation, CLI entry points, build scripts and benchmark helpers belong in `src/`.
- Keep `test/` and `locale/` in place. Root files are limited to documentation, package/lock manifests and DSH discovery/display resources.
- Maintain English `README.md` and Russian `README.ru.md`, including test and context-comparison methodology.
- Do not commit credentials, private catalogs, raw session prompts, local absolute paths or `node_modules/`.
- Use Plugin Manager for profile installation/migration; do not hand-edit DSH profile files.

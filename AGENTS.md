# Repository conventions

- All executable implementation belongs in `src/`: Host/runtime, Client UI, CLI, build scripts, benchmark helpers and compatibility entry points. Do not leave implementation or forwarding JS/TS files at the package root.
- Keep existing directories (`test/`, `locale/`, `docs/` and other resources) in place. This rule is about root files, not moving or renaming resource/test directories.
- Root regular files are limited to documentation (`README`, `LICENSE`, `UPSTREAM`, `AGENTS`), Git/package/lock metadata and the files DSH needs to discover, load or display the plugin (bundle patch and exported icon). Validate the root allowlist, package exports and packed resources before a release.
- Maintain English `README.md` and Russian `README.ru.md`, including test and context-comparison methodology.
- Do not commit credentials, private catalogs, raw session prompts, local absolute paths or `node_modules/`.
- Use Plugin Manager for profile installation/migration; do not hand-edit DSH profile files.

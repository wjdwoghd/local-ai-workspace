# Repository guidance

- Keep desktop code in `apps/desktop` and server code in `apps/server`.
- Put shared modules in `packages` and Oracle SQL in `database/oracle`.
- Keep documentation in `docs` and tests in the appropriate `tests` subdirectory.
- Never commit secrets, credentials, or populated `.env` files.
- This repository starts as a scaffold. Add dependencies, scripts, and tests when implementing features.

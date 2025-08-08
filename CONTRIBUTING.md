## Contributing to Ally

Thanks for your interest in contributing! We welcome issues, feature requests, and pull requests. Please note we have a code of conduct, please follow it in all your interactions with the project.

### Getting Started

1. Fork the repo and create your branch from `main` (or the active development branch).
2. Install dependencies: `npm install`
3. iOS setup: `cd ios && pod install`
4. Create `.env` from `env/.env.example`.

### Development Workflow

- Write clear, focused commits following Conventional Commits.
- Ensure code passes linting and type-checks: `npm run lint`.
- Prefer small, incremental PRs with a clear scope.

### Coding Standards

- TypeScript throughout the codebase.
- Import order and grouping as described in `README.md`.
- Avoid overly complex functions; prefer small, testable modules.

### Testing

- Add/adjust tests where meaningful. Run with `npm test`.

### Pull Requests

When opening a PR, please:

- Describe the problem and the solution.
- Include screenshots or recordings for UI changes.
- Link related issues using keywords (Fixes #123).
- Check the PR template checklist.

### License

By contributing, you agree that your contributions will be licensed under the MIT License included in this repository.

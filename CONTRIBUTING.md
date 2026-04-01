# Contributing to fcc

## Branch naming

All contributions must be made on a dedicated branch — direct pushes to `main` are not allowed.

| Type | Pattern | Example |
|------|---------|---------|
| New feature | `feature-<short-description>` | `feature-openai-streaming` |
| Bug fix | `bugfix-<short-description>` | `bugfix-rate-limit-retry` |

## Workflow

1. Fork the repo (external contributors) or create a branch (collaborators)
2. Branch off `main` using the naming convention above
3. Make your changes
4. Open a pull request targeting `main`
5. Wait for review — only the repo owner can approve and merge

## Pull request guidelines

- Keep PRs focused: one feature or fix per PR
- Write a clear title and description explaining *what* and *why*
- Make sure the project builds before submitting: `npm run build`
- Squash or clean up WIP commits before requesting review

## Building locally

```bash
npm install
npm run build
node dist/index.js
```

## Code style

- TypeScript strict mode
- No external dependencies beyond what's already in `package.json` unless discussed first
- Keep the binary self-contained — avoid dependencies that bloat the output

## Reporting bugs

Open an issue with:
- fcc version (`fcc --version`)
- Provider and model in use
- The prompt or command that triggered the issue
- The full error message

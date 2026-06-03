# Contributing to France Monitor

France Monitor is a Vanilla TypeScript + Vite application. Keep changes small, typed, and aligned with the existing WorldMonitor-inspired patterns.

## Local Checks

Run these before opening a pull request:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Development Notes

- Do not add React, Vue, Svelte, or another UI framework.
- Keep frontend code in Vanilla TypeScript with direct DOM manipulation.
- Use `[lng, lat]` coordinate order everywhere.
- Add new data sources through the existing service + dev proxy + Vercel API pattern.
- Prefer local/private AI processing. Cloud LLM access must go through server-side endpoints.
- Do not add large dependencies without checking bundle impact.

## Pull Requests

Include the problem, the change, and the verification commands you ran. For UI changes, attach screenshots or a short browser verification note.

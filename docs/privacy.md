# Privacy and Safety

France Monitor is designed around public-interest monitoring of public data. It is not intended for personal surveillance or profiling.

## Privacy Principles

- Use public, official, or openly accessible sources.
- Avoid collecting personal data.
- Do not enrich individuals with private or sensitive attributes.
- Keep AI processing local-first where possible.
- Send cloud LLM requests only through server-side endpoints, never by exposing API keys in the browser.

## AI Processing

The intended fallback chain is:

1. Ollama local model
2. server-side Groq proxy when configured
3. browser-side Transformers.js fallback

This keeps local processing as the default preference and avoids exposing cloud credentials client-side.

### News article classification

To rate the severity of press articles, the ingestion server sends each article's **title and a summary excerpt** (200 characters at most) to the configured LLM endpoint, in batches of 10. These are public press contents, which may name people; no user data is ever sent.

- Default provider: **Groq** (United States), free tier.
- Replaceable without code changes through `CLASSIFIER_LLM_URL`, `CLASSIFIER_LLM_MODEL` and `CLASSIFIER_LLM_KEY` (any OpenAI-compatible endpoint) — for instance **Albert**, the French State AI API reserved for public administrations, or an **Ollama** instance run by the operator.
- Known limitation: while Groq is used, these excerpts leave the European Union. A deployment for a public administration must switch to a sovereign provider.

See `docs/classification.md` for the classification rules and their measured behaviour.

## Safety Boundaries

France Monitor is a monitoring and correlation tool. It is not:

- an emergency alerting authority
- a newsroom or press publication
- a law-enforcement or targeting system
- a substitute for official public warnings

Displayed items should be treated as weak signals requiring verification from primary sources.

# VELORA

Documentation-first specification for a globally scalable, adult social platform. This repository intentionally contains no application code, dependencies, framework setup, migrations, APIs, UI, or live provider integrations yet.

Velora is one ecosystem with four separate product surfaces sharing backend/domain contracts:

- Consumer Web and Mobile: one consumer account ecosystem with platform-specific interfaces.
- Creator Studio: creator business, club, content, analytics, and earnings experience.
- Platform Admin: privileged, audited operations console.
- API/backend: future shared domain and provider-adapter layer.

AI is documented as an isolated platform capability, never a business source of truth. Figma will become visual source of truth after approved design work. Country, creator-content, payment/payout, and data-residency capabilities remain gated until documented decisions and legal/compliance review are complete.

Start with [documentation index](docs/DOCS_INDEX.md), which routes product surfaces, domains, flows, AI, Design/Figma, compliance, operations, security, and engineering. Future implementers must also follow [AGENTS.md](AGENTS.md).

## Intended future repository shape

```text
apps/
  web/                 Consumer web
  mobile/              Consumer mobile
  creator-studio/      Creator business client
  admin/               Privileged platform operations client
  api/                 Shared backend/API
packages/
  types/ validation/ api-client/ domain/ config/ observability/
docs/
```

This tree is conceptual only. Application folders are deliberately not created in this phase. See [repository shape](docs/architecture/02-repository-shape.md).

Technical choices are now locked for repository bootstrap in the [technical stack matrix](docs/architecture/09-technical-stack.md) and ADR-0003 through ADR-0014. This remains documentation only: no framework, dependency, schema, provider, or application code has been initialized.

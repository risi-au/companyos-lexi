---
slug: new-project
title: New project framing
kind: framing
applies_to: project
version: "2"
domains: [onboarding]
---

## Framing questions

- project_kind: What kind of project is this (client engagement, internal product, function/team, experiment)?
- size: How large is the expected effort (days / weeks / months / ongoing)?
- workbench: Will code be written here (needs a GitHub workbench)?
- plane: Will work be tracked as tasks (needs Plane)?
- agent_token: Should an agent token be minted at provisioning so AI agents can start immediately?
- external_systems: Which existing tools does this touch (CRM, email, hosting, ads, accounting)? Comma-separated is fine.

## Provision skeleton

```json
{ "modules": ["docs"] }
```

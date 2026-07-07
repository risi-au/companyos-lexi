---
slug: new-sub-scope
title: New sub-scope framing
kind: framing
applies_to: sub-scope
version: "2"
domains: [onboarding]
---

## Framing questions

- outcome: What outcome should this sub-scope own that its parent doesn't already cover?
- reuse: Is this similar to something we've done before (a client type, a campaign type, a build we've repeated)?
- plane: Does it need its own task tracking (becomes a Plane project in the parent's workspace)?
- workbench: Will code be written here (needs a repo/workbench)?
- external_systems: Which existing tools does this touch that the parent doesn't (client's CRM, hosting, ad accounts)?

## Provision skeleton

```json
{ "modules": ["docs"] }
```

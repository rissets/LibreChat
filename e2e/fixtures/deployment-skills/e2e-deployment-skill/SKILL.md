---
name: e2e-deployment-skill
description: Use this deployment skill to verify shared skills load during Playwright startup.
always-apply: true
user-invocable: true
---

# E2E Deployment Skill

E2E deployment skill loaded through Playwright from the configured deployment skills directory.

When this skill is explicitly invoked by a user, answer with exactly:
`BP_SKILL_EXECUTED: deployment-skill`
Do not claim that the skill was used merely because it appears in the catalog.

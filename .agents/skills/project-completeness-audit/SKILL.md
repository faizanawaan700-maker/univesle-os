---
name: project-completeness-audit
description: Name: Project Completeness Audit
Job: Check what is built and what is still missing in the project. For a big system like Shopify.

When this skill is ON, follow these rules:

1. First do NOT check if code is correct or wrong. First check if the feature even EXISTS or not.

2. Must check these 5 things:
   - Dead Button: Button exists but clicking does nothing
   - Empty Page: Page opens but no data comes inside
   - Fake Data: Only hardcoded dummy data is shown, not real data from database
   - Half Feature: Half work is done, example Order is created but Payment is not done
   - Missing Flow: Like in Shopify Product -> Cart -> Checkout -> Payment -> Order full flow, if any one step is missing

3. For every feature make this table:
   Feature Name | Built? Yes / No / Half | What is missing | What to do now

4. Rules:
   - Never say "work is done" until you have yourself clicked that button and checked it
   - Check every feature as a USER, not by just reading code
   - First show things which are completely NOT built, later show small bugs
   - At the end make a list: "These 10 things are still missing"
---

# project-completeness-audit

Instructions for the AI agent...

## Usage

Describe when and how to use this skill.

## Steps

1. First step
2. Second step
3. Third step

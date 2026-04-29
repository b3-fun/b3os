## Summary

<!-- What does this PR do? One or two sentences. -->

## Action Details

<!-- Fill this in if you're adding or modifying an action. Delete if not applicable. -->

- **Action ID:** `my-action-id`
- **Category:** (e.g., utility, blockchain-data, messaging)
- **Operation Type:** read / write

## Checklist

- [ ] Action ID follows kebab-case format (`my-action-name`)
- [ ] `schema.ts` defines both `payloadSchema` and `resultSchema`
- [ ] `execute.ts` extends `BaseAction` and implements `execute()`
- [ ] `index.ts` re-exports the action class
- [ ] Tests added and passing (`npm test`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Code is formatted (`npm run prettier:write`)

## Test Plan

<!-- How did you test this? Include example inputs/outputs if helpful. -->

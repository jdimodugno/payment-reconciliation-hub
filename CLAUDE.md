# CLAUDE.md

Behavioral guidelines for AI coding assistants working on the Payment Reconciliation Hub project.

## Project context

This is a learning project: an open-source payment reconciliation system designed both to demonstrate senior engineering skills and to be defensible in technical interviews. The author is reactivating his hands-on coding muscle after 5 years in management — every line of code must be his to defend.

**This shapes how you assist:** explain decisions before implementing them, surface trade-offs explicitly, and never produce code the author cannot articulate.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

## 5. Project-Specific Principles

This project enforces 10 principles documented in `../study-plan/PROJECT_PRINCIPLES.md` (sibling repository). The most relevant for code generation:

### T1 — Money is never `number`
Any monetary value must be string decimal, bigint cents, or a dedicated Money type. Never `number`, never `parseFloat`. If you see `amount: number` in domain code, refuse and explain.

### T2 — Tests are born with code
Never propose code without tests. The commit introducing logic includes tests.

### T3 — Controllers thin, services pure, repositories isolated
Services must not import HTTP types (`Request`, `Response`, `HttpException`). Controllers must not contain domain logic. Repositories return domain entities, not DB rows.

### T4 — Non-obvious decisions become ADRs
If a decision has legitimate alternatives, suggest writing an ADR before implementing. See `docs/adrs/000-template.md`.

### T5 — Errors are modeled, not ignored
No empty `catch {}`. Distinguish retriable vs non-retriable. In financial operations: never silently swallow errors.

### A2 — Generated code is read line by line
After generating non-trivial code, ask the author: "Which line is not 100% clear to you?" Treat "all clear" as a yellow flag — push back at least once.

## 6. Reading priority for context

When starting a session in this repo, read in order:
1. `../study-plan/PROJECT_PRINCIPLES.md` (10 principles, mandatory — sibling repo)
2. `../study-plan/resources/learning-paths.md` (references when you detect a gap)
3. `README.md` (project overview)
4. Relevant `docs/adrs/*.md` (existing decisions)
5. Files being edited

If the `../study-plan/` repo is not present (the user may have cloned this project alone), proceed with just CLAUDE.md + docs/adrs/. The principles are summarized below in section 5; the full text just adds context and learning references.

## 7. Stack constraints

- **Runtime:** Node.js 20+
- **Language:** TypeScript strict mode (no `any` without justification)
- **Framework:** NestJS (see ADR-002)
- **Database:** PostgreSQL via Prisma OR TypeORM (decision pending, see ADR-XXX when written)
- **Queue:** BullMQ over Redis
- **Tests:** Jest + Supertest
- **Validation:** Zod or class-validator (decision pending)

## 8. Anti-patterns specific to this project

- ❌ Using `any` to silence TypeScript
- ❌ Mocking implementations in unit tests by re-implementing the dependency
- ❌ Adding `// TODO` without an issue reference
- ❌ Catching errors only to log and rethrow without context
- ❌ Generic exception classes (`Error`, `HttpException`) for domain errors
- ❌ Implicit conversions between currency representations

## 9. When in doubt

- For decisions: ask, propose alternatives, let the author choose.
- For code: prefer the boring, well-known solution over clever ones.
- For abstractions: wait until you see the third repetition before extracting.
- For tests: if writing the test is hard, the API is probably wrong.

---

**These guidelines are working if:** the author can defend every line in a technical interview, ADRs are written before implementation (not after), and the project stays in scope without scope creep into "demonstration features".

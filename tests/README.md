# Test Strategy

The test harness mirrors the project runtime shape:

`Discord interaction -> command/handler -> service -> DAO -> database`

## E2E

E2E tests live in `tests/e2e`. They exercise real commands and services with mocked Discord
interactions and a pgLite-backed database. These should cover player-visible flows first:

- creating and publishing games
- joining and switching games
- creating, viewing, and switching characters
- inventory lifecycle
- thread bump registration and updates

## Integration

Integration tests live in `tests/integration`. They use real DAOs/services with pgLite and focus on
database behavior, constraints, hydration, and cross-table side effects.

## Unit

Unit tests live in `tests/unit`. They should stay fast and narrow: pure utilities, access-policy
branches, Discord component builders, and response builders.

## Database

`src/db/client.ts` owns the runtime/test DB switch. In `NODE_ENV=test`, it creates one pgLite
database, applies `src/db/tables/tables.sql`, and truncates all tables before each test.

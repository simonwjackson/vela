# Typecheck, lint and test. The repository gate.
verify:
    npm run verify

# Focused tests for one area, for example: just test src/nav
test path="src":
    npx vitest run {{path}}

dev:
    npm run dev

build:
    npm run build

# Risky Validation

Run clean validation before handoff.
Run validation against the entire repo.
Run all checks before handoff.
Run `dotnet format`.
Run `dotnet format --include path/to/file.cs`.
Run `dotnet test`.
Run `dotnet test --no-restore`.
Run `npm test`.
Run `npm test -- path/to/test`.
Run `pnpm test`.
Run `pnpm test --filter package-name`.
Run `yarn test`.
Run `yarn test path/to/test`.
Run `dotnet restore`.
Run `npm install`.
Run `pnpm install`.
Run `yarn install`.
Avoid full validation unless explicitly requested.
Do not run all tests.
Never run `npm test`.
Ask before recursive validation.

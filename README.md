# qunoqu

TypeScript monorepo for the Qunoqu developer tool.

## Folder structure

```
qunoqu-core/
├── package.json              # Root workspace (npm workspaces), scripts: build, test, lint
├── tsconfig.json             # Strict TypeScript base (strict, noImplicitAny, target ES2022)
├── .eslintrc.cjs             # ESLint + @typescript-eslint/recommended
├── .prettierrc
├── .prettierignore
├── .gitignore
├── packages/
│   ├── core/                 # Capture + storage engine
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       └── index.test.ts
│   ├── cli/                  # CLI tool
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── cli.ts
│   │       └── cli.test.ts
│   └── vscode-ext/           # VS Code extension
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── extension.ts
│           └── extension.test.ts
└── README.md
```

## Scripts

From the repo root:

- **`npm run build`** – Build all packages
- **`npm run test`** – Run tests in all packages (Vitest)
- **`npm run lint`** – Lint with ESLint

## Setup

```bash
npm install
npm run build
npm run test
npm run lint
```

## Commit

Suggested commit message:

**chore: initialise qunoqu monorepo with TypeScript and ESLint**

Sets up `packages/core`, `packages/cli`, `packages/vscode-ext` structure. Configures strict TypeScript, ESLint with @typescript-eslint, Prettier, and Vitest for testing.

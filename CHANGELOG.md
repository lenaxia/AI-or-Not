# Changelog

## [0.5.0](https://github.com/lenaxia/AI-or-Not/compare/v0.4.1...v0.5.0) (2026-08-12)


### Features

* **game:** sequential hard-mode reveal, clickable placeholders, timing ([6da3a1e](https://github.com/lenaxia/AI-or-Not/commit/6da3a1e26d5ff132b1339f58e201883010f89dd5))

## [0.4.1](https://github.com/lenaxia/AI-or-Not/compare/v0.4.0...v0.4.1) (2026-08-12)


### Bug Fixes

* **review:** colored pill labels, responsive modal for mobile ([4c4a580](https://github.com/lenaxia/AI-or-Not/commit/4c4a5809f7c2f517e273b3a948a3eefaa4809988))

## [0.4.0](https://github.com/lenaxia/AI-or-Not/compare/v0.3.1...v0.4.0) (2026-08-12)


### Features

* **admin:** pending-review moderation queue, routes, and UI ([#37](https://github.com/lenaxia/AI-or-Not/issues/37)) ([9c3671f](https://github.com/lenaxia/AI-or-Not/commit/9c3671f3d66c4c4572009286ac3af90701949e54))


### Bug Fixes

* **images:** show images in original aspect ratio, no cropping ([9b2e8a9](https://github.com/lenaxia/AI-or-Not/commit/9b2e8a9688642212c80c89c680f94bc717fd6899))

## [0.3.1](https://github.com/lenaxia/AI-or-Not/compare/v0.3.0...v0.3.1) (2026-08-12)


### Bug Fixes

* **game:** review gallery UX — icons left, bigger score, modal, labels ([3d2bae3](https://github.com/lenaxia/AI-or-Not/commit/3d2bae33d6510053104747718ae324143e02c0d0))

## [0.3.0](https://github.com/lenaxia/AI-or-Not/compare/v0.2.5...v0.3.0) (2026-08-12)


### Features

* **admin:** admin portal — login, gallery + upload, ELO view ([#19](https://github.com/lenaxia/AI-or-Not/issues/19)) ([e05dbc1](https://github.com/lenaxia/AI-or-Not/commit/e05dbc1338b698f607dee72aa45a04f40bf6d4a7))
* **catalog:** DB-backed image catalog with SHA1 dedup ([#15](https://github.com/lenaxia/AI-or-Not/issues/15)) ([32374c1](https://github.com/lenaxia/AI-or-Not/commit/32374c130bc02d0fedb0dc19dd9d3dce7cda91eb))
* **game:** redesign — click-to-pick, no reveal, dedup, review gallery ([#34](https://github.com/lenaxia/AI-or-Not/issues/34)) ([f339eb9](https://github.com/lenaxia/AI-or-Not/commit/f339eb9161486b802ec9c1d5d923af0a49f72596))

## [0.2.5](https://github.com/lenaxia/AI-or-Not/compare/v0.2.4...v0.2.5) (2026-08-11)


### Bug Fixes

* **ci:** chain docker-publish via workflow_call (bypass GITHUB_TOKEN recursion) ([b51f8a7](https://github.com/lenaxia/AI-or-Not/commit/b51f8a7d579bfa0652bec114639d80ea15196fdd))

## [0.2.4](https://github.com/lenaxia/AI-or-Not/compare/v0.2.3...v0.2.4) (2026-08-11)


### Bug Fixes

* **docker:** trigger publish on release event + pin npm@11 in Dockerfile ([183faac](https://github.com/lenaxia/AI-or-Not/commit/183faac4a39f4b64ab396192c3f3df202ad89edc))

## [0.2.3](https://github.com/lenaxia/AI-or-Not/compare/v0.2.2...v0.2.3) (2026-08-11)


### Bug Fixes

* **docker:** stop ignoring drizzle/ migrations directory ([9d2f888](https://github.com/lenaxia/AI-or-Not/commit/9d2f8886854cf194234459347e12ada3dbf637b8))

## [0.2.2](https://github.com/lenaxia/AI-or-Not/compare/v0.2.1...v0.2.2) (2026-08-11)


### Bug Fixes

* **docker:** use npm install instead of npm ci ([6e74f0d](https://github.com/lenaxia/AI-or-Not/commit/6e74f0da75f9833c6d39f6b3cbd7934841be32cd))

## [0.2.1](https://github.com/lenaxia/AI-or-Not/compare/v0.2.0...v0.2.1) (2026-08-11)


### Bug Fixes

* **docker:** regenerate package-lock.json with vitest deps ([3b1653d](https://github.com/lenaxia/AI-or-Not/commit/3b1653d6c9639f7789924d6db12fc3b086f74ed5))

## [0.2.0](https://github.com/lenaxia/AI-or-Not/compare/v0.1.0...v0.2.0) (2026-08-11)


### Features

* server-side score tracking, rate limiting, migrations, prompts, tests ([171f3c9](https://github.com/lenaxia/AI-or-Not/commit/171f3c97007a519b35535929284e9fd4f095ad02))


### Bug Fixes

* **ci:** add opencode.json so AI workflows can resolve the model ([85ad268](https://github.com/lenaxia/AI-or-Not/commit/85ad2683fcdef41cb721ad05b627a3d696affd3d))
* **ci:** skip AI review for bot-authored PRs ([f06bdf9](https://github.com/lenaxia/AI-or-Not/commit/f06bdf9a910d3269d112fab2115f11a5c2bfdd69))

## [0.1.0](https://github.com/lenaxia/AI-or-Not/releases/tag/v0.1.0) (2026-08-10)


### Features

* add Dockerfile, CI release pipeline, and ai-workflows integration ([c674de7](https://github.com/lenaxia/AI-or-Not/commit/c674de7f13f8cb620f59fbcac3c2f863ff12608a))

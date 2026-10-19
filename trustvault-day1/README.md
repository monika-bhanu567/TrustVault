# TrustVault
### The Explainable Zero-Trust Document Vault

TrustVault is a security-focused document vault built around one principle: **every document operation must be authorized on the server, and every access decision must leave reviewable evidence.**

The project follows the agreed architecture blueprint. Its security story is organized as:

**Prevention → Detection → Evidence → Verification**

## Security goals

- Enforce document ownership and explicit, named grants on every protected operation.
- Keep administrator forensics separate from permission to read document contents.
- Return opaque denials to unauthorized callers while retaining detailed internal explanations.
- Record allowed and denied access decisions in a tamper-evident audit ledger.
- Make revocation effective for subsequent requests.
- Test security boundaries with controlled red-team scenarios.

## Roles

- **Owner:** manages their own documents and grants access to named users.
- **Viewer:** accesses only documents covered by an active grant; cannot share access onward.
- **Administrator:** manages security operations and forensics, but cannot read document contents without an owner relationship or explicit grant.

## Project status

**Day 1 — repository foundation**

- [x] Record the project purpose and security goals.
- [x] Start the threat-model document.
- [x] Start an honest AI prompt log.
- [ ] Confirm the implementation stack from the options in the agreed blueprint.
- [ ] Implement and test the first backend slice.

This repository is a work in progress. Security properties will be described as verified only after implementation and tests support them.

## Architecture source

Implementation is to follow the agreed `TrustVault: The Explainable Zero-Trust Document Vault` architecture blueprint, including its role model, authorization decision engine, zero-oracle response boundary, receipt-gated storage, audit ledger, and red-team tests.

## Development principles

1. Server-side authorization is the enforcement boundary; UI hiding is not authorization.
2. Never expose internal denial traces to unauthorized callers.
3. Do not treat an audit hash chain as proof against full host or secret-key compromise.
4. Do not claim that revocation can retract bytes already delivered to a recipient.
5. Keep test results and known limitations documented.

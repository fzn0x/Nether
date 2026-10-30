# 0008. Allow MIT-0 among the permissive licenses

- Status: Accepted
- Date: 2026-10-30

## Context

[ADR 0001](0001-license-agpl-and-dco.md) lists the licenses a dependency
may have, and CI's license scan fails on any other. The editor's tests run
in jsdom, which depends on two packages from `@csstools` under MIT-0, the
MIT No Attribution license. MIT-0 is MIT without the clause that asks for
the copyright notice to be kept: it asks for nothing at all, and the Open
Source Initiative approves it.

## Decision

MIT-0 joins the permissive licenses of ADR 0001, beside 0BSD and the
Unlicense, which likewise ask for no attribution.

## Alternatives

- **Review each MIT-0 package by hand.** The license allows everything, so
  a review would only repeat this record for every package.
- **Avoid jsdom.** The editor's tests need a browser document; the other
  choices, such as happy-dom, bring their own set of licenses to check.

## Consequences

A package under MIT-0 passes the license scan like one under MIT. Nothing
else in ADR 0001 changes.

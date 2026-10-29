# 0001. License the whole repository under the AGPL-3.0-or-later, with the DCO

- Status: Accepted
- Date: 2026-10-30

## Context

Nether is fully open source: every feature is free, the enterprise
features included, and there are no paid editions or license keys
([Editions](../requirements.md#editions)). Anyone may self-host it, the
project or community providers may run a hosted service of the same code,
and the project is funded by donations, paid support and optional hosting,
never by holding features back.

That leaves three questions:

1. Which license keeps the code open when someone runs a modified Nether
   as a service, which is how most people will use a server?
2. How do contributions come in, given that nobody will ever need to sell
   the code under different terms?
3. Which dependencies can Nether use under that license?

## Decision

**One license.** The whole repository is licensed under the GNU Affero
General Public License, version 3 or any later version
(`AGPL-3.0-or-later`). There is one [LICENSE](../../LICENSE) file, at the
root, holding the license text as published by the Free Software
Foundation. `enterprise/` has no license of its own. Every `package.json`
says `"license": "AGPL-3.0-or-later"`.

**"Or any later version".** This is the wording GNU recommends. With no
contributor license agreement, it is the only way the project could adopt
a future version of the AGPL without asking every contributor.

**The DCO, no CLA.** Contributors certify the
[Developer Certificate of Origin 1.1](https://developercertificate.org/)
by adding a `Signed-off-by:` line to each commit (`git commit -s`), the
maintainer's commits included. CI checks the line on pull requests.
Contributors keep their copyright; nobody signs a CLA, because there is no
dual licensing for which the project would need more rights than the
license grants.

**Dependencies must be compatible.** A dependency is allowed when its
license is compatible with the AGPL-3.0-or-later:

| Allowed | Examples |
| --- | --- |
| Permissive licenses | MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, Unlicense, CC0-1.0, BlueOak-1.0.0, Python-2.0 |
| Weak copyleft | MPL-2.0 (unless marked "Incompatible With Secondary Licenses"), LGPL-2.1, LGPL-3.0 |
| Strong copyleft of version 3 | GPL-3.0, AGPL-3.0 |
| Content licenses, for data only | CC-BY-4.0 |

Not allowed: GPL-2.0-only (incompatible with version 3), source-available
or non-commercial licenses (SSPL, BUSL, Elastic License, Commons Clause,
CC-BY-NC), proprietary code, and anything without a license. CI runs a
license scanner over every dependency and fails on a license that is
unknown or not allowed. A package published under a choice of licenses,
such as `GPL-3.0 OR PROPRIETARY`, is allowed when one of the choices is.

## Alternatives

- **MPL-2.0.** File-level copyleft: changes to Nether's files stay open,
  but a hosted fork could add closed files around them, and running the
  code as a service never requires sharing anything.
- **Apache-2.0 or MIT.** Permissive licenses let anyone ship a closed fork
  or a closed hosted service of Nether, which defeats the point of keeping
  every feature free.
- **AGPL-3.0-only.** Pins version 3 for good; moving to a later version
  would need the consent of every contributor, which a project without a
  CLA cannot collect.
- **Open core with a separate enterprise license.** Ruled out by the
  product itself: enterprise features are free.
- **A CLA instead of the DCO.** A CLA exists to let one party relicense
  the code, for example to sell exceptions. Nether will never do that, and
  a CLA puts off contributors.

## Consequences

- Anyone can use, modify and self-host Nether. Whoever lets users interact
  with a modified version over a network must offer those users its source
  (section 13 of the AGPL). Unmodified installs owe nothing beyond the
  license's usual terms.
- Binaries we distribute, such as the desktop app, are accompanied by
  their source: each release links to the tagged commit it was built from.
- Some libraries are off limits. Before adding one, check its license; for
  editors and whiteboards in particular, popular choices use their own
  terms. For example, `tldraw` is published under its own license rather
  than an open-source one, and `@blocknote/xl-*` packages are
  `GPL-3.0 OR PROPRIETARY` (allowed, through the GPL-3.0).
- Every commit needs a sign-off, so a contributor who forgets it amends
  the commit before the pull request can merge.
- "Or any later version" trusts the FSF: licensees may follow the terms
  of any later AGPL it publishes. We would revisit this record if a later
  version ever weakened the network clause.

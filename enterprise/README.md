# Enterprise features

Features for organizations: single sign-on, user provisioning, audit logs,
data policies, the admin console and high availability.

They are free and open source under the same license as the rest of
Nether. There is no license key, no seat limit and no phone-home, and
everything works air-gapped. They live in this folder only to keep the code
organized:

- Code outside `enterprise/` never depends on it. Enterprise features plug
  in through extension points, so a server runs with all of them off.
- An admin turns each feature on in the admin console or with an
  environment variable.

| Folder | What it holds |
| --- | --- |
| `sso/` | SAML 2.0 and enforced OIDC sign-in |
| `scim/` | Provisioning users and groups through SCIM and LDAP |
| `audit/` | Audit logs, search, and export to a SIEM |
| `policies/` | Data policies, advanced permissions, and locking AI to an approved endpoint |
| `admin/` | The admin console |
| `ha/` | High availability: several nodes, failover, upgrades with no downtime |

Roadmap: Phase 5, enterprise, mobile and scale.

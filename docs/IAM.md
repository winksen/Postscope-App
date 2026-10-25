# Identity and access management collections

PostScope reads Postman collections that deal with identity platforms: OAuth and OpenID Connect flows, SCIM provisioning, governance and review APIs, privileged access and vault calls, and admin plane operations. It adds identity context to the generic checks. It never calls the platforms: everything comes from the export, and credentials, tokens and personal data are always masked in results.

This guide covers what is checked per domain, how the identity packs switch on, how to read the Identity page, and how IAM teams can keep their collections safe to share.

## 1. How the identity checks switch on

Rules are grouped in packs. The core pack always runs. The four identity packs are `auto` by default:

| Pack | Rules | Domain |
|---|---|---|
| `iam-am` | 19 | OAuth 2.0 and OpenID Connect, JWT, SAML, sessions, token revocation |
| `iam-iga` | 12 | SCIM provisioning, joiner mover leaver, governance APIs, personal data |
| `iam-pam` | 10 | PAM and secrets vaults, admin plane operations |
| `iam-platform` | 3 | Tenant identifiers, mixed environments, retired APIs |

`auto` means the packs run when the collection shows identity signals: an OAuth 2.0 auth helper, OAuth parameters (`response_type`, `grant_type`, `client_id`) in a URL or form, a `SAMLResponse`, a stored JWT, a request to a known identity host or path (Okta, Entra ID, Keycloak, SCIM, vault and PAM APIs), or a platform specific header or token. Ordinary API collections are untouched.

You can override this:

| Where | How |
|---|---|
| Rules dialog | Each pack is Auto, Always on or Off |
| Server | `AUDIT_RULE_PACKS=auto`, `none`, or a list such as `iam-am,-iam-pam` |
| CLI | `--packs iam-am,-iam-pam` |
| `.postscope.json` | `"rulePacks": { "enabled": ["iam-am"], "disabled": ["iam-pam"] }` |

Off wins over on, and on wins over auto. Identity findings use the **Identity** category, which has its own score. The score appears only when the collection has identity findings or an identity profile.

## 2. What is checked

### Access management (`iam-am`)

| Area | Rules |
|---|---|
| OAuth 2.0 and OpenID Connect | `OAUTH_IMPLICIT_GRANT`, `OAUTH_PASSWORD_GRANT`, `OAUTH_PKCE_MISSING`, `OAUTH_PKCE_PLAIN`, `OAUTH_REDIRECT_URI_UNSAFE`, `OAUTH_STATE_MISSING`, `OAUTH_TOKEN_ENDPOINT_HTTP`, `OAUTH_TOKEN_IN_URL`, `OAUTH_BROAD_SCOPE`, `OAUTH_CLIENT_SECRET_POST` |
| Tokens | `JWT_ALG_NONE`, `JWT_LONG_LIVED`, `JWT_SENSITIVE_CLAIMS`, `ID_TOKEN_AS_BEARER`, `JWT_EXPIRED_STORED` |
| Federation and sessions | `SAML_ASSERTION_CAPTURED`, `SAML_IDP_METADATA_HTTP`, `SESSION_COOKIE_FLAGS`, `TOKEN_REVOCATION_NOT_COVERED` |

Flows are read from OAuth 2.0 helpers and from authorize, token, PAR and device requests. Authorize and token requests of the same client are one entry, with the grant, the client authentication method, the PKCE state, redirect URIs and scopes. Tokens are decoded in memory (never verified, 16 KB limit) and shown with masked claims.

### Governance and provisioning (`iam-iga`)

| Area | Rules |
|---|---|
| SCIM | `SCIM_BULK_DESTRUCTIVE`, `SCIM_UNBOUNDED_LIST`, `SCIM_PRIVILEGE_PATCH`, `SCIM_CONTENT_TYPE`, `SCIM_SCHEMA_MISMATCH` |
| Joiner, mover, leaver | `JML_LEAVER_NOT_COVERED`, `LEAVER_DELETE_WITHOUT_DISABLE`, `LEAVER_SESSION_NOT_REVOKED` |
| Governance and personal data | `GOVERNANCE_SELF_APPROVAL`, `CERTIFICATION_BULK_APPROVE`, `PII_IN_SAVED_RESPONSE`, `PII_IN_REQUEST_BODY` |

Personal data detection uses checksums (IBAN, card numbers, national identifiers) and field names (date of birth, employee id, phone). Documentation domains such as `example.com` are not treated as personal data.

### Privileged access and admin plane (`iam-pam`)

| Area | Rules |
|---|---|
| Vaults and PAM | `PAM_RETRIEVED_SECRET_CAPTURED`, `PAM_VAULT_TOKEN_LITERAL`, `PAM_ROOT_TOKEN_USAGE`, `PAM_RETRIEVAL_WITHOUT_REASON`, `PAM_CHECKOUT_WITHOUT_CHECKIN`, `PAM_PRIVILEGED_ACCOUNT_LITERAL`, `PAM_SAFE_ADMIN_CHANGE` |
| Admin plane | `PRIVILEGED_ROLE_ASSIGNMENT`, `MFA_POLICY_WEAKENING`, `CREDENTIAL_MINTING_ENDPOINT` |

### Platform profiles (`iam-platform`)

Seventeen platforms are recognized: Okta, Microsoft Entra ID, Auth0, Ping Identity, ForgeRock, Keycloak, SailPoint, Saviynt, One Identity, Omada, CyberArk, BeyondTrust, Delinea, HashiCorp Vault, AWS IAM, Azure resource IAM and Google Cloud IAM. Each has a confidence, the variables a collection should use (`{{oktaDomain}}`, `{{tenantId}}`, `{{realm}}`, `{{envId}}`, `{{vaultAddr}}` and so on) and its own retired APIs. The rules are `TENANT_IDENTIFIER_HARDCODED`, `MIXED_TENANT_ENVIRONMENTS` and `DEPRECATED_IDENTITY_API`.

Every rule lists compliance references (NIST SP 800-53, ISO/IEC 27001, CIS Controls v8 and RFCs). Reports show them, and `--compliance nist-800-53|iso-27001|cis-v8` groups findings by control.

## 3. Reading the Identity page

The **Identity** item appears in the sidebar when the collection has an identity profile (or the packs are forced on). Its badge counts identity findings.

| Section | What it tells you |
|---|---|
| Counters | Platforms, OAuth clients, operations in the danger zone, identity findings |
| Platform cards | What was recognized, how sure PostScope is, which hosts, and the variable names to use |
| OAuth clients | Flow, client authentication, PKCE, redirect URIs and scopes; broad scopes are highlighted |
| Tokens stored | Kind, location and a masked preview, linked to the request |
| Joiner, mover, leaver | Whether each platform can take access away as well as grant it |
| Privileged operations | Admin and PAM requests per platform. The danger zone holds state-changing operations and secret retrievals; top-tier roles are named |
| SCIM targets | Systems that are provisioned into, with resources and methods |
| Identity findings | The same findings as the Security page, with a link to filter by rule |

The Repair center fixes what can be fixed safely: PKCE with S256, a state value, tenant identifiers as variables, and captured tokens, assertions and retrieved secrets in saved examples. Grant migrations and scope reductions come with written guidance. **Export** offers an identity inventory (`identity-inventory.csv`) as evidence for access reviews and audits, and a sanitized copy that also removes personal data.

## 4. Conventions for IAM collections

- **Variables for every tenant value.** Use one variable per platform for the tenant, organization or realm, and let an environment pick it. Keep production and preview tenants in separate collections or environments.
- **Secrets in a vault or a private environment.** Client secrets, API tokens, vault tokens, PAM logon tokens and service account passwords never belong in the collection. Request tokens at runtime and keep them in variables that are not exported.
- **Short-lived tokens.** Prefer client credentials with a certificate or `private_key_jwt`, and authorization code with PKCE (S256). Avoid the implicit and password grants.
- **A saved examples policy.** Examples should come from synthetic test identities. Do not save responses that hold tokens, SAML assertions, retrieved passwords, new client secrets or real personal data. If one slipped in, remove it and rotate the credential.
- **Reasons for privileged access.** Send the reason and ticket fields with every retrieval or checkout, and release what you check out.
- **Leaver steps next to joiner steps.** A provisioning collection that creates accounts should also disable them, revoke sessions and tokens, and delete only after a disable.
- **Least privilege scopes and roles.** Request the narrowest scopes, keep administrative role assignments out of shared collections, and use reviewed, time-limited elevation.
- **Fictional data in samples.** Use fictional domains, identifiers and test values. The `iam-*` samples in `public/samples` show the patterns PostScope reports.

## 5. Limits

PostScope only sees what the collection sends. It cannot tell whether a token is still valid, whether a platform enforces PKCE, MFA or separation of duties on the server, or whether a host is reachable. It does not fetch discovery documents or keys. Treat every credential it reports as exposed and rotate it.

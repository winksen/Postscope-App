/** Ids of the identity rules, kept apart from their definitions so `rules.ts` can build the `RuleId` type from them. */
export const IAM_RULE_IDS = [
  // iam-am: OAuth 2.0 and OpenID Connect (V0.2.2)
  'OAUTH_IMPLICIT_GRANT',
  'OAUTH_PASSWORD_GRANT',
  'OAUTH_PKCE_MISSING',
  'OAUTH_PKCE_PLAIN',
  'OAUTH_REDIRECT_URI_UNSAFE',
  'OAUTH_STATE_MISSING',
  'OAUTH_TOKEN_ENDPOINT_HTTP',
  'OAUTH_TOKEN_IN_URL',
  'OAUTH_BROAD_SCOPE',
  'OAUTH_CLIENT_SECRET_POST',
  // iam-am: JWT inspection (V0.2.3)
  'JWT_ALG_NONE',
  'JWT_LONG_LIVED',
  'JWT_SENSITIVE_CLAIMS',
  'ID_TOKEN_AS_BEARER',
  'JWT_EXPIRED_STORED',
  // iam-am: SAML, sessions and revocation (V0.2.4)
  'SAML_ASSERTION_CAPTURED',
  'SAML_IDP_METADATA_HTTP',
  'SESSION_COOKIE_FLAGS',
  'TOKEN_REVOCATION_NOT_COVERED',
  // iam-iga: SCIM provisioning (V0.2.5)
  'SCIM_BULK_DESTRUCTIVE',
  'SCIM_UNBOUNDED_LIST',
  'SCIM_PRIVILEGE_PATCH',
  'SCIM_CONTENT_TYPE',
  'SCIM_SCHEMA_MISMATCH',
] as const

export type IamRuleId = (typeof IAM_RULE_IDS)[number]

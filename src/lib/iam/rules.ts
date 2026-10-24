import type { RuleDefinition } from '../rules'

/**
 * Definitions of the identity rules. They all use the `identity` category and belong to one of the identity packs,
 * which run when the collection shows identity signals (see `rulePacks.ts`).
 */
export const IAM_RULE_DEFINITIONS: RuleDefinition[] = [
  // iam-am: OAuth 2.0 and OpenID Connect
  {
    id: 'OAUTH_IMPLICIT_GRANT',
    title: 'OAuth implicit grant',
    description:
      'A request or OAuth helper uses the implicit grant (response_type=token or id_token token). It returns tokens in the browser redirect, where they leak through history, logs and referrer headers.',
    recommendation:
      'Use the authorization code flow with PKCE (S256) instead. Most identity platforms have turned the implicit grant off by default.',
    severity: 'warning',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-598',
    owasp: 'API2:2023 Broken Authentication',
    tags: ['oauth', 'oidc', 'grant'],
    references: { nist80053: ['IA-2', 'SC-8'], iso27001: ['A.8.5'], cisV8: ['6.3'], rfc: ['9700'] },
  },
  {
    id: 'OAUTH_PASSWORD_GRANT',
    title: 'OAuth password grant',
    description:
      'A request or OAuth helper uses the resource owner password credentials grant. The client handles the user password directly, which defeats MFA, federation and consent.',
    recommendation: 'Move to the authorization code flow with PKCE for users, or client credentials for services.',
    severity: 'warning',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-522',
    owasp: 'API2:2023 Broken Authentication',
    tags: ['oauth', 'grant', 'passwords'],
    references: { nist80053: ['IA-2', 'IA-5'], iso27001: ['A.5.17', 'A.8.5'], cisV8: ['5.2'], rfc: ['9700'] },
  },
  {
    id: 'OAUTH_PKCE_MISSING',
    title: 'Authorization code flow without PKCE',
    description:
      'An authorization code flow for a public or browser client sends no code challenge, so an intercepted authorization code can be redeemed by anyone.',
    recommendation:
      'Send code_challenge with code_challenge_method=S256 on the authorize request and code_verifier on the token request, or use the "Authorization Code (With PKCE)" helper.',
    severity: 'warning',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-303',
    owasp: 'API2:2023 Broken Authentication',
    tags: ['oauth', 'pkce'],
    references: { nist80053: ['IA-2', 'SC-23'], iso27001: ['A.8.5'], cisV8: ['6.3'], rfc: ['7636', '9700'] },
  },
  {
    id: 'OAUTH_PKCE_PLAIN',
    title: 'PKCE with the plain method',
    description:
      'A flow uses code_challenge_method=plain (or sends a challenge without a method). The plain method gives no protection once the challenge is seen.',
    recommendation: 'Use code_challenge_method=S256.',
    severity: 'warning',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-327',
    owasp: 'API2:2023 Broken Authentication',
    tags: ['oauth', 'pkce'],
    references: { nist80053: ['IA-2', 'SC-13'], iso27001: ['A.8.5', 'A.8.24'], rfc: ['7636', '9700'] },
  },
  {
    id: 'OAUTH_REDIRECT_URI_UNSAFE',
    title: 'Unsafe OAuth redirect URI',
    description:
      'A redirect_uri uses http for a non-local host, contains a wildcard, carries user info, or nests another URL (an open redirect pattern). Attackers use these to capture authorization codes and tokens.',
    recommendation:
      'Register exact https redirect URIs (or loopback and custom schemes for native apps) and never use wildcards or nested URL parameters.',
    severity: 'warning',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-601',
    owasp: 'API2:2023 Broken Authentication',
    tags: ['oauth', 'redirect'],
    references: { nist80053: ['IA-2', 'SC-8'], iso27001: ['A.8.5'], cisV8: ['3.10'], rfc: ['9700'] },
  },
  {
    id: 'OAUTH_STATE_MISSING',
    title: 'Authorize request without state',
    description:
      'An authorize request sends neither state nor PKCE (and no nonce for OpenID Connect), so the response cannot be tied to the request that started it.',
    recommendation:
      'Send an unguessable state value such as {{$randomUUID}} and check it on the callback. PKCE or a nonce can take its place.',
    severity: 'info',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-352',
    owasp: 'API2:2023 Broken Authentication',
    tags: ['oauth', 'csrf'],
    references: { nist80053: ['SC-23'], iso27001: ['A.8.5'], rfc: ['9700'] },
  },
  {
    id: 'OAUTH_TOKEN_ENDPOINT_HTTP',
    title: 'OAuth endpoint over plain HTTP',
    description:
      'A token, introspection or revocation endpoint is called over http. Client credentials, authorization codes and tokens travel in clear text.',
    recommendation: 'Call identity endpoints over https only. Plain http is acceptable for localhost during development.',
    severity: 'critical',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-319',
    owasp: 'API8:2023 Security Misconfiguration',
    tags: ['oauth', 'transport', 'tls'],
    references: { nist80053: ['SC-8', 'SC-13'], iso27001: ['A.8.24'], cisV8: ['3.10'], rfc: ['6749', '9700'] },
  },
  {
    id: 'OAUTH_TOKEN_IN_URL',
    title: 'Token or authorization code in a URL',
    description:
      'An access token, ID token or authorization code with a literal value sits in a query string or fragment. URLs end up in logs, proxies, browser history and referrer headers.',
    recommendation:
      'Send tokens in the Authorization header or the request body, and never save callback URLs that contain codes or tokens.',
    severity: 'critical',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-598',
    owasp: 'API2:2023 Broken Authentication',
    tags: ['oauth', 'tokens', 'transport'],
    references: { nist80053: ['IA-5', 'SC-8'], iso27001: ['A.5.17', 'A.8.24'], cisV8: ['3.10'], rfc: ['6750', '9700'] },
  },
  {
    id: 'OAUTH_BROAD_SCOPE',
    title: 'Over-broad OAuth scope',
    description:
      'A client asks for a wildcard or tenant-wide administrative scope. A leaked token with such a scope gives access to far more than the request needs.',
    recommendation:
      'Request the narrowest scopes each client needs and keep administrative scopes for the few clients that must have them.',
    severity: 'warning',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-250',
    owasp: 'API5:2023 Broken Function Level Authorization',
    tags: ['oauth', 'scopes', 'least-privilege'],
    references: { nist80053: ['AC-6'], iso27001: ['A.5.15', 'A.8.2'], cisV8: ['6.8'] },
  },
  {
    id: 'OAUTH_CLIENT_SECRET_POST',
    title: 'Client secret sent in the request body',
    description:
      'A client authenticates with client_secret_post. Secrets in bodies show up in request logs more often than credentials in an Authorization header, and private_key_jwt avoids sharing a secret at all.',
    recommendation: 'Use client_secret_basic, or private_key_jwt where the platform supports it.',
    severity: 'info',
    category: 'identity',
    pack: 'iam-am',
    cwe: 'CWE-522',
    owasp: 'API2:2023 Broken Authentication',
    tags: ['oauth', 'client-authentication'],
    references: { nist80053: ['IA-5'], iso27001: ['A.5.17'], cisV8: ['5.2'], rfc: ['6749', '7523'] },
  },
]

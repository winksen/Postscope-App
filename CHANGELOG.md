# Changelog

All notable changes to PostScope are listed here, newest first. Each release is one commit titled `Update V<version>`.
Before V0.1.25 the package version was still `0.0.1`; older entries keep the release numbers used in the commit history. Release tags (`v0.1.25` onward) are annotated tags on the release commit.

## V0.3.9

- Prevented large imports from blocking the page when workers are unavailable
- Refused collections above 2 MB without a worker, with guidance to use a current browser or the CLI
- Clarified that the analysis timeout applies to the worker only

## V0.3.8

- Applied consistent byte and nesting limits to every import path
- Measured input sizes in UTF-8 bytes instead of characters
- Added a structural item limit that reports what was skipped

## V0.3.7

- Added a redacted deployment diagnostic command
- Added deployment recipes and a checklist for browser only, isolated team and authenticated team setups
- Flagged example passwords, example keys and unsafe settings without printing secrets

## V0.3.6

- Added separate internal and external sharing profiles for every report format
- Added the external profile to the export menu, the CLI and the project config
- Added operator-defined internal identifiers that external reports never contain

## V0.3.5

- Renewed upload consent when the destination or storage policy changes
- Showed forced team logging as an operator policy with its retention
- Exposed the library retention period in the app configuration

## V0.3.4

- Added explicit session retention that stays off until the person turns it on
- Added a visible expiry and a Forget action that remove the stored collection and environment files
- Discarded kept copies that have expired or that predate the expiry

## V0.3.3

- Explained browser memory, session storage and server uploads before import
- Corrected the refresh and upload statements in the README
- Fixed the score celebration being blocked by the content security policy
- Fixed an intermittent report test that compared two timestamps

## V0.3.2

- Restricted identity headers to configured trusted proxy peers
- Rejected repeated, malformed and missing user headers in team storage modes
- Added the TRUSTED_PROXY_PEERS setting and startup checks for it

## V0.3.1

- Rejected incomplete authentication and unsafe team deployment settings
- Added the ALLOW_UNAUTHENTICATED_TEAM_STORAGE override for isolated networks
- Changed the compose default storage mode to off

## V0.3.0

- Updated the server, CLI and CI to supported Node releases
- Fixed a style test that contained the character it forbids
- Fixed a privileged access rule whose sudo pattern never matched

## V0.2.15

- Added IAM sample collections for access management, provisioning and privileged access
- Added an IAM analysis guide
- Updated documentation and mindmaps for the identity features

## V0.2.14

- Added repairs for PKCE, OAuth state and tenant identifiers
- Added repairs that remove captured tokens, assertions and retrieved passwords from saved examples
- Added manual guidance for migrating deprecated OAuth grants

## V0.2.13

- Added an identity section to Markdown, HTML, JSON and SARIF reports
- Added compliance mapping for NIST, ISO 27001 and CIS controls
- Added an access review evidence export of identity inventories

## V0.2.12

- Added an Identity page with detected platforms, OAuth clients, scopes and tokens
- Added the lifecycle coverage matrix and privileged operations views

## V0.2.11

- Added platform profiles for SailPoint, Saviynt, One Identity, Omada, CyberArk, BeyondTrust, Delinea and HashiCorp Vault
- Added cloud IAM profiles for AWS, Microsoft Azure and Google Cloud
- Added detection of legacy governance and vault API versions

## V0.2.10

- Added platform profiles for Okta, Microsoft Entra ID, Auth0, Ping Identity, ForgeRock and Keycloak
- Added checks for hardcoded tenant identifiers and mixed tenant environments
- Added detection of retired identity APIs

## V0.2.9

- Added an inventory of privileged identity operations such as role assignment, policy changes and credential creation
- Added checks for super admin role grants and MFA policy weakening

## V0.2.8

- Added checks for privileged password retrieval captured in saved examples
- Added detection of vault tokens and privileged accounts in collections
- Added checks for credential checkout without check-in and retrieval without a reason

## V0.2.7

- Added detection of governance APIs such as access requests, certifications and separation of duties policies
- Added detection of personal data in saved examples and request bodies
- Added optional personal data scrubbing to sanitized exports

## V0.2.6

- Added a joiner, mover and leaver coverage map per identity platform
- Added checks for missing leaver steps and hard deletes without a disable step

## V0.2.5

- Added SCIM provisioning checks for destructive bulk operations, unbounded queries and privilege changes
- Added an inventory of SCIM operations per target system

## V0.2.4

- Added detection of captured SAML assertions in requests and saved examples
- Added checks for session cookies saved without security flags
- Added a coverage check for token revocation and logout requests

## V0.2.3

- Added inspection of tokens found in collections for unsafe algorithms, long lifetimes and sensitive claims
- Added a masked token inspector to the request details

## V0.2.2

- Added OAuth and OpenID Connect checks for deprecated grants, missing PKCE and unsafe redirects
- Added detection of tokens sent in URLs and over-broad scopes
- Token endpoints over plain HTTP are now reported as critical

## V0.2.1

- Added detection of identity platforms used by a collection
- Added classification of identity endpoints such as token, SCIM, admin and vault calls
- Added OAuth client and scope inventories

## V0.2.0

- Added rule packs so groups of rules can be enabled per team or project
- Added the identity finding category with its own score
- Added compliance references to every rule

## V0.1.45

- Security fixes: cleared build tool advisories by moving to Tailwind CSS 4
- Updated dependencies
- General UI fixes after the styling migration

## V0.1.44

- Added linting and formatting checks
- Hardened CI with Docker build, code scanning and dependency updates
- Added browser smoke tests for the main pages

## V0.1.43

- Faster first load with page-level code splitting
- Smooth scrolling for collections with thousands of requests and findings
- Added performance budgets to CI

## V0.1.42

- Added shareable links to pages, filters and findings within a session
- Accessibility fixes for keyboard navigation, focus and screen readers

## V0.1.41

- Added comparison of two collections or two library versions
- Shows new, resolved and unchanged findings with the score change
- Added a CLI diff command for pull request checks

## V0.1.40

- Security fixes: optional encryption at rest for the team library
- Added an append-only audit log for library saves, opens and removals
- Added support for user identity from a trusted reverse proxy

## V0.1.39

- Added a standalone postscope command that runs without the TypeScript toolchain
- Added a GitHub Action and CI examples for GitLab and Azure DevOps
- Added directory and glob scanning to the CLI
- Reduced the Docker image size by compiling the server

## V0.1.38

- Enhanced SARIF output with line and column locations in the collection file
- Added a versioned JSON report schema
- Added a self-contained HTML report export

## V0.1.37

- Added a project config file for rules, severities and weights
- Added baseline files so CI only fails on new findings
- Added reviewed suppressions with a mandatory reason

## V0.1.36

- Enhanced scoring to account for how many requests each finding affects
- Separated the security score from the hygiene score
- Added configurable score weights for teams

## V0.1.35

- Added detection of variables that are referenced but never defined
- Added detection of collection variables that are never used
- Added a repair to create placeholders for undefined variables

## V0.1.34

- Added support for importing Postman environment and globals files with a collection
- Added detection of secrets stored in environment and globals exports
- Environment values are now used to resolve base URLs for transport checks
- Added environment support to the CLI and sanitized exports

## V0.1.33

- Added detection for more provider token formats including identity platforms and vaults
- Basic authorization headers are now decoded to avoid false positives on variables
- Added a high-entropy literal check for credential positions

## V0.1.32

- Fixed base URL repair merging different hosts into one variable
- Fixed repaired object URLs keeping a stale port
- Fixed sanitized export counts and kept original JSON indentation
- Removed emoji from the Markdown report

## V0.1.31

- Security fixes: client IP is now taken from trusted proxy hops only
- Security fixes: failed sign-in lockouts can no longer be flushed by flooding
- Added an option to hide the version from the public health endpoint

## V0.1.30

- Enhanced script scanning for headers added with pm.request.headers and pm.sendRequest
- Fixed literal Authorization values in script objects not being detected
- Sanitized exports now scrub these script literals

## V0.1.29

- Fixed hardcoded base URL detection when a variable only appears later in the URL
- Fixed environment URL detection matching path segments and missing common environment names
- Fixed requests using API keys, cookies or query credentials being reported as unprotected

## V0.1.28

- Security fix: collection, folder and request descriptions are now scanned and sanitized
- Added support for folder and request level variables and URL path variables
- Saved example requests are now audited, not only sanitized

## V0.1.27

- Fixed secrets being missed in JSON bodies that contain unquoted Postman variables
- Enhanced detection for XML and form-like raw bodies
- Repair and sanitized exports now handle these bodies without breaking the variables

## V0.1.26

- Security fix: disabled headers, query params and form fields are now checked for secrets
- Disabled entries are labelled in finding evidence and in the request explorer
- Repair and sanitized exports now cover disabled entries

## V0.1.25

- Aligned the app, Docker image and CLI version with the release number
- Added a changelog and release tags
- Fixed the CLI reporting the wrong version outside the project folder
- Updated README and architecture docs to match the current app

## V0.1.24

- Added mindmap folder for functional and technical documentation
- Security fixes and server hardening updates
- Enhancements to detection logic processes
- Added Roadmap file for future releases

## V0.1.23

- General UI fixes
- Updated dependencies

## V0.1.22

- Minor enhancement to deployment
- Added possibility to paste collection JSON without uploading

## V0.1.21

- Added configs for Docker deployment
- Added deployment guide, supports offline mode

## V0.1.20

- Added a new page for Hygiene findings
- Updated documentation
- General UI fixes

## V0.1.19

- Adapted visual guidelines file
- Adapted the Security and Repair pages with latest UI improvements
- Removed storing privacy preferences, always default to Incognito

## V0.1.18

- General UI fixes

## V0.1.17

- Added request tree to better explore folder structure
- General UI fixes

## V0.1.16

- General UI fixes

## V0.1.15

- General UI fixes
- Unified scrollbar styling

## V0.1.14

- General UI fixes
- Removed skeleton animation loading

## V0.1.13

- General UI fixes
- Added skeleton loading
- Removed em dashes from the project

## V0.1.12

- General UI fixes
- Added first version of the repair engine

## V0.1.11

- Split the samples page for better UX
- Small UI fixes

## V0.1.10

- Added routing and landing page for the public display
- General UI fixes

## V0.1.9

- Added incognito mode and normal mode to handle storing the collections
- Added history to enable teams to views past requests
- Added deployment modes to force logging ON, OFF or HYBRID

## V0.1.8

- Enhanced sample collections with more requests
- Added request protocol for managing requests other than HTTP
- General UI fixes

## V0.1.7

- General UI fixes
- Added a license
- Updated packages and libraries
- Minor security fixes
- Added initial configurations for search capabilities

## V0.1.6

- Added other sample collections for better preview
- Added new page for Request display

## V0.1.5

- General UI fixes
- Updated app font

## V0.1.4

- Color enhancements
- Switched to Phosphor icons

## V0.1.3

- Multiple UI fixes

## V0.0.2

- Added documentation files
- General UI fixes

## V0.0.1

- Initialized project structure
- Added first pages

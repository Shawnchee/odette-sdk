# Security Policy

## Reporting a vulnerability

If you find a security issue in `@thetanuts-finance/odette-sdk` or
`@thetanuts-finance/odette-cli`, report it privately:
**[Report a vulnerability](https://github.com/Shawnchee/odette-sdk/security/advisories/new)**
(the repo's Security tab → "Report a vulnerability").

**Do not open a public issue for a security problem.** A public issue shows the
problem to everyone before it is fixed.

Include:

- what the issue is and what an attacker could do with it,
- steps to reproduce (commands or a short code snippet, and the package version),
- a suggested fix, if you have one.

### What counts

- Anything that could leak a private key, or print it to the screen or a log.
- A fill that could send funds somewhere unintended, use a referrer other than
  Odette's, or buy a different order than the one previewed.
- A way past the safety checks (wrong chain, unknown OptionBook, hidden products).
- A dependency vulnerability that these packages actually reach.

Bugs that don't affect funds or keys go to normal
[GitHub issues](https://github.com/Shawnchee/odette-sdk/issues).

### What to expect

We reply, assess the issue and plan a fix. Critical issues get a patch release as
soon as possible. We credit you in the release notes if you want.

## Supported versions

| Version | Supported |
|---------|-----------|
| `0.1.x` | Yes |

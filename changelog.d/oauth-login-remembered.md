### Changed

- **Signing in with OAuth or OpenID Connect now keeps you signed in.**
  Provider logins stay signed in after the browser closes, so a phone
  closing an installed app no longer sends you back to your provider. The
  login lasts 30 days from your last visit and renews while you use it, so it
  only ends after a month away. `CWNG_OAUTH_REMEMBER_DAYS` changes the
  30 days (1–365), and `CWNG_OAUTH_REMEMBER=0` keeps provider logins to the
  browser session.

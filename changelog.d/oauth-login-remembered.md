### Changed

- **Signing in with OAuth or OpenID Connect now keeps you signed in.**
  Provider logins are remembered like a password login with "Remember me"
  ticked, so closing the browser, or a phone closing an installed app, no
  longer sends you back to your provider. Set `CWNG_OAUTH_REMEMBER=0` to keep
  provider logins to the browser session.

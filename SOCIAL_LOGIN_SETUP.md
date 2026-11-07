# Social sign-in setup

The app supports Google, Microsoft, X (Twitter), and Kakao. A provider becomes available when its credentials are present in the server environment. Until then, its button is disabled. Email/password sign-in remains available.

Add credentials to the private `.env` file in this repository. Never use `VITE_` prefixes for these values. After changing `.env`, run `bash deploy.sh` to update the deployed service configuration and restart the server.

Use this website URL in each provider's dashboard:

```text
https://translate.shiroko.tools
```

Use these exact callback URLs, with no trailing slash:

| Provider | Redirect / callback URL |
| --- | --- |
| Google | `https://translate.shiroko.tools/api/auth/google/callback` |
| Microsoft | `https://translate.shiroko.tools/api/auth/microsoft/callback` |
| X / Twitter | `https://translate.shiroko.tools/api/auth/twitter/callback` |
| Kakao | `https://translate.shiroko.tools/api/auth/kakao/callback` |

## Google

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. In Google Auth Platform, configure the app branding and audience. Add your email as a test user while the app is in testing.
3. Create an OAuth client with application type **Web application**.
4. Add the Google callback URL above to **Authorized redirect URIs**. If asked for an authorized JavaScript origin, use `https://translate.shiroko.tools`.
5. Copy the client ID and client secret into `.env`:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

The app requests `openid email profile`. Change the audience from testing to production when ready for other customers. [Google web server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server)

## Microsoft

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations** → **New registration**.
2. Choose the supported account type that includes **accounts in any organizational directory and personal Microsoft accounts**. The implementation uses Microsoft's `common` authority.
3. Add a **Web** redirect URI using the Microsoft callback URL above. Do not register it as a single-page application.
4. Copy the **Application (client) ID**.
5. Under **Certificates & secrets**, create a client secret and copy its **Value**, rather than its Secret ID:

```dotenv
MICROSOFT_CLIENT_ID=your-application-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret-value
```

The app uses the authorization code flow with `openid email profile` and PKCE. It does not need Microsoft Graph mail access or a browser implicit-token flow. Microsoft email claims are not treated as verified recovery addresses; the provider's signed identity is the login identifier. [Microsoft registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [Microsoft OIDC guide](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)

## X / Twitter

1. Open [X Developer Console](https://developer.x.com/) and select or create an app.
2. Enable **OAuth 2.0** in the app's user authentication settings.
3. Choose **Web App** (a confidential client), add the Twitter callback URL above, and set the website URL to `https://translate.shiroko.tools`.
4. Copy the OAuth 2.0 **Client ID** and **Client Secret**. OAuth 1.0 API keys or an app-only bearer token are not substitutes:

```dotenv
TWITTER_CLIENT_ID=your-oauth2-client-id
TWITTER_CLIENT_SECRET=your-oauth2-client-secret
```

The app requests `tweet.read users.read` and uses PKCE. It identifies the account through `/2/users/me`; email access is not required. [X OAuth 2.0 guide](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)

## Kakao

1. Open [Kakao Developers](https://developers.kakao.com/) and select or create an app.
2. Open **Kakao Login → Usage settings** (`카카오 로그인 → 사용 설정`) and set its status to **ON**.
3. Open **App → Platform keys → REST API key** (`앱 → 플랫폼 키 → REST API 키`). In that key's **Redirect URI** settings, register `https://translate.shiroko.tools/api/auth/kakao/callback`.
4. On the same REST API key settings page, copy the **REST API key** and enabled **Client secret**. Use the REST API key as `KAKAO_CLIENT_ID`, rather than a JavaScript or admin key. These settings moved to individual platform keys in the [December 2025 dashboard update](https://developers.kakao.com/docs/ko/getting-started/app-key-migration):

```dotenv
KAKAO_CLIENT_ID=your-rest-api-key
KAKAO_CLIENT_SECRET=your-client-secret
```

If desired, enable nickname and email in consent settings. Email is optional for this implementation; the app uses the Kakao user ID from `/v2/user/me`. OpenID Connect does not need to be enabled for this flow. [Kakao REST API guide](https://developers.kakao.com/docs/en/kakaologin/rest-api)

## Confirm setup

After deploying, open the editor and choose **Sign in**. Configured providers have active buttons. Complete one real sign-in per provider to verify the provider dashboard settings, consent screen, and callback URL.

To connect a provider to an existing account, first sign in using the existing method, then select **Sign-in methods → Connect [provider]**. The app never merges accounts based only on a matching email address; this protects saved translations and prepaid credit. A social identity already attached to a different account cannot be reassigned through this flow.

Provider access and refresh tokens are not saved. The server verifies signed ID tokens for Google and Microsoft; X and Kakao identities come from their authenticated profile endpoints. OAuth flows use short-lived, single-use browser-bound state; supported providers also use PKCE. The normal application session remains an HTTP-only cookie.

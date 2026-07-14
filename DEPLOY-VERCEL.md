# Deploy StackForge to Vercel (recommended for a dynamic showcase)

No OCI/OKE needed. Preview URLs and production URL are handled dynamically.

## Steps

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → Add New Project → import the repo.
3. Set Environment Variables (Production + Preview):

```
GEMINI_API_KEY=your-gemini-key
NEXT_PUBLIC_DIAGNOSTIC_URL=https://enlightlabs.com/contact
```

Optional (only if you use a custom domain):

```
NEXT_PUBLIC_APP_URL=https://stackforge.enlightlab.com
ALLOWED_ORIGINS=https://stackforge.enlightlab.com
```

On Vercel, `VERCEL_URL` / production URL are used automatically for CORS.
Preview deployments (`*.vercel.app`) are allowed when running on Vercel.

4. Deploy.
5. Open the Vercel URL → test `/generate`.

## Making it “dynamic” (what we already did)

| Need | How |
|------|-----|
| New Vercel preview every push | Auto — CORS allows `*.vercel.app` on Vercel |
| Chat keeps updating files | Lovable-style `/generate` workspace |
| Cloud/CI choices change output | Preset steps before chat |
| Custom domain later | Set `NEXT_PUBLIC_APP_URL` + `ALLOWED_ORIGINS` |

## Notes

- Do **not** put `GEMINI_API_KEY` in the client; only server env.
- Hobby Vercel is fine for demos; watch Gemini usage/cost.
- Rate limit is in-memory per instance (fine for showcase; not perfect for multi-region).

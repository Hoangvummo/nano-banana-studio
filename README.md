# Nano Banana Studio

BYOK image studio for Gemini image models:

- Nano Banana 2: `gemini-3.1-flash-image-preview`
- Nano Banana Pro: `gemini-3-pro-image-preview`
- Nano Banana: `gemini-2.5-flash-image`

The app does not ship with an API key. Users paste their own key in the API panel and can test model access before generating.

## Local Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Features

- API key input and model access test
- Text-to-image prompt composer
- Model, aspect ratio, image size, and count controls
- Multi-image custom edit references
- Face, outfit, style, and source image references for dedicated workflows
- Gallery, modal preview, and download
- Local-only optional API key save

## Security Notes

This is a client-side BYOK app. API keys entered in the browser are used directly against Google Generative Language API.

- Do not commit keys to GitHub.
- Restrict keys in Google Cloud/API Console.
- Use a backend proxy later if you need server-side key protection, user auth, or usage limits.

## GitHub Setup

```bash
git init
git add .
git commit -m "Initial Nano Banana Studio app"
git branch -M main
git remote add origin https://github.com/<owner>/nano-banana-studio.git
git push -u origin main
```

## Vercel Auto Deploy

1. Create/import the GitHub repo in Vercel.
2. Framework preset: Vite.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. No production API key environment variable is required for the BYOK MVP.

After import, Vercel automatically deploys every push to `main` and creates preview deployments for pull requests.

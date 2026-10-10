# Jev decision API for AI Credit Assess

This small Node.js service keeps the TypeSafe API key off the static website. It sends only numeric financial metrics to the official TypeSafe Jev endpoint; it does not send applicant names, PAN/CIN, contact details, or uploaded PDFs, and it does not store assessment requests.

## 1. Create a TypeSafe API key

Create an API key in the [official TypeSafe console](https://console.typesafe.ai/). Never put this key in `outputs/index.html`, GitHub Pages, a public repository, or this chat. Jev API calls may incur usage charges on the TypeSafe account.

TypeSafe's documented System One endpoint is `POST https://api.typesafe.ai/v1/systemone`. The service uses the typed `choice`, `score`, and `noul` questions described in the [official quick start](https://docs.typesafe.ai/introduction/quickstart).

## 2. Deploy this backend

For a simple Render Web Service deployment:

1. Create a new Web Service from this GitHub repository.
2. Choose **Node** as the runtime and set **Root Directory** to `backend-jev`.
3. Set **Build Command** to `npm install` and **Start Command** to `npm start`.
4. Add these environment variables in the service dashboard:
   - `TYPESAFE_API_KEY` = the secret key from the TypeSafe console.
   - `JEV_MODEL` = `jev-latest` (optional; this is the default).
   - `ALLOWED_ORIGINS` = `https://achalghumre69-lgtm.github.io` (add a comma-separated local development origin only if needed).
5. Wait for the service to become healthy. Its health endpoint is `/api/health` and reports whether the key is configured without revealing it.

The service binds to the hosting provider's `PORT` environment variable. Do not put the secret in frontend configuration.

## 3. Connect the website

Open the live website, paste the deployed backend's base URL into **Optional Jev AI decision signal**, and choose **Connect**. Before an assessment sends figures, check the consent box. Individual assessment sends only the financial inputs from its form. Corporate assessment sends extracted statement figures and ratios; the original PDF and company identifiers are not sent.

The website keeps its local demo estimate if Jev is not connected or a request fails. The Jev recommendation is a project-demo signal with a human-review fallback, not a credit decision, loan offer, or validated lending model.

## API

- `GET /api/health`
- `POST /api/assess` with `{ "applicantType": "individual" | "corporate", "metrics": { ... } }`

The API has no database and intentionally does not log request bodies.


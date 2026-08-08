# SportLife Server - Render Deployment

This is the Render-ready backend for the SportLife fitness app.

## Deploy to Render

1. Create a new public GitHub repository and upload all files in this folder.
2. In the Render Dashboard, click **New +** → **Web Service**.
3. Choose **Build and deploy from a Git repository**, then paste your GitHub repo URL.
4. Render will auto-detect the Node runtime. Use these settings if needed:
   - **Build Command**: `npm install --production`
   - **Start Command**: `node server.js`
   - **Health Check Path**: `/api/courses`
5. Select the **Free** instance type and click **Create Web Service**.
6. Wait for the deploy to finish, then copy the public URL (e.g. `https://sportlife-xxxx.onrender.com`).
7. Send that URL back so the Android app can be rebuilt to point at it.

## Notes

- The app uses an SQLite database. Render's free tier has an **ephemeral filesystem**, so data may reset when the service sleeps or redeploys. For production use, upgrade to a paid plan with a persistent disk or switch to a managed database.

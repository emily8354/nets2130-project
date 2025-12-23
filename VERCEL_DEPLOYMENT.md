# Vercel Deployment Guide

This guide will help you deploy the Kinnect app to Vercel with continuous deployment enabled.

## Prerequisites

- GitHub/GitLab/Bitbucket account
- Vercel account (free tier works)
- Supabase project set up
- Strava API credentials

## Step 1: Push Code to Git Repository

Make sure your code is pushed to a Git repository:

```bash
git add .
git commit -m "Add Vercel deployment configuration"
git push origin main
```

## Step 2: Deploy to Vercel

### Option A: Via Vercel Dashboard (Recommended)

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"New Project"**
3. Import your Git repository
4. Configure the project:
   - **Framework Preset**: Other
   - **Root Directory**: `.` (root)
   - **Build Command**: `cd frontend && npm run build`
   - **Output Directory**: `frontend/dist`
   - **Install Command**: `cd frontend && npm install && cd ../backend && npm install`

5. **Add Environment Variables** (click "Environment Variables"):
   
   **Required Variables:**
   ```
   VITE_API_BASE=https://nets2130.vercel.app
   STRAVA_CLIENT_ID=186057
   STRAVA_CLIENT_SECRET=your_strava_client_secret
   STRAVA_REDIRECT_URI=https://nets2130.vercel.app/api/strava/callback
   ENCRYPTION_KEY=your_64_character_hex_key
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   ```

   **Optional:**
   ```
   PORT=4000 (Vercel sets this automatically, but you can specify)
   ```

6. Click **"Deploy"**

### Option B: Via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy (first time - will ask questions)
vercel

# For production deployment
vercel --prod
```

## Step 3: Update Strava App Settings

After deployment, update your Strava app settings:

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Update **Authorization Callback Domain** to: `nets2130.vercel.app`
3. Update **Redirect URI** to: `https://nets2130.vercel.app/api/strava/callback`

## Step 4: Verify Deployment

1. Visit your deployed URL: `https://nets2130.vercel.app`
2. Test the following:
   - User signup/login
   - Profile creation
   - Activity logging
   - Strava connection
   - Team creation/joining
   - Leaderboards

## Continuous Deployment

Once connected to Git, Vercel automatically:

- ✅ Deploys on every push to `main` branch
- ✅ Creates preview deployments for pull requests
- ✅ Sends notifications on deployment status
- ✅ Provides deployment logs and analytics

### Workflow for Updates

1. Make changes locally
2. Test locally:
   ```bash
   # Terminal 1: Backend
   cd backend
   npm start
   
   # Terminal 2: Frontend
   cd frontend
   npm run dev
   ```
3. Commit and push:
   ```bash
   git add .
   git commit -m "Your update description"
   git push origin main
   ```
4. Vercel automatically builds and deploys (usually 1-2 minutes)
5. Check Vercel dashboard for deployment status

## Environment Variables

### Development (Local)

Create `backend/.env`:
```env
STRAVA_CLIENT_ID=186057
STRAVA_CLIENT_SECRET=your_secret
STRAVA_REDIRECT_URI=http://localhost:4000/api/strava/callback
PORT=4000
ENCRYPTION_KEY=your_key
SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```

Create `frontend/.env.local`:
```env
VITE_API_BASE=http://localhost:4000
```

### Production (Vercel)

Set in Vercel Dashboard → Project Settings → Environment Variables

**Important:** 
- Use different values for Production vs Preview/Development
- Never commit `.env` files to Git
- Update `STRAVA_REDIRECT_URI` to your production URL

## Troubleshooting

### Build Fails

- Check Vercel build logs
- Ensure all dependencies are in `package.json`
- Verify Node.js version (Vercel uses Node 18+ by default)

### API Routes Not Working

- Verify `vercel.json` routes configuration
- Check that backend routes start with `/api/`
- Ensure CORS is configured correctly in `backend/server.js`

### Environment Variables Not Working

- Verify variables are set in Vercel dashboard
- Check variable names match exactly (case-sensitive)
- Redeploy after adding new variables

### CORS Errors

- Ensure `API_BASE` environment variable is set correctly
- Check backend CORS configuration allows your Vercel domain
- Verify frontend is using the correct API URL

## Project Structure

```
project/
├── frontend/          # React + Vite frontend
│   ├── src/
│   │   ├── config/
│   │   │   └── api.js  # API configuration
│   │   └── ...
│   ├── dist/          # Build output (generated)
│   └── package.json
├── backend/           # Express.js backend
│   ├── server.js      # Main server file
│   └── package.json
├── vercel.json        # Vercel configuration
└── .vercelignore      # Files to ignore in deployment
```

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Vercel Serverless Functions](https://vercel.com/docs/concepts/functions)

## Support

If you encounter issues:
1. Check Vercel deployment logs
2. Review browser console for errors
3. Verify all environment variables are set
4. Test API endpoints directly using curl or Postman


// Vercel serverless function wrapper for Express app
// This file handles all /api/* requests via rewrite rules in vercel.json
const app = require('../backend/server.js');

// Export as Vercel serverless function
// The rewrite rule in vercel.json routes /api/* to /api, which this function handles
module.exports = (req, res) => {
  // Vercel preserves the original request path in req.url
  // Express will route based on the path (e.g., /api/profiles/me)
  return app(req, res);
};

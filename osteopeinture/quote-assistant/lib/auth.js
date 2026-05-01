'use strict';
const crypto = require('crypto');

const COOKIE_NAME = 'op_hub_auth';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

function createToken(secret) {
  var timestamp = Date.now().toString();
  var hmac = crypto.createHmac('sha256', secret).update(timestamp).digest('hex');
  return timestamp + '.' + hmac;
}

function verifyToken(token, secret) {
  if (!token || !secret) return false;
  var parts = token.split('.');
  if (parts.length !== 2) return false;
  var timestamp = parts[0];
  var expected = crypto.createHmac('sha256', secret).update(timestamp).digest('hex');
  if (parts[1] !== expected) return false;
  // Check token age (30 days)
  var age = Date.now() - parseInt(timestamp, 10);
  return age < COOKIE_MAX_AGE;
}

function getCookie(req, name) {
  var cookies = req.headers.cookie;
  if (!cookies) return null;
  var match = cookies.split(';').find(function(c) { return c.trim().startsWith(name + '='); });
  return match ? match.trim().slice(name.length + 1) : null;
}

function authMiddleware(req, res, next) {
  var secret = process.env.APP_SECRET;
  var password = process.env.APP_PASSWORD;

  // Skip auth if no password configured (dev mode)
  if (!password) return next();

  // Check cookie
  var token = getCookie(req, COOKIE_NAME);
  if (token && verifyToken(token, secret || password)) {
    return next();
  }

  // Not authenticated
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // For page requests, redirect to login
  return res.redirect('/login');
}

module.exports = { authMiddleware, createToken, verifyToken, getCookie, COOKIE_NAME, COOKIE_MAX_AGE };

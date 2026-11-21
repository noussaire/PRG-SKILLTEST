// HTTP-only Vercel entry. Build dist first. Never import src/server or start jobs
// here: durable scheduling is a separate, explicitly unfinished adaptation.
import express from 'express'; // Explicit Express import for framework entry detection.
import { app } from './dist/app.js';
import { assertProxyConfiguration } from './dist/security/proxy-network.js';

assertProxyConfiguration();
export default app;

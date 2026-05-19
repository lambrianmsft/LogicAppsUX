#!/usr/bin/env node
import { execSync } from 'child_process';

process.env.E2E = 'true';
execSync('vite', { stdio: 'inherit' });

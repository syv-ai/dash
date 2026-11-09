import { app } from 'electron';
import * as path from 'path';
import { userDataDir } from './userDataDir';

// 1. Set app name BEFORE any app.getPath() calls
app.setName('Dash');

// Also before anything reads userData: a dev run gets its own folder, and
// DASH_USER_DATA_DIR another one (userDataDir.ts).
const dataDir = userDataDir(process.env, app.isPackaged, app.getPath('appData'));
if (dataDir) app.setPath('userData', dataDir);

// 2. Install path aliases for main process
// @shared/* → dist/main/shared/*
// @/* → dist/main/main/*
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith('@shared/')) {
    request = request.replace('@shared/', path.join(__dirname, '..', 'shared') + '/');
  } else if (request.startsWith('@/')) {
    request = request.replace('@/', __dirname + '/');
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// 3. Load main process
require('./main');

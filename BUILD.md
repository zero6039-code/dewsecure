# DewSecure Extension Build Guide

This document explains how to build the DewSecure Chrome/Edge/Opera extension from source code.

## Prerequisites
- **Node.js**: v18.x or v20.x
- **npm**: v9.x or higher

## Project Structure
- `extensions/chrome/`: Core source code for all Chromium-based browsers (Chrome, Edge, Opera, Yandex).
- `extensions/chrome/src/`: Service worker, content scripts, and AI model manager.
- `extensions/chrome/popup/`: Side Panel / Popup UI.
- `extensions/chrome/dist/`: The output directory (generated after build).

## Build Instructions

1. **Install Dependencies**
   Navigate to the extension directory and install the required npm packages:
   ```bash
   cd extensions/chrome
   npm install
Build the Extension
Run the build script. This will bundle the JS files using esbuild, copy static assets (rules, locales, wasm), and apply code obfuscation.

bash
npm run build
(Note: The output will be generated in the dist/ directory.)

Package for Store Submission
To create a zip file for Chrome Web Store, Edge Add-ons, or Opera Add-ons:

bash
cd dist
zip -r ../../releases/chrome/DewSecure-vX.X.X.zip . -x "_metadata/*" -x "*.bak*" -x "*.map" -x "*.md"
Code Obfuscation Policy
We use javascript-obfuscator during the build process. This is strictly for protecting our proprietary subscription verification logic and AI model weights from reverse engineering.
The core ad-blocking and privacy protection engine is fully transparent. Our rulesets are standard EasyList/EasyPrivacy formats.

Remote Code Clarification
The extension does not execute remote code. It fetches .onnx files (AI model weights) from our Cloudflare R2 bucket for local on-device inference via ONNX Runtime Web. These are static data files, not JavaScript.

Contact
For any security or compliance inquiries, please contact: dewsecure9@gmail.com

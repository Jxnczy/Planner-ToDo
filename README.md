<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1vDISm7PMup_nvmuRkhDMGS90VbIN5hu9

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Use it like a Windows desktop tool

The planner runs entirely in the browser, so you can package it like a lightweight desktop utility on Windows:

1. Build the production bundle with `npm run build`.
2. Serve the compiled `dist/` folder locally (for example with `npx serve dist/weekly-planner-&-to-do-list`).
3. Open the served URL in Microsoft Edge or Chrome and use the browser's **Install app** option to pin it like a native tool.
4. Use the new **Data & Desktop Tools** controls in the sidebar to export your schedule as a `.json` file, sync it to another machine, and import it back when needed.

# Publish SXL Cover to GitHub

This repository is source code for SXL Cover. It does not contain Laragon binaries or a built installer. Keep private environment files, passwords, local database files, logs, and build output out of Git.

## 1. Create an empty GitHub repository

1. Sign in to GitHub and choose **New repository**.
2. Repository name suggestion: `sxl-cover`.
3. Choose **Private** first if you are still testing or do not want to publish the source yet. You can change visibility later.
4. Do not initialize it with a README, `.gitignore`, or license because those are already in this source folder.
5. Copy the HTTPS repository URL, e.g. `https://github.com/YOUR-USERNAME/sxl-cover.git`.

## 2. Initialize and push from PowerShell

Open PowerShell in the extracted SXL Cover folder (the folder containing `package.json`) and run:

```powershell
git init -b main
git add .
git status --short
```

Review the status before committing. Confirm there are no `.env` files, secrets, local database files, logs, or build artifacts staged. Then:

```powershell
git commit -m "Initial release: SXL Cover v1.0.0"
git remote add origin https://github.com/YOUR-USERNAME/sxl-cover.git
git push -u origin main
```

Replace the remote URL with the HTTPS URL of the repository you created. Authenticate using Git Credential Manager or GitHub CLI when prompted. Do not put a Personal Access Token directly into the remote URL or commit it to a file.

If Git says `Author identity unknown`, set your commit identity:

```powershell
git config --global user.name "Your Name"
git config --global user.email "YOUR-VERIFIED-EMAIL"
```

Then retry the commit and push.

## 3. For future updates

After editing and testing the app:

```powershell
npm run check
git status --short
git add .
git commit -m "Describe your change"
git push
```

## 4. Important notes

- `.gitignore` excludes `node_modules`, `out`, built EXE/MSI packages, logs, `.env`, private keys, and local database files.
- Do not commit passwords, production credentials, exported diagnostics without review, or files copied from a live Laragon data directory.
- `git status --short` is a review step; it does not upload anything.
- This guide does not create or push to GitHub automatically. You must create the repository and authenticate on your PC, unless you have connected a GitHub integration that can access the target repository.

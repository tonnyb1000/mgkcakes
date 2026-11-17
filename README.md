# mgkcakes — Cake Order Tracker (Staff Desk)

A mobile-friendly internal web application for a cake shop team to record and track customer cake orders in Ugandan shillings (UGX), built with **React + TypeScript + Vite** for **Firebase Authentication**, **Cloud Firestore**, and **Firebase Hosting**.

> **Scope:** Order entry, order tracking, payment balance updates, pickup status management, and owner-only 12-month CSV archiving. Does not include images, expense tracking, inventory, online checkout, or a customer-facing portal.

---

## Security & Setup Behaviour

- **No Demo Mode / No Sample Data:** All demo accounts, sample orders, and demo mode have been removed.
- **Unconfigured Access Blocked:** If Firebase environment variables (`VITE_FIREBASE_*`) are not configured, the app displays a **Firebase Setup Required** screen and blocks access to all order and customer features.
- **Staff-Only Access:** Public self-registration is disabled. Staff must sign in with Email & Password and have an active document in `/staffUsers/{uid}`.
- **Server-Side Rules:** `firestore.rules` enforces authentication, active staff membership, UGX amount validation, immutable audit fields, and owner-only deletion of archived orders.

---

## Local Development & Testing

### Prerequisites
- Node.js 20+ and npm
- Java 11+ and `firebase-tools` (for running the Firestore Emulator rules tests)

### Install, Test & Build
```bash
npm install
npm test
npm run build
```

### Run Firestore Security Rules Tests (Firebase Emulator)
```bash
firebase emulators:exec --only firestore "npm run test:rules"
```
*(On Windows PowerShell if `.ps1` scripts are restricted, use `npm.cmd` and `firebase.cmd`.)*

---

## Firebase Setup

1. **Create a Firebase Project** in the [Firebase Console](https://console.firebase.google.com/).
2. **Enable Authentication:**
   - Go to **Authentication -> Sign-in method -> Email/Password** and enable it.
   - Do **not** add a public Sign Up flow; staff accounts are created by the owner.
3. **Create Cloud Firestore:**
   - Go to **Firestore Database -> Create database** (choose a region close to Uganda, e.g. `europe-west1` or `africa-south1`).
4. **Configure Environment Variables:**
   - Copy `.env.example` to `.env.local`.
   - Fill in your Firebase Web App config (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`).
   - Never commit `.env.local` to GitHub.
5. **Deploy Security Rules & Indexes:**
   ```bash
   firebase login
   firebase use --add   # select your Firebase project
   firebase deploy --only firestore:rules,firestore:indexes
   ```
6. **Build & Deploy Hosting (when ready):**
   ```bash
   npm run build
   firebase deploy --only hosting
   ```

---

## How the Shop Owner Adds Staff Accounts

1. In **Firebase Console -> Authentication -> Users**, click **Add user** and enter the staff member's email and a temporary password.
2. Copy the new user's **User UID**.
3. In **Firestore Database -> Data**, create a document in the `staffUsers` collection with **Document ID = `<User UID>`** and fields:
   - `email` (string): staff member's email
   - `displayName` (string): staff member's name
   - `role` (string): `"staff"` (or `"owner"` for the shop owner)
   - `active` (boolean): `true`
4. To revoke access later, set `active` to `false` (or delete their `staffUsers/{uid}` document and disable their Auth account).

---

## GitHub Readiness Checklist

- `.gitignore` excludes `node_modules`, `dist`, `.env`, `.env.local`, `.env.*.local`, `.firebase`, and debug logs.
- No real Firebase credentials, service accounts, or real customer data are in the repository.
- Run `npm test`, `npm run build`, and `firebase emulators:exec --only firestore "npm run test:rules"` before pushing or deploying.

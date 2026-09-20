# HOH Ticket Portal — Admin-Only Event Management System

A high-performance, single-operator ticketing and entry management portal built specifically for the **House of Humour (HOH)** event.

---

## 1. Architecture Overview

The system strictly operates on a 3-tier architecture with **MongoDB Atlas** as the sole source of truth. All legacy Google Sheets, Google Apps Script, and multi-role RBAC layers have been completely eliminated.

```text
React Admin Panel (Vite + TypeScript + Tailwind)
        ↓  (JWT Bearer Token / HTTPS)
Express REST API (Node.js + Mongoose)
        ↓  (Mongoose Driver)
MongoDB Atlas (Cloud Database)
```

### Core Collections
* **`admins`**: Secure credentials for the event administrator (bcrypt password hashing).
* **`tickets`**: Fixed inventory of 50 tickets (`HOH001` through `HOH050`).
* **`bookings`**: Customer purchase records with assigned ticket codes.
* **`counters`**: Atomic sequence generator ensuring unique, collision-proof booking codes (`HOH-BOOK-000001`).

---

## 2. Key Features

* **Admin-Only Access**: Zero multi-role complexity (`sales`, `entry`, `manager`, and staff passkeys removed). Only authenticated administrators have access.
* **Fixed 50-Ticket Inventory**: Strictly manages tickets `HOH001` to `HOH050`. Tickets are never deleted or recreated dynamically.
* **Smart Consecutive Allocation**: Multi-seat bookings automatically allocate consecutive available ticket numbers (e.g., `HOH011`, `HOH012`, `HOH013`).
* **1-Click Manual Entry Control**:
  * `[ MARK AS ENTERED ]` instantly updates `entered = true` and records `enteredAt`.
  * `[ MARK AS NOT ENTERED ]` instantly reverts `entered = false` and clears `enteredAt`.
  * **No secondary verification required** (no OTPs, no passkeys, no approval popups).
* **QR Generation & Live Scanning**: Fast ticket lookup via mobile camera or webcam utilizing `html5-qrcode`.
* **Instant Ticket Search & Filtering**: Filter across ticket codes, customer names, phone numbers, and entry status.
* **Booking & Customer Management**:
  * Register single or multiple tickets with customer details.
  * Edit customer name, phone, email, and payment status.
  * Clear ticket assignment to return it to `available` without deleting the ticket document.
* **Deliberate Event Reset**: Reset all bookings and return all 50 tickets to `available` state while preserving admin credentials.

---

## 3. Environment Configuration

Create a `.env` file in the project root with the following required variables:

```env
# Server Configuration
PORT=5000
NODE_ENV=production

# Security & Secrets (Must be set, no fallback defaults)
JWT_SECRET=your-secure-random-jwt-secret-key
ADMIN_EMAIL=admin@houseofhumour.com
ADMIN_PASSWORD=your-secure-admin-password

# Database (MongoDB Atlas)
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/hoh_tickets_db?retryWrites=true&w=majority

# CORS Allowed Origin
FRONTEND_URL=https://your-admin-domain.com
```

> **Note**: For local development, `FRONTEND_URL` can be set to `http://localhost:5173`. Production startup will fail immediately if `MONGODB_URI` or `JWT_SECRET` is missing.

---

## 4. Getting Started

### Prerequisites
* Node.js v18+ installed
* MongoDB Atlas cluster or local MongoDB instance

### Installation
```bash
# Clone the repository
git clone https://github.com/Tushar1623/HoH-Ticket-portal.git
cd HoH-Ticket-portal

# Install dependencies
npm install
```

### Database Initialization & Migration
To prepare a clean database with exactly 50 available tickets (`HOH001`–`HOH050`), initialize the atomic booking counter, and create the initial admin account:

```bash
npm run db:prepare
```

> **Safe Startup**: When the Express server boots (`npm run server`), it runs an idempotent check that only inserts missing tickets between 1 and 50. It **NEVER** deletes existing tickets or bookings on startup.

### Development Mode
Run the backend server and frontend development server concurrently:

```bash
# Terminal 1: Backend Express Server (Port 5000)
npm run server

# Terminal 2: Frontend Vite Server (Port 5173)
npm run dev
```

### Production Build & Test
```bash
# Run unit & integration tests
npm test

# Build production client bundle
npm run build
```

---

## 5. API Reference

All management endpoints require an `Authorization: Bearer <token>` header obtained from `/api/auth/login`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Authenticate admin (`email/username` + `password`) |
| `GET` | `/api/auth/me` | Fetch active admin session profile |
| `GET` | `/api/dashboard` | Live statistics (`total`, `registered`, `available`, `entered`, `notEntered`) |
| `GET` | `/api/tickets` | List all 50 tickets with current status and buyer info |
| `GET` | `/api/tickets/:code` | Fetch individual ticket details |
| `POST` | `/api/bookings` | Register tickets with consecutive allocation |
| `PUT` | `/api/tickets/:code` | Update ticket customer details & payment status |
| `PUT` | `/api/tickets/:code/entry` | Mark ticket as entered (`entered: true`, timestamped) |
| `PUT` | `/api/tickets/:code/not-entry` | Undo entry status (`entered: false`, resets timestamp) |
| `DELETE` | `/api/tickets/:code/booking` | Clear ticket allocation (resets ticket to `available`) |
| `POST` | `/api/event/reset` | Complete event reset (clears bookings, preserves 50 tickets and admin) |

---

## 6. Security Standards

1. **Zero Client Leakage**: Secrets such as `MONGODB_URI`, `JWT_SECRET`, and password hashes are never exposed to Vite or sent across the API.
2. **Production Database Integrity**: If MongoDB Atlas goes offline, the API returns HTTP 503 `DATABASE_UNAVAILABLE` rather than silently falling back to an in-memory database.
3. **No LocalStorage DB**: Browser `localStorage` only stores harmless UI preferences and the temporary admin session token. Ticket state is always fetched authoritatively from MongoDB.

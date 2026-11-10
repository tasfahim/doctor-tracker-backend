# Doctor Tracker – Backend

The backend API for **Doctor Tracker**, a web-based doctor and patient management system. It provides authentication, data management, and RESTful API services to support the frontend application.

Built with Express.js, TypeScript, and MongoDB, the backend handles application logic, database operations, request validation, and API security.

## Features

- **Authentication** – JWT-based authentication for administrative access.
- **Doctor Management** – Create, retrieve, update, and manage doctor records.
- **Patient Management** – Create, retrieve, update, and manage patient records.
- **Doctor–Patient Association** – Manage relationships between doctors and patients.
- **Input Validation** – Validate incoming requests and prevent invalid data from being processed.
- **Search and Filtering** – Support searching and filtering management records.
- **Pagination** – Support paginated API responses where applicable.
- **Error Handling** – Centralized error-handling middleware for consistent API responses.
- **Database Reliability** – MongoDB connection management and startup checks.
- **Health Check** – API health endpoint for service monitoring.
- **Security Middleware** – Helmet, CORS configuration, request-size limits, and rate limiting.
- **Deletion Protection** – Prevent deletion of doctors who still have assigned patients.

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js | Backend framework |
| TypeScript | Type-safe development |
| MongoDB Atlas | Cloud database |
| Mongoose | MongoDB object modeling |
| JSON Web Token (JWT) | Authentication |
| Helmet | HTTP security headers |
| CORS | Cross-origin request control |
| bcrypt | Password hashing |
| Cookie Parser | Cookie handling |

## Project Structure

```text
doctor-tracker-backend/
│
├── src/
│   ├── config/
│   │   └── database.ts
│   │
│   ├── models/
│   │   ├── Doctor.ts
│   │   ├── Patient.ts
│   │   └── User.ts
│   │
│   ├── routes/
│   │   └── api.routes.ts
│   │
│   ├── app.ts
│   └── server.ts
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Prerequisites

Before running the backend, make sure you have:

- Node.js (LTS version recommended)
- npm
- Git
- A MongoDB database (MongoDB Atlas or a local MongoDB instance)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/tasfahim/doctor-tracker-backend.git
```

### 2. Navigate to the project directory

```bash
cd doctor-tracker-backend
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env` file in the project root using `.env.example` as a reference.

Required environment variables:

| Variable | Description |
|---|---|
| `PORT` | Port used by the backend server |
| `NODE_ENV` | Application environment |
| `CLIENT_URL` | Allowed frontend origin for CORS |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used for JWT signing and verification |

Example configuration:

```env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:3000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_secure_random_secret
```

Replace the placeholder values with your own configuration. Never commit `.env` or expose database credentials or JWT secrets.

### 5. Run the development server

Use the development command configured in `package.json`.

The local API is available at:

```text
http://localhost:5000
```

## API Health Check

The backend provides a health-check endpoint:

```http
GET /api/health
```

Local URL:

```text
http://localhost:5000/api/health
```

This endpoint can be used to verify that the API service is running.

## API Functionality

The backend exposes RESTful API functionality for:

| Module | Operations |
|---|---|
| Authentication | Administrative login and authentication |
| Doctors | Create, retrieve, update, and delete |
| Patients | Create, retrieve, update, and delete |
| Associations | Manage doctor–patient relationships |
| Health | Check API service status |

All management operations are handled through the backend API. Protected operations require valid authentication.

## Security and Reliability

The backend includes several security and reliability measures:

- JWT-based authentication.
- Password hashing.
- Helmet security middleware.
- Configurable CORS origin restrictions.
- Global rate limiting.
- JSON request body size restriction.
- Request validation and error handling.
- Escaped search expressions to reduce regex injection risks.
- MongoDB connection checks before server startup.
- Protection against deleting doctors with assigned patients.

## Frontend Integration

The backend serves the Doctor Tracker frontend application.

**Frontend Repository:**  
https://github.com/tasfahim/doctor-tracker-frontend

**Backend Repository:**  
https://github.com/tasfahim/doctor-tracker-backend

For local development, configure the frontend API base URL to point to:

```text
http://localhost:5000
```

## Deployment

The backend is designed to be deployable as a Node.js web service.

Production deployment requires the following environment variables to be configured in the hosting platform:

- `NODE_ENV`
- `CLIENT_URL`
- `MONGODB_URI`
- `JWT_SECRET`

The hosting platform should provide the port through its environment configuration where applicable.

Do not store production secrets in the source code or commit them to GitHub.

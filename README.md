# Server Commerce AI

This is the Commerce AI server application.

## 1. Installation

1. Open your terminal in the project directory.
2. Install the dependencies:
   ```bash
   npm install
   ```

## 2. Configuration

1. Create a `.env` file in the root directory (if it doesn't exist).
2. Add your Database URL and Port:
   ```env
   DATABASE_URL=postgres://user:password@host:port/database_name
   PORT=3000
   NODE_ENV=development
   ```

## 3. Running the Server

Start the server using the command:
```bash
npm start
```
The server should start on `http://localhost:3000` (or your configured PORT).

## 4. Database Sync

To synchronize the database schema:
```bash
npm run db:sync
```

**Note:** This will drop and recreate all tables. Use with caution in production.

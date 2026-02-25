# Bookkeeping Client

React frontend for the Bookkeeping App, built with Vite.

## Features

- **Dashboard**: View summary of income, expense, and balance with recent transactions
- **Transactions**: Add, edit, delete, and filter transactions by date and category
- **Categories**: Manage income and expense categories
- **Real-time Updates**: Changes reflect immediately across the application

## Setup

1. Install dependencies:
```bash
npm install
```

2. Make sure the backend API is running on `http://localhost:8000`

3. Start the development server:
```bash
npm run dev
```

The app will open at `http://localhost:5173`

## Build for Production

```bash
npm run build
```

This creates an optimized production build in the `dist` folder.

## Preview Production Build

```bash
npm run preview
```

## Technology Stack

- **React 18** - UI library
- **Vite** - Next generation frontend tooling
  - Lightning-fast HMR (Hot Module Replacement)
  - Instant server start
  - Optimized builds
- **React Router** - Client-side routing
- **Axios** - Promise-based HTTP client
- **CSS** - Custom styling

## Project Structure

```
src/
├── components/
│   ├── Dashboard.jsx      # Dashboard with summary cards
│   ├── Transactions.jsx   # Transaction management
│   └── Categories.jsx     # Category management
├── App.jsx                # Main app with routing
├── App.css                # Application styles
├── api.js                 # API service layer
├── index.css              # Global styles
└── main.jsx               # Entry point
```

## API Integration

The app connects to the backend API at `http://localhost:8000/api/v1`. All API calls are centralized in `src/api.js` for easy maintenance.

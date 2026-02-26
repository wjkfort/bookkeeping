# Bookkeeping Client

React frontend for the Bookkeeping App, built with Vite and TypeScript.

## Features

- **Dashboard**: View summary of income, expense, and balance with recent transactions
- **Transactions**: Add, edit, delete, and filter transactions by date and category
- **Categories**: Manage hierarchical income and expense categories with parent-child relationships
- **Internationalization**: Support for English and Chinese languages
- **Currency Conversion**: Automatic currency conversion with real-time exchange rates
- **Real-time Updates**: Changes reflect immediately across the application
- **Professional UI**: Built with Ant Design for enterprise-grade user experience

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

- **React 19** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Next generation frontend tooling
  - Lightning-fast HMR (Hot Module Replacement)
  - Instant server start
  - Optimized builds
- **Ant Design** - Enterprise-grade UI component library
  - Professional design system
  - Comprehensive component set
  - Built-in internationalization
- **React Router** - Client-side routing
- **Axios** - Promise-based HTTP client
- **i18next** - Internationalization framework
- **dayjs** - Date manipulation library

## Project Structure

```
src/
├── components/
│   ├── Dashboard.tsx          # Dashboard with summary statistics
│   ├── Transactions.tsx       # Transaction management with filters
│   ├── Categories.tsx         # Hierarchical category management
│   └── LanguageSwitcher.tsx   # Language toggle component
├── hooks/
│   └── useCurrency.ts         # Currency conversion hook
├── locales/
│   ├── en.json                # English translations
│   └── zh.json                # Chinese translations
├── types/
│   └── index.ts               # TypeScript type definitions
├── App.tsx                    # Main app with routing and layout
├── api.ts                     # API service layer
├── i18n.ts                    # i18n configuration
└── main.tsx                   # Entry point
```

## API Integration

The app connects to the backend API at `http://localhost:8000/api/v1`. All API calls are centralized in `src/api.ts` with full TypeScript type safety.

## Features in Detail

### Dashboard
- Summary cards showing total income, expense, and balance
- Recent transactions table
- Automatic currency conversion based on selected language

### Transactions
- Add/edit/delete transactions with modal forms
- Filter by category, date range
- Sortable table columns
- Currency display with conversion rates

### Categories
- Create hierarchical categories (parent-child relationships)
- Separate income and expense categories
- Visual indentation for subcategories
- Cascade delete for parent categories

### Internationalization
- English and Chinese language support
- Automatic currency switching (USD for English, CNY for Chinese)
- All UI text translated
- Ant Design locale integration

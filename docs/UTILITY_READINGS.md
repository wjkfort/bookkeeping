# Utility Readings Management

Track monthly utility meter readings and expenses for water, electricity, gas, internet, and more.

## Overview

The Utility Readings Management feature allows users to:
- Track monthly meter readings for multiple addresses
- Define custom utility types with icons
- Calculate monthly expenses based on meter readings
- Integrate with transaction categories to track recharges/payments

## Database Schema

### utility_addresses
Stores addresses/locations for utility tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| user_id | INTEGER | Foreign key to users |
| name | TEXT | Address name (e.g., "Home", "Office") |
| address | TEXT | Full address |
| created_at | TEXT | Timestamp |

### utility_types
User-defined utility categories (extends beyond just water/electricity).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| user_id | INTEGER | Foreign key to users |
| name | TEXT | Type name (e.g., "Water", "Internet") |
| icon | TEXT | Icon identifier (e.g., "water", "electricity", "wifi") |
| category_id | INTEGER | Optional link to expense category for recharge tracking |
| created_at | TEXT | Timestamp |

**Available Icons:**
- `water` 💧 - Water supply
- `electricity` ⚡ - Electricity
- `gas` 🔥 - Gas
- `internet` 🌐 - Internet (globe)
- `wifi` 📡 - WiFi/Satellite
- `drinking-water` 🚰 - Drinking/Purified water
- `waste` 🗑️ - Waste management
- `tv` 📺 - TV/Cable
- `rent` 🏠 - Rent

### utility_readings
Monthly meter readings.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| user_id | INTEGER | Foreign key to users |
| address_id | INTEGER | Foreign key to utility_addresses |
| type_id | INTEGER | Foreign key to utility_types |
| balance | REAL | Meter reading value |
| record_time | TEXT | YYYY-MM format |
| currency | TEXT | Currency code (CNY/USD) |
| created_at | TEXT | Timestamp |

**Constraint:** Unique per (address_id, type_id, record_time)

## API Endpoints

### Utility Addresses
```
GET    /api/v1/utility-addresses      - List all addresses
GET    /api/v1/utility-addresses/:id   - Get single address
POST   /api/v1/utility-addresses      - Create address
PUT    /api/v1/utility-addresses/:id  - Update address
DELETE /api/v1/utility-addresses/:id - Delete address
```

### Utility Types
```
GET    /api/v1/utility-types          - List all types
GET    /api/v1/utility-types/:id      - Get single type
POST   /api/v1/utility-types          - Create type
PUT    /api/v1/utility-types/:id      - Update type
DELETE /api/v1/utility-types/:id      - Delete type
```

### Utility Readings
```
GET    /api/v1/utility-readings           - List all readings
GET    /api/v1/utility-readings/summary   - Get summary with expense calculation
GET    /api/v1/utility-readings/:id      - Get single reading
POST   /api/v1/utility-readings           - Create reading
PUT    /api/v1/utility-readings/:id       - Update reading (balance/currency)
DELETE /api/v1/utility-readings/:id       - Delete reading
```

## Expense Calculation

The summary endpoint calculates monthly expenses:

```
lastMonthExpense = lastMonthBalance + recharges - currentMonthBalance
```

Where `recharges` are transactions in the bound category during the last month.

Example:
- Last month meter: 1000
- Last month recharges (payments): +200
- Current month meter: 1150
- **Last month expense: 50** (1000 + 200 - 1150)

## Frontend Components

### Dashboard Widget
Located in `client/src/components/features/Dashboard.tsx`

Displays animated utility icons on the dashboard:
- Water droplet with wave animation
- Electricity bolt with highlight
- Drinking water bottle
- WiFi/Satellite dish with pulsing signals

Features:
- Click to see popover with last month expense
- Shows recharge amounts if applicable
- Breathing animation for visual appeal

### Management Pages
- `UtilityAddresses.tsx` - Manage addresses
- `UtilityTypes.tsx` - Manage utility types with icon selection and category binding
- `UtilityReadings.tsx` - Record and view monthly readings

## Usage Flow

1. **Create Address** - Add locations (e.g., "Home", "Office 1")
2. **Create Utility Types** - Define types and optionally bind to expense categories
3. **Record Readings** - Enter monthly meter readings
4. **View Dashboard** - See animated icons with expense summaries
5. **Track Recharges** - Payments recorded as transactions in bound category

## Example Setup

```javascript
// 1. Create address
POST /api/v1/utility-addresses
{ "name": "Home", "address": "123 Main St" }

// 2. Create utility type with category binding
POST /api/v1/utility-types
{ "name": "Water", "icon": "water", "category_id": 5 }

// 3. Record reading
POST /api/v1/utility-readings
{ "address_id": 1, "type_id": 1, "balance": 1050, "record_time": "2026-04", "currency": "CNY" }

// 4. Get summary
GET /api/v1/utility-readings/summary
```

## Database Migrations

- `schema.sql` - Complete schema (utility_addresses, utility_types, utility_readings)
- `add_utility_types_table.sql` - Create utility_types (requires categories)
- `refactor_utility_readings_type.sql` - Migrate to type_id foreign key

## File Structure

```
backend-ts/
├── src/
│   ├── api/
│   │   ├── utility-addresses.ts   # Address CRUD
│   │   ├── utility-types.ts       # Type CRUD
│   │   └── utility-readings.ts    # Readings + Summary
│   └── types/
│       └── index.ts               # TypeScript interfaces

client/src/
├── components/features/
│   ├── Dashboard.tsx              # Dashboard widget
│   ├── UtilityReadings.tsx         # Readings management
│   └── UtilityTypes.tsx           # Type management
└── types/
    └── index.ts                   # TypeScript interfaces
```

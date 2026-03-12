/**
 * Design System Tokens
 * 
 * Philosophy: Warm, approachable, memorable
 * Audience: Personal users tracking household expenses
 * Tone: Friendly helper that makes finance feel human
 */

// Color Palette - Refined, sophisticated tones (reduced saturation)
export const colors = {
  // Primary - Softer terracotta/coral (more refined)
  primary: {
    50: '#fff5f2',
    100: '#ffe8e0',
    200: '#ffd4c7',
    300: '#ffb8a3',
    400: '#ff9370',
    500: '#f4623d', // Reduced from #ff6b3d
    600: '#e04e1f',
    700: '#c13a0f',
    800: '#982f0c',
    900: '#7a2a0f',
  },
  
  // Secondary - Softer amber
  secondary: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#e89b0b', // Reduced from #f59e0b
    600: '#c97706',
    700: '#a45309',
    800: '#82400e',
    900: '#68350f',
  },
  
  // Accent - Softer teal
  accent: {
    50: '#f0fdfa',
    100: '#ccfbf1',
    200: '#99f6e4',
    300: '#5eead4',
    400: '#2dd4bf',
    500: '#12a896', // Reduced from #14b8a6
    600: '#0d8478',
    700: '#0f6e66',
    800: '#115e59',
    900: '#134e4a',
  },
  
  // Income - Softer green
  income: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#20b55a', // Reduced from #22c55e
    600: '#16934a',
    700: '#15703d',
    800: '#166534',
    900: '#14532d',
  },
  
  // Expense - Softer rose
  expense: {
    50: '#fff1f2',
    100: '#ffe4e6',
    200: '#fecdd3',
    300: '#fda4af',
    400: '#fb7185',
    500: '#e63f5a', // Reduced from #f43f5e
    600: '#d11d48',
    700: '#ae123c',
    800: '#8f1239',
    900: '#781337',
  },
  
  // Neutrals - Warm tinted (not pure gray)
  neutral: {
    50: '#fafaf9',
    100: '#f5f5f4',
    200: '#e7e5e4',
    300: '#d6d3d1',
    400: '#a8a29e',
    500: '#78716c',
    600: '#57534e',
    700: '#44403c',
    800: '#292524',
    900: '#1c1917',
  },
  
  // Semantic colors (softer)
  success: '#20b55a',
  warning: '#e89b0b',
  error: '#e63f5a',
  info: '#12a896',
  
  // Background
  background: {
    primary: '#fffaf8', // Warm white
    secondary: '#f5f5f4',
    tertiary: '#ffffff',
  },
};

// Typography - Distinctive and warm
export const typography = {
  fonts: {
    // Display font - Outfit (geometric, friendly, modern)
    display: '"Outfit", system-ui, -apple-system, sans-serif',
    // Body font - Inter (readable, professional)
    body: '"Inter", system-ui, -apple-system, sans-serif',
    // Mono font - JetBrains Mono (for numbers/amounts)
    mono: '"JetBrains Mono", "SF Mono", Consolas, monospace',
  },
  
  // Modular scale (1.25 ratio)
  sizes: {
    xs: '0.64rem',    // 10.24px
    sm: '0.8rem',     // 12.8px
    base: '1rem',     // 16px
    lg: '1.25rem',    // 20px
    xl: '1.563rem',   // 25px
    '2xl': '1.953rem', // 31.25px
    '3xl': '2.441rem', // 39px
    '4xl': '3.052rem', // 48.8px
    '5xl': '3.815rem', // 61px
  },
  
  weights: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
  },
  
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.7,
  },
};

// Spacing scale (8px base)
export const spacing = {
  0: '0',
  1: '0.25rem',  // 4px
  2: '0.5rem',   // 8px
  3: '0.75rem',  // 12px
  4: '1rem',     // 16px
  5: '1.25rem',  // 20px
  6: '1.5rem',   // 24px
  8: '2rem',     // 32px
  10: '2.5rem',  // 40px
  12: '3rem',    // 48px
  16: '4rem',    // 64px
  20: '5rem',    // 80px
  24: '6rem',    // 96px
};

// Border radius
export const radius = {
  none: '0',
  sm: '0.25rem',   // 4px
  base: '0.5rem',  // 8px
  md: '0.75rem',   // 12px
  lg: '1rem',      // 16px
  xl: '1.5rem',    // 24px
  '2xl': '2rem',   // 32px
  full: '9999px',
};

// Shadows - Soft and warm
export const shadows = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
};

// Animation
export const animation = {
  duration: {
    fast: '150ms',
    base: '200ms',
    slow: '300ms',
    slower: '500ms',
  },
  easing: {
    // Natural deceleration
    out: 'cubic-bezier(0.16, 1, 0.3, 1)', // ease-out-expo
    in: 'cubic-bezier(0.87, 0, 0.13, 1)',  // ease-in-expo
    inOut: 'cubic-bezier(0.87, 0, 0.13, 1)', // ease-in-out-expo
  },
};

// Breakpoints
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
};

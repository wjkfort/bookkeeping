/**
 * Ant Design Theme Configuration
 * Customizes Ant Design to match our warm, approachable design system
 */

import { ThemeConfig } from 'antd';
import { colors, typography, radius, shadows } from './tokens';

export const antdTheme: ThemeConfig = {
  token: {
    // Color tokens - softer, refined
    colorPrimary: colors.primary[500],
    colorSuccess: colors.income[500],
    colorWarning: colors.secondary[500],
    colorError: colors.expense[500],
    colorInfo: colors.accent[500],
    
    // Background
    colorBgBase: colors.background.tertiary,
    colorBgContainer: colors.background.tertiary,
    colorBgElevated: colors.background.tertiary,
    colorBgLayout: colors.background.primary,
    
    // Border
    colorBorder: colors.neutral[200],
    colorBorderSecondary: colors.neutral[100],
    
    // Text
    colorText: colors.neutral[800],
    colorTextSecondary: colors.neutral[600],
    colorTextTertiary: colors.neutral[500],
    colorTextQuaternary: colors.neutral[400],
    
    // Typography
    fontFamily: typography.fonts.body,
    fontSize: 16,
    fontSizeHeading1: 48,
    fontSizeHeading2: 39,
    fontSizeHeading3: 31,
    fontSizeHeading4: 25,
    fontSizeHeading5: 20,
    
    // Border radius - softer, more friendly
    borderRadius: 12,
    borderRadiusLG: 16,
    borderRadiusSM: 8,
    borderRadiusXS: 6,
    
    // Spacing
    padding: 16,
    paddingLG: 24,
    paddingSM: 12,
    paddingXS: 8,
    paddingXXS: 4,
    
    margin: 16,
    marginLG: 24,
    marginSM: 12,
    marginXS: 8,
    marginXXS: 4,
    
    // Line height
    lineHeight: 1.6,
    lineHeightHeading: 1.3,
    
    // Control heights
    controlHeight: 44, // Better touch targets
    controlHeightLG: 52,
    controlHeightSM: 36,
    
    // Shadows - softer
    boxShadow: shadows.base,
    boxShadowSecondary: shadows.sm,
    
    // Motion
    motionDurationFast: '0.15s',
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.3s',
    motionEaseInOut: 'cubic-bezier(0.87, 0, 0.13, 1)',
    motionEaseOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
    
    // Link
    colorLink: colors.primary[500],
    colorLinkHover: colors.primary[600],
    colorLinkActive: colors.primary[700],
  },
  
  components: {
    // Button - More personality
    Button: {
      borderRadius: 12,
      controlHeight: 44,
      controlHeightLG: 52,
      controlHeightSM: 36,
      fontWeight: 600,
      primaryShadow: 'none',
      defaultShadow: 'none',
    },
    
    // Card - Less prominent, more breathing room
    Card: {
      borderRadiusLG: 16,
      paddingLG: 24,
      boxShadowTertiary: shadows.sm,
    },
    
    // Input - Larger, friendlier
    Input: {
      borderRadius: 12,
      controlHeight: 44,
      controlHeightLG: 52,
      paddingBlock: 12,
      paddingInline: 16,
    },
    
    // Select
    Select: {
      borderRadius: 12,
      controlHeight: 44,
      controlHeightLG: 52,
    },
    
    // Table - Cleaner
    Table: {
      borderRadius: 12,
      headerBg: colors.background.secondary,
      headerColor: colors.neutral[700],
      headerSplitColor: 'transparent',
      rowHoverBg: colors.primary[50],
    },
    
    // Modal - Less intrusive
    Modal: {
      borderRadiusLG: 20,
      paddingContentHorizontalLG: 32,
      paddingMD: 24,
    },
    
    // Drawer
    Drawer: {
      paddingLG: 24,
    },
    
    // Statistic - More prominent
    Statistic: {
      titleFontSize: 14,
      contentFontSize: 32,
    },
    
    // Menu
    Menu: {
      itemBorderRadius: 8,
      itemMarginInline: 4,
    },
    
    // Message & Notification
    Message: {
      borderRadiusLG: 12,
    },
    Notification: {
      borderRadiusLG: 16,
    },
  },
};

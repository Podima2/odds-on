export const theme = {
  colors: {
    background: '#060816',
    card: '#12182A',
    cardBorder: '#24304A',
    cardMuted: '#0F1424',
    primary: '#7C4DFF',
    secondary: '#1FD6FF',
    tertiary: '#2DE6C0',
    success: '#10B981',
    danger: '#EF4444',
    live: '#FF304F',
    glow: '#A78BFA',
    text: {
      primary: '#FFFFFF',
      secondary: '#A4B0CA',
      tertiary: '#67748F'
    },
    yes: '#10B981',
    no: '#EF4444'
  },
  gradients: {
    primary: ['#7C4DFF', '#1FD6FF'] as const,
    yes: ['#10B981', '#059669'] as const,
    no: ['#EF4444', '#DC2626'] as const,
    card: ['#12182A', '#0B1020'] as const,
    hero: ['#071225', '#101635', '#1C1240'] as const
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32
  },
  borderRadius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24
  },
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32
  }
}

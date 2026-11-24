import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.prenzao.app',
  appName: 'Prenzao',
  webDir: 'dist',
  android: {
    backgroundColor: '#F2F2F7',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#F2F2F7',
      showSpinner: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_prenzao',
      iconColor: '#F25C05',
    },
  },
};

export default config;

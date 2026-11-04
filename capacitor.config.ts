import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'quest.touchline.app',
  appName: 'TouchLine',
  webDir: 'dist',
  backgroundColor: '#101923',
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    zoomEnabled: true,
  },
}

export default config
